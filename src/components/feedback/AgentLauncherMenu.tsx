'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RECOGNISED_CLIS, buildLaunchCommand, type AgentDef } from '@/lib/feedback/agentCatalog';
import { agentIcon } from './agentLogos';

interface AgentInstallStatus { installed: boolean; version: string | null }
type ProbeMap = Record<string, AgentInstallStatus>;

interface PreferredAgent { id: string; variantId: string; customFlags?: string }

interface AgentLauncherMenuProps {
    wsRef: { current: WebSocket | null };
    connected: boolean;
    projectId: string | null | undefined;
}

const LAST_VARIANT_KEY = 'adhdev-launcher-last-variant';
const PROBE_TTL_MS = 30_000;

let probeCache: { ts: number; data: ProbeMap } | null = null;
let probeInflight: Promise<ProbeMap> | null = null;

async function fetchProbeAgents(force = false): Promise<ProbeMap> {
    const now = Date.now();
    if (!force && probeCache && now - probeCache.ts < PROBE_TTL_MS) return probeCache.data;
    if (probeInflight) return probeInflight;
    probeInflight = (async () => {
        try {
            const r = await fetch('/api/onboarding/detect-agents');
            const j = await r.json();
            const data = (j?.agents || {}) as ProbeMap;
            probeCache = { ts: Date.now(), data };
            return data;
        } catch {
            return probeCache?.data || {};
        } finally {
            probeInflight = null;
        }
    })();
    return probeInflight;
}

function readLastVariants(): Record<string, string> {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(LAST_VARIANT_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function writeLastVariant(agentId: string, variantId: string) {
    if (typeof window === 'undefined') return;
    try {
        const cur = readLastVariants();
        cur[agentId] = variantId;
        localStorage.setItem(LAST_VARIANT_KEY, JSON.stringify(cur));
    } catch { /* ignore */ }
}

export function AgentLauncherMenu({ wsRef, connected, projectId }: AgentLauncherMenuProps) {
    const [open, setOpen] = useState(false);
    const [probe, setProbe] = useState<ProbeMap>({});
    const [probeLoading, setProbeLoading] = useState(false);
    const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
    const [installing, setInstalling] = useState<string | null>(null);
    const [installError, setInstallError] = useState<string | null>(null);
    const [preferredAgent, setPreferredAgent] = useState<PreferredAgent | null>(null);
    const [lastVariants, setLastVariants] = useState<Record<string, string>>({});
    // AD-296: track whether an agent is actively running so we can boost the
    // Launch button's prominence on idle. We poll terminal-status here rather
    // than pull from a parent prop to keep the launcher self-contained.
    const [agentActive, setAgentActive] = useState<boolean>(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Resolve the variant we'll launch when the user clicks the parent row:
    // last-used (per agent) → wizard's preferredAgent → catalog default.
    const resolveDefaultVariant = useCallback((agent: AgentDef): string => {
        if (lastVariants[agent.id]) return lastVariants[agent.id];
        if (preferredAgent?.id === agent.id) return preferredAgent.variantId;
        return agent.defaultVariantId;
    }, [lastVariants, preferredAgent]);

    const refreshProbe = useCallback(async (force = false) => {
        setProbeLoading(true);
        try { setProbe(await fetchProbeAgents(force)); }
        finally { setProbeLoading(false); }
    }, []);

    // Lazy-fetch on first open.
    useEffect(() => {
        if (!open) return;
        if (Object.keys(probe).length === 0) refreshProbe(false);
    }, [open, probe, refreshProbe]);

    // Pull preferredAgent + last-used variants once.
    useEffect(() => {
        setLastVariants(readLastVariants());
        let cancelled = false;
        (async () => {
            try {
                const headers: HeadersInit = projectId ? { 'x-adhdev-project': projectId } : {};
                const r = await fetch('/api/onboarding', { headers });
                if (!r.ok) return;
                const j = await r.json();
                if (cancelled) return;
                const pa = j?.onboardingState?.preferredAgent;
                if (pa?.id && pa?.variantId) setPreferredAgent(pa);
            } catch { /* ignore */ }
        })();
        return () => { cancelled = true; };
    }, [projectId]);

    // AD-296: poll terminal-status to know whether an agent is running. We
    // only need a coarse signal (active vs idle) for the Launch button's
    // visual weight, so a 3 s cadence is fine — and we skip when there is no
    // project (the launch button is already disabled in that case).
    useEffect(() => {
        if (!projectId || !connected) {
            setAgentActive(false);
            return;
        }
        let cancelled = false;
        const fetchStatus = async () => {
            try {
                const r = await fetch(`/api/terminal-status?project=${encodeURIComponent(projectId)}`);
                if (!r.ok) return;
                const j = await r.json();
                if (!cancelled) setAgentActive(Boolean(j?.agentActive));
            } catch { /* ignore — keep last known value */ }
        };
        fetchStatus();
        const interval = setInterval(fetchStatus, 3000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [projectId, connected]);

    // Click-outside close.
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false);
                setHoveredAgent(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const launchVariant = useCallback((agent: AgentDef, variantId: string) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const cmd = buildLaunchCommand(agent.id, variantId, preferredAgent?.id === agent.id ? preferredAgent.customFlags : undefined);
        if (!cmd) return;
        ws.send(JSON.stringify({ type: 'agent-hint', agentId: agent.id }));
        ws.send(JSON.stringify({ type: 'input', data: cmd + '\r' }));
        writeLastVariant(agent.id, variantId);
        setLastVariants(prev => ({ ...prev, [agent.id]: variantId }));
        setOpen(false);
        setHoveredAgent(null);
    }, [wsRef, preferredAgent]);

    const installAgent = useCallback(async (agent: AgentDef) => {
        if (installing) return;
        setInstalling(agent.id);
        setInstallError(null);
        try {
            const headers: HeadersInit = { 'Content-Type': 'application/json' };
            if (projectId) (headers as Record<string, string>)['x-adhdev-project'] = projectId;
            const r = await fetch('/api/install-agent', {
                method: 'POST',
                headers,
                body: JSON.stringify({ agentId: agent.id }),
            });
            const j = await r.json().catch(() => ({}));
            if (j?.guidanceOnly) {
                setInstallError(j.message || 'Manual install required.');
                return;
            }
            if (!r.ok) {
                setInstallError(j?.error || `Install failed (${r.status}).`);
                return;
            }
            // Poll detect-agents until the agent flips to installed (or 60 s).
            const deadline = Date.now() + 60_000;
            while (Date.now() < deadline) {
                await new Promise(res => setTimeout(res, 2_000));
                const fresh = await fetchProbeAgents(true);
                setProbe(fresh);
                if (fresh[agent.id]?.installed) {
                    setHoveredAgent(agent.id);
                    return;
                }
            }
        } catch (err) {
            setInstallError(String(err));
        } finally {
            setInstalling(null);
        }
    }, [installing, projectId]);

    const buttonDisabled = !connected || !projectId;
    // AD-296: when an agent isn't running we want the Launch button to read
    // as the obvious next step. Bumps text size + gold accent + ring. Active
    // sessions keep the low-key tertiary look so it doesn't compete with
    // the live terminal output.
    const idleProminent = !buttonDisabled && !agentActive;
    const launchButtonClass = buttonDisabled
        ? 'text-[9px] px-1.5 py-0.5 text-vd-text-tertiary opacity-50 cursor-not-allowed'
        : idleProminent
            ? 'text-[10px] px-2 py-1 text-vd-accent-gold bg-vd-accent-gold/10 ring-1 ring-vd-accent-gold/40 hover:bg-vd-accent-gold/20'
            : 'text-[9px] px-1.5 py-0.5 text-vd-text-tertiary hover:text-vd-text-secondary hover:bg-vd-bg-tertiary';

    return (
        <div ref={wrapperRef} className="relative z-[120]">
            <button
                onClick={() => setOpen(o => !o)}
                disabled={buttonDisabled}
                className={`${launchButtonClass} rounded flex items-center gap-1`}
                title={buttonDisabled ? 'Connect a terminal session first' : agentActive ? 'Launch a coding agent' : 'Launch a coding agent — none running'}
            >
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M3.5 2.5 L12.5 8 L3.5 13.5 z" />
                </svg>
                <span>Launch</span>
            </button>
            {open && (
                <div
                    className="absolute right-0 top-full mt-1 bg-vd-bg-secondary border border-vd-border rounded-lg shadow-panel z-[120] py-1 min-w-[230px]"
                    onMouseLeave={() => setHoveredAgent(null)}
                >
                    <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-vd-text-tertiary border-b border-vd-border flex items-center justify-between">
                        <span>Coding agents</span>
                        <button
                            onClick={() => refreshProbe(true)}
                            className="text-vd-text-tertiary hover:text-vd-text-secondary"
                            title="Re-detect installed agents"
                        >
                            <svg className={`w-3 h-3 ${probeLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.582m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    </div>
                    {/* AD-296: while detection is in flight (and no cached
                        probe yet), render each row as a 'detecting…'
                        skeleton instead of defaulting to Install. Otherwise
                        every agent flashes 'Install' for ~1 s before
                        flipping to Run on cached installs, which Sameer
                        flagged as misleading on first open. */}
                    {(probeLoading && Object.keys(probe).length === 0) ? (
                        RECOGNISED_CLIS.map(agent => (
                            <div key={agent.id} className="w-full px-3 py-1.5 text-[11px] flex items-center gap-2.5 opacity-70" aria-busy="true">
                                <span className="text-vd-text-tertiary">
                                    {agentIcon(agent.id, 'w-4 h-4')}
                                </span>
                                <span className="flex-1 text-vd-text-secondary">{agent.label}</span>
                                <span className="text-[9px] text-vd-text-tertiary flex items-center gap-1">
                                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.582m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Detecting…
                                </span>
                            </div>
                        ))
                    ) : RECOGNISED_CLIS.map(agent => {
                        const status = probe[agent.id];
                        const isInstalled = status?.installed === true;
                        const isHovered = hoveredAgent === agent.id;
                        const defaultVariantId = resolveDefaultVariant(agent);
                        const isInstallingThis = installing === agent.id;
                        return (
                            <div
                                key={agent.id}
                                className="relative"
                                onMouseEnter={() => setHoveredAgent(agent.id)}
                            >
                                <button
                                    onClick={() => {
                                        if (isInstalled) launchVariant(agent, defaultVariantId);
                                        else if (agent.installSupported) installAgent(agent);
                                    }}
                                    disabled={isInstallingThis}
                                    className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2.5 hover:bg-vd-bg-tertiary ${isInstallingThis ? 'opacity-60 cursor-wait' : ''}`}
                                >
                                    <span className={isInstalled ? 'text-vd-accent-gold' : 'text-vd-text-tertiary'}>
                                        {agentIcon(agent.id, 'w-4 h-4')}
                                    </span>
                                    <span className="flex-1 text-vd-text-primary">{agent.label}</span>
                                    {isInstallingThis ? (
                                        <span className="text-[9px] text-vd-text-tertiary">Installing…</span>
                                    ) : isInstalled ? (
                                        <span className="text-[9px] text-emerald-400/80" title={status?.version ? `v${status.version}` : 'installed'}>
                                            ▶ Run
                                        </span>
                                    ) : agent.installSupported ? (
                                        <span className="text-[9px] text-vd-accent-gold/80">⬇ Install</span>
                                    ) : (
                                        <span className="text-[9px] text-vd-text-tertiary">Manual</span>
                                    )}
                                </button>
                                {/* Variant flyout — only when installed and hovered */}
                                {isInstalled && isHovered && (
                                    <div className="absolute right-full top-0 mr-1 bg-vd-bg-secondary border border-vd-border rounded-lg shadow-panel z-[130] py-1 min-w-[210px]">
                                        <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-vd-text-tertiary border-b border-vd-border">
                                            {agent.label} variants
                                        </div>
                                        {agent.variants.map(v => {
                                            const isDefault = v.id === defaultVariantId;
                                            const previewCmd = buildLaunchCommand(agent.id, v.id, preferredAgent?.id === agent.id ? preferredAgent.customFlags : undefined);
                                            return (
                                                <button
                                                    key={v.id}
                                                    onClick={() => launchVariant(agent, v.id)}
                                                    className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-vd-bg-tertiary"
                                                    title={v.help}
                                                >
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-vd-text-primary">{v.label}</span>
                                                        {isDefault && <span className="text-vd-accent-gold text-[10px]">★</span>}
                                                    </div>
                                                    {previewCmd && (
                                                        <div className="text-[9px] text-vd-text-tertiary font-mono mt-0.5 truncate">{previewCmd}</div>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                {/* Manual-install guidance shows inline (Cursor/Continue) */}
                                {!isInstalled && !agent.installSupported && isHovered && (
                                    <div className="absolute right-full top-0 mr-1 bg-vd-bg-secondary border border-vd-border rounded-lg shadow-panel z-[130] py-2 px-3 min-w-[240px] text-[10px] text-vd-text-secondary leading-relaxed">
                                        {agent.installHint}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {installError && (
                        <div className="px-3 py-1.5 text-[10px] text-red-400 border-t border-vd-border">
                            {installError}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
