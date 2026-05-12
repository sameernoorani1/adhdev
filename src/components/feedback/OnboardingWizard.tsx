'use client';

// AD-166: 4-step onboarding wizard. Fires on first board paint when
// onboardingState.wizardCompleted is unset, or on demand via ?wizard=onboarding.
//
// Steps:
//   1. Pick a folder — paste an existing absolute path, OR create a new folder
//      (parent + name) which mkdirs + git inits + writes a starter README.
//   2. Connect a coding agent — lists the recognised CLIs, polls
//      /api/terminal-status, glows green when one is detected.
//   3. (Existing folder only) Populate the board — scans for TODO.md /
//      TASKS.md / BACKLOG.md / ROADMAP.md and offers to import checklist
//      items as draft tickets.
//   4. Git posture — three plain-English options. "Experiment" actually runs
//      git init + writes .gitignore; "GitHub now" / "I have a remote" record
//      intent only for now.
//
// State persists step-by-step into .adhdev/config.json:onboardingState via
// the existing PATCH /api/onboarding so a closed-mid-wizard user resumes
// where they left off.

import { useEffect, useState, useCallback } from 'react';
import { RECOGNISED_CLIS } from '@/lib/feedback/agentCatalog';

export interface WizardOnboardingState {
    wizardCompleted?: boolean;
    wizardStep?: number;
    folderSource?: 'existing' | 'new' | null;
    folderPath?: string | null;
    agentDetected?: string | null;
    populated?: boolean;
    gitPosture?: 'experiment' | 'github' | 'remote' | null;
    remoteUrl?: string | null;
    // §5.4 follow-up: persist the user's preferred agent + variant so the
    // Run flow / startup-guidance text can address them by their chosen
    // shape (e.g. "claude --dangerously-skip-permissions" instead of
    // bare "claude") on subsequent sessions.
    preferredAgent?: { id: string; variantId: string; customFlags?: string } | null;
}

interface OnboardingWizardProps {
    initialState: WizardOnboardingState;
    onPatchOnboarding: (patch: Record<string, unknown>) => Promise<void> | void;
    onClose: () => void;
}

type ScanKind =
    | 'task-file' | 'todo-comment' | 'fixme-comment'
    | 'md-checklist' | 'md-heading'
    | 'package-script' | 'missing-file' | 'github-issue';
interface ScanCandidate { title: string; source: string; kind?: ScanKind }
interface ScanResult { candidates: ScanCandidate[]; files: string[]; cappedAt: number; breakdown?: Partial<Record<ScanKind, number>> }

// AD-241: map scanner kind to a closed taxonomy tag where the mapping is
// clean. Sameer's rule: only `fixme-comment` → bug and `missing-file` → polish;
// the rest stay untagged so we don't pollute the taxonomy.
function tagForCandidate(kind: ScanKind | undefined): string[] {
    if (kind === 'fixme-comment') return ['bug'];
    if (kind === 'missing-file') return ['polish'];
    return [];
}

// Agent catalogue moved to src/lib/feedback/agentCatalog.ts so the persistent
// terminal-header launcher can share the same source of truth.

export function OnboardingWizard({ initialState, onPatchOnboarding, onClose }: OnboardingWizardProps) {
    const [step, setStep] = useState<number>(initialState.wizardStep || 1);
    const [folderSource, setFolderSource] = useState<'existing' | 'new' | null>(initialState.folderSource || null);
    const [folderPath, setFolderPath] = useState<string>(initialState.folderPath || '');
    const [parentPath, setParentPath] = useState<string>('');
    const [folderName, setFolderName] = useState<string>('');
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    // AD-230: native folder picker availability + per-path validation. The
    // capability probe runs once on mount; if the OS dialog tool is missing
    // (no PowerShell on Windows / no zenity on Linux), the Browse button
    // hides and the typed-path input is the only way forward.
    const [pickerAvailable, setPickerAvailable] = useState<boolean>(false);
    const [picking, setPicking] = useState(false);
    const [pathValidation, setPathValidation] = useState<{
        valid: boolean;
        exists: boolean;
        isDirectory: boolean;
        writable: boolean;
        hasAdhdev: boolean;
        error: string | null;
    } | null>(null);
    const [validating, setValidating] = useState(false);
    const [agentDetected, setAgentDetected] = useState<string | null>(initialState.agentDetected || null);
    // §5.4 follow-up: full per-agent panel state.
    //   - `agentInstalls` is the result of /api/onboarding/detect-agents:
    //     `{ [agentId]: { installed, version } }`. Refreshes when Step 2
    //     mounts or the user clicks Re-detect.
    //   - `installingAgentId` tracks the in-flight install (one at a time).
    //   - `installResults` shows per-agent install start / error / guidance.
    //   - `expandedAgentId` is which row is open for variant configuration.
    //   - `agentVariantSel` / `agentCustomFlags` are the user's per-agent
    //     selections (shown in the expanded card).
    //   - `preferredAgent` is the user-confirmed pick that gets persisted.
    type InstallStatus = { installed: boolean; version: string | null };
    type InstallResult = { kind: 'started' | 'guidance' | 'error'; message: string };
    const [agentInstalls, setAgentInstalls] = useState<Record<string, InstallStatus>>({});
    const [agentInstallsLoading, setAgentInstallsLoading] = useState(false);
    const [installingAgentId, setInstallingAgentId] = useState<string | null>(null);
    const [installResults, setInstallResults] = useState<Record<string, InstallResult>>({});
    const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
    const [agentVariantSel, setAgentVariantSel] = useState<Record<string, string>>(() => {
        const out: Record<string, string> = {};
        RECOGNISED_CLIS.forEach(a => { out[a.id] = a.defaultVariantId; });
        if (initialState.preferredAgent?.id && initialState.preferredAgent?.variantId) {
            out[initialState.preferredAgent.id] = initialState.preferredAgent.variantId;
        }
        return out;
    });
    const [agentCustomFlags, setAgentCustomFlags] = useState<Record<string, string>>(() => {
        const out: Record<string, string> = {};
        if (initialState.preferredAgent?.id && initialState.preferredAgent?.customFlags) {
            out[initialState.preferredAgent.id] = initialState.preferredAgent.customFlags;
        }
        return out;
    });
    const [preferredAgent, setPreferredAgent] = useState<{ id: string; variantId: string; customFlags?: string } | null>(initialState.preferredAgent || null);
    const [scanResult, setScanResult] = useState<ScanResult | null>(null);
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    // AD-241: per-row selection for the import-as-tickets action. Default to
    // all-checked when scan results land. After a successful import we record
    // the count + disable the button so the user can't double-import.
    const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set());
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const [importResult, setImportResult] = useState<{ imported: number; failed: number } | null>(null);
    const [gitPosture, setGitPosture] = useState<'experiment' | 'github' | 'remote' | null>(initialState.gitPosture || null);
    const [remoteUrl, setRemoteUrl] = useState<string>(initialState.remoteUrl || '');
    const [finishing, setFinishing] = useState(false);
    const [finishError, setFinishError] = useState<string | null>(null);

    // AD-230: probe whether the native folder dialog is reachable on this
    // platform. Runs once. If false, the Browse button hides and the user
    // falls back to typing the path.
    useEffect(() => {
        let cancelled = false;
        fetch('/api/onboarding/pick-folder')
            .then(r => r.json())
            .then(d => { if (!cancelled) setPickerAvailable(!!d?.available); })
            .catch(() => { /* leave false */ });
        return () => { cancelled = true; };
    }, []);

    // AD-230: validate the typed/picked path on change (debounced). Drives the
    // inline ✓/✗ indicator and gates Next.
    useEffect(() => {
        if (folderSource !== 'existing') {
            setPathValidation(null);
            return;
        }
        const trimmed = folderPath.trim();
        if (!trimmed) {
            setPathValidation(null);
            return;
        }
        let cancelled = false;
        setValidating(true);
        const handle = setTimeout(async () => {
            try {
                const r = await fetch('/api/onboarding/validate-path', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderPath: trimmed }),
                });
                const d = await r.json();
                if (!cancelled) setPathValidation(d);
            } catch {
                if (!cancelled) setPathValidation({ valid: false, exists: false, isDirectory: false, writable: false, hasAdhdev: false, error: 'server_error' });
            } finally {
                if (!cancelled) setValidating(false);
            }
        }, 350);
        return () => { cancelled = true; clearTimeout(handle); };
    }, [folderPath, folderSource]);

    const handleBrowse = useCallback(async () => {
        if (picking) return;
        setPicking(true);
        try {
            const r = await fetch('/api/onboarding/pick-folder', { method: 'POST' });
            const d = await r.json();
            if (d?.folderPath) {
                setFolderPath(d.folderPath);
                setFolderSource('existing');
            }
            // 'cancelled' / other errors are silently swallowed — the user
            // can just type the path or click Browse again.
        } catch { /* ignore */ }
        finally { setPicking(false); }
    }, [picking]);

    // §5.4 follow-up: detect which agents are installed by hitting
    // /api/onboarding/detect-agents. Runs once on Step 2 mount + on demand
    // via the Re-detect button.
    const detectAgents = useCallback(async () => {
        setAgentInstallsLoading(true);
        try {
            const r = await fetch('/api/onboarding/detect-agents');
            const d = await r.json();
            if (d?.agents) setAgentInstalls(d.agents);
        } catch { /* leave previous result; user can retry */ }
        finally { setAgentInstallsLoading(false); }
    }, []);

    // §5.4 follow-up: per-agent install. Calls the generic /api/install-agent
    // endpoint, which ships the agent's install command into the embedded
    // terminal session (same shape as the AD-228 Claude installer). Editor-
    // bundled agents (Cursor / Continue) come back as `guidanceOnly` — we
    // surface the message inline rather than blasting the terminal.
    const handleInstallAgent = useCallback(async (agentId: string) => {
        if (installingAgentId) return;
        setInstallResults(prev => ({ ...prev, [agentId]: { kind: 'started', message: 'Starting install in the terminal…' } }));
        setInstallingAgentId(agentId);
        try {
            const r = await fetch('/api/install-agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId }),
            });
            const d = await r.json();
            if (!r.ok) {
                setInstallResults(prev => ({ ...prev, [agentId]: { kind: 'error', message: d?.error || 'Install failed.' } }));
            } else if (d.guidanceOnly) {
                setInstallResults(prev => ({ ...prev, [agentId]: { kind: 'guidance', message: d.message || 'See the agent docs to install.' } }));
            } else {
                setInstallResults(prev => ({ ...prev, [agentId]: { kind: 'started', message: `Running: ${d.command || 'install'} (watch the terminal)` } }));
                // Poll detect-agents a couple of times so the row flips to
                // "Detected vN.N.N" after the install finishes.
                setTimeout(() => detectAgents(), 8000);
                setTimeout(() => detectAgents(), 20000);
                setTimeout(() => detectAgents(), 45000);
            }
        } catch {
            setInstallResults(prev => ({ ...prev, [agentId]: { kind: 'error', message: 'Terminal server unreachable.' } }));
        } finally {
            setInstallingAgentId(null);
        }
    }, [installingAgentId, detectAgents]);

    // §5.4 follow-up: confirm the user's pick + variant + custom flags as
    // the preferredAgent for this project. Persisted via the wizard's
    // existing onboarding-state PATCH — the Run flow can read it later.
    const handleConfirmAgent = useCallback((agentId: string) => {
        const variantId = agentVariantSel[agentId] || RECOGNISED_CLIS.find(a => a.id === agentId)?.defaultVariantId || 'standard';
        const customFlags = variantId === 'custom' ? (agentCustomFlags[agentId] || '').trim() : undefined;
        const next = { id: agentId, variantId, ...(customFlags ? { customFlags } : {}) };
        setPreferredAgent(next);
        // Use onPatchOnboarding directly rather than the `persist` wrapper —
        // `persist` is declared later in this component and using it here
        // would create an unnecessary forward reference.
        void onPatchOnboarding({ preferredAgent: next } as Record<string, unknown>);
    }, [agentVariantSel, agentCustomFlags, onPatchOnboarding]);

    // Fire detect on Step 2 mount.
    useEffect(() => {
        if (step !== 2) return;
        void detectAgents();
    }, [step, detectAgents]);

    // Step 2 — poll /api/terminal-status until we see an agentName. Lightweight
    // (every 2s) and only while the wizard is actually on Step 2.
    useEffect(() => {
        if (step !== 2) return;
        let cancelled = false;
        const tick = async () => {
            try {
                const r = await fetch('/api/terminal-status');
                if (cancelled) return;
                const d = await r.json();
                if (d?.agentActive && d?.agentName) {
                    setAgentDetected(d.agentName);
                }
            } catch { /* swallow — non-fatal */ }
        };
        tick();
        const interval = setInterval(tick, 2000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [step]);

    // Persist progress on step transitions so a mid-wizard close resumes cleanly.
    const persist = useCallback((patch: Partial<WizardOnboardingState>) => {
        return onPatchOnboarding(patch as Record<string, unknown>);
    }, [onPatchOnboarding]);

    // AD-230: existing-folder branch must also validate (exists + writable).
    // The new-folder branch trusts /api/onboarding/create-folder's success path.
    const canAdvanceFromStep1 =
        !!folderSource &&
        folderPath.trim().length > 0 &&
        (folderSource === 'new' || (pathValidation?.valid ?? false));

    const handleCreateFolder = async () => {
        setCreateError(null);
        if (!parentPath.trim() || !folderName.trim()) {
            setCreateError('Both parent path and folder name are required.');
            return;
        }
        setCreating(true);
        try {
            const res = await fetch('/api/onboarding/create-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent: parentPath.trim(), name: folderName.trim() }),
            });
            const data = await res.json();
            if (!res.ok) {
                setCreateError(data.error || 'Failed to create folder');
                return;
            }
            setFolderPath(data.folderPath);
            setFolderSource('new');
        } catch (err) {
            setCreateError(String(err));
        } finally {
            setCreating(false);
        }
    };

    const handleScan = async () => {
        setScanError(null);
        setScanning(true);
        setScanResult(null);
        setImportResult(null);
        setImportError(null);
        try {
            const res = await fetch('/api/onboarding/scan-tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath }),
            });
            const data = await res.json();
            if (!res.ok) {
                setScanError(data.error || 'Failed to scan');
                return;
            }
            setScanResult(data);
            // AD-241: default to all-selected so the common case (import
            // everything) is one click.
            const all = new Set<number>();
            for (let i = 0; i < (data?.candidates?.length || 0); i++) all.add(i);
            setSelectedIdx(all);
        } catch (err) {
            setScanError(String(err));
        } finally {
            setScanning(false);
        }
    };

    // AD-241: import the user-selected scan candidates as backlog tickets.
    // POSTs to /api/feedback per candidate. We do this serially rather than
    // in parallel so a partial failure surfaces in order and the board
    // doesn't get hit with N concurrent writes through the lock.
    const handleImport = async () => {
        if (!scanResult || selectedIdx.size === 0 || importing) return;
        setImportError(null);
        setImporting(true);
        let imported = 0;
        let failed = 0;
        try {
            for (let i = 0; i < scanResult.candidates.length; i++) {
                if (!selectedIdx.has(i)) continue;
                const c = scanResult.candidates[i];
                try {
                    const r = await fetch('/api/feedback', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            title: c.title.slice(0, 200),
                            description: `Source: ${c.source}\n\n_Auto-imported from onboarding scan (AD-229 / AD-241)._`,
                            status: 'backlog',
                            priority: 'medium',
                            tags: tagForCandidate(c.kind),
                            reporter: 'onboarding-scan',
                            reporterType: 'system',
                        }),
                    });
                    if (r.ok) imported++; else failed++;
                } catch {
                    failed++;
                }
            }
            setImportResult({ imported, failed });
        } catch (err) {
            setImportError(String(err));
        } finally {
            setImporting(false);
        }
    };

    const toggleSelected = (i: number) => {
        setSelectedIdx(prev => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i); else next.add(i);
            return next;
        });
    };
    const selectAll = () => {
        if (!scanResult) return;
        const all = new Set<number>();
        for (let i = 0; i < scanResult.candidates.length; i++) all.add(i);
        setSelectedIdx(all);
    };
    const selectNone = () => setSelectedIdx(new Set());

    const handleFinish = async () => {
        setFinishError(null);
        setFinishing(true);
        try {
            // AD-231: git-init now actually wires `experiment` (init + .gitignore)
            // AND `remote` (init + .gitignore + remote add origin <url>). The
            // `github` posture still defers — full OAuth + repo create is a
            // post-launch Settings panel. Surface server errors instead of
            // silently swallowing them so a bad remote URL is visible.
            if (gitPosture && folderPath) {
                const r = await fetch('/api/onboarding/git-init', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderPath, posture: gitPosture, remoteUrl }),
                });
                if (!r.ok) {
                    const d = await r.json().catch(() => ({} as { error?: string }));
                    setFinishError(d.error || 'Failed to apply git posture.');
                    return;
                }
            }
            await persist({
                wizardCompleted: true,
                wizardStep: 4,
                folderSource,
                folderPath,
                agentDetected,
                // AD-241: `populated` now means "scan results were actually
                // imported as tickets" — not just "scan returned candidates".
                // The board's empty-state UI (AD-234) will read this.
                populated: !!importResult && importResult.imported > 0,
                gitPosture,
                remoteUrl: remoteUrl || null,
                // §5.1 / first-time-intro fix: do NOT flip welcomeSeen here.
                // Setting it pre-emptively at wizard finish suppresses the
                // WelcomeModal (the actual product intro), leaving fresh
                // users with no first-time guidance after the wizard. The
                // WelcomeModal flips it itself when the user dismisses it.
            } as Record<string, unknown>);
            onClose();
        } catch (err) {
            setFinishError(String(err));
        } finally {
            setFinishing(false);
        }
    };

    const handleSkipAll = async () => {
        // §5.1 fix: do NOT pre-flip welcomeSeen here. A user who skips the
        // wizard still benefits from the WelcomeModal's product intro on
        // the next paint. Welcome dismissal flips its own flag.
        await persist({ wizardCompleted: true } as Record<string, unknown>);
        onClose();
    };

    // Move to next step, persisting state at each hop.
    const goNext = async () => {
        let next = step + 1;
        // Skip Step 3 entirely for the *new folder* path — there's nothing to scan.
        if (step === 2 && folderSource === 'new') next = 4;
        await persist({ wizardStep: next, folderSource, folderPath, agentDetected });
        setStep(next);
    };
    const goBack = () => {
        let prev = step - 1;
        if (step === 4 && folderSource === 'new') prev = 2;
        if (prev < 1) prev = 1;
        setStep(prev);
    };

    // AD-235: total step count is always 4. The new-folder path skips Step 3
    // (scan), but we don't redenominate — that made the indicator drift from
    // "1 of 4" to "1 of 3" mid-flow, which read as glitchy. With a fixed
    // total of 4 and a 4-dot progress indicator, the user always sees the
    // same shape regardless of path.
    const totalSteps = 4;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div className="relative bg-vd-bg-secondary border border-vd-border w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden rounded-xl shadow-panel">
                {/* Header */}
                <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-vd-border">
                    <div>
                        <h2 className="text-sm font-semibold text-vd-text-primary">Welcome to ADHDev</h2>
                        {/* AD-235: 4-dot progress indicator. Stays four dots regardless of
                            folder-source path (new-folder skips Step 3 silently). */}
                        <div className="flex items-center gap-1 mt-1.5">
                            {Array.from({ length: totalSteps }).map((_, i) => {
                                const stepNum = i + 1;
                                const isActive = step === stepNum;
                                const isPast = step > stepNum;
                                return (
                                    <span
                                        key={i}
                                        className={`h-1.5 rounded-full transition-all ${
                                            isActive
                                                ? 'w-6 bg-vd-accent-gold'
                                                : isPast
                                                    ? 'w-1.5 bg-vd-accent-gold/60'
                                                    : 'w-1.5 bg-vd-border'
                                        }`}
                                    />
                                );
                            })}
                            <span className="ml-2 text-[10px] text-vd-text-tertiary">Step {step} of {totalSteps}</span>
                        </div>
                    </div>
                    <button
                        onClick={handleSkipAll}
                        className="text-[10px] text-vd-text-tertiary hover:text-vd-text-secondary px-2 py-1 rounded hover:bg-vd-bg-tertiary"
                        title="Skip the whole wizard — you can re-run it later via ?wizard=onboarding"
                    >
                        Skip
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 text-[12px] text-vd-text-secondary">
                    {step === 1 && (
                        <div className="space-y-4">
                            <div>
                                <h3 className="text-sm font-semibold text-vd-text-primary mb-1">Pick a folder</h3>
                                <p className="text-[11px] text-vd-text-tertiary">This is where ADHDev will create its `.adhdev/` workspace and where your coding agent will run.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setFolderSource('existing')}
                                    className={`px-3 py-3 text-left rounded-lg border ${folderSource === 'existing' ? 'border-vd-accent-gold bg-vd-accent-gold/10 text-vd-text-primary' : 'border-vd-border hover:border-vd-text-tertiary text-vd-text-secondary'}`}
                                >
                                    <div className="text-xs font-semibold mb-0.5">Open an existing folder</div>
                                    <div className="text-[10px] text-vd-text-tertiary">Use a project you already have on disk.</div>
                                </button>
                                <button
                                    onClick={() => setFolderSource('new')}
                                    className={`px-3 py-3 text-left rounded-lg border ${folderSource === 'new' ? 'border-vd-accent-gold bg-vd-accent-gold/10 text-vd-text-primary' : 'border-vd-border hover:border-vd-text-tertiary text-vd-text-secondary'}`}
                                >
                                    <div className="text-xs font-semibold mb-0.5">Create a new folder</div>
                                    <div className="text-[10px] text-vd-text-tertiary">Fresh start — we'll mkdir + git init for you.</div>
                                </button>
                            </div>

                            {folderSource === 'existing' && (
                                <div className="space-y-2">
                                    <label className="text-[11px] text-vd-text-secondary">Folder for ADHDev</label>
                                    <div className="flex items-stretch gap-2">
                                        {pickerAvailable && (
                                            <button
                                                type="button"
                                                disabled={picking}
                                                onClick={handleBrowse}
                                                className="flex-shrink-0 px-3 py-2 text-[11px] font-medium border border-vd-accent-gold/40 text-vd-accent-gold rounded-md hover:bg-vd-accent-gold/10 disabled:opacity-50"
                                                title="Open a native folder picker"
                                            >
                                                {picking ? 'Opening…' : 'Browse…'}
                                            </button>
                                        )}
                                        <input
                                            type="text"
                                            autoFocus
                                            value={folderPath}
                                            onChange={(e) => setFolderPath(e.target.value)}
                                            placeholder="C:\Codebases\my-project   or   /Users/you/code/my-project"
                                            className={`flex-1 px-3 py-2 text-[12px] bg-vd-bg-input border rounded-md text-vd-text-primary placeholder:text-vd-text-tertiary focus:outline-none ${
                                                pathValidation == null
                                                    ? 'border-vd-border focus:border-vd-accent-gold/60'
                                                    : pathValidation.valid
                                                        ? 'border-emerald-500/50 focus:border-emerald-500/70'
                                                        : 'border-red-500/50 focus:border-red-500/70'
                                            }`}
                                        />
                                    </div>
                                    {/* Inline validation status */}
                                    {folderPath.trim().length > 0 && (
                                        <div className="text-[10px] flex items-center gap-1.5 min-h-[14px]">
                                            {validating ? (
                                                <span className="text-vd-text-tertiary">Checking path…</span>
                                            ) : pathValidation?.valid ? (
                                                <span className="text-emerald-400">
                                                    ✓ Valid folder.
                                                    {pathValidation.hasAdhdev ? ' Already has an .adhdev/ — you\'re re-opening this project.' : ' We\'ll create .adhdev/ here.'}
                                                </span>
                                            ) : pathValidation ? (
                                                <span className="text-red-400">
                                                    ✗ {pathValidation.error === 'not_absolute' ? 'Path must be absolute.' :
                                                       pathValidation.error === 'not_found' ? 'Folder doesn\'t exist.' :
                                                       pathValidation.error === 'not_a_directory' ? 'Path is not a directory.' :
                                                       pathValidation.error === 'not_writable' ? 'Folder is not writable.' :
                                                       pathValidation.error === 'empty' ? 'Enter a path.' :
                                                       'Path is invalid.'}
                                                </span>
                                            ) : null}
                                        </div>
                                    )}
                                    <p className="text-[10px] text-vd-text-tertiary">Tip: pick somewhere outside Downloads / OneDrive — git history doesn't love sync conflicts.</p>
                                </div>
                            )}

                            {folderSource === 'new' && (
                                <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-[11px] text-vd-text-secondary">Parent path</label>
                                            <div className="flex items-stretch gap-2 mt-1">
                                                {pickerAvailable && (
                                                    <button
                                                        type="button"
                                                        disabled={picking}
                                                        onClick={async () => {
                                                            if (picking) return;
                                                            setPicking(true);
                                                            try {
                                                                const r = await fetch('/api/onboarding/pick-folder', { method: 'POST' });
                                                                const d = await r.json();
                                                                if (d?.folderPath) setParentPath(d.folderPath);
                                                            } catch { /* ignore */ }
                                                            finally { setPicking(false); }
                                                        }}
                                                        className="flex-shrink-0 px-2 py-2 text-[11px] font-medium border border-vd-accent-gold/40 text-vd-accent-gold rounded-md hover:bg-vd-accent-gold/10 disabled:opacity-50"
                                                        title="Open a native folder picker"
                                                    >
                                                        {picking ? '…' : 'Browse'}
                                                    </button>
                                                )}
                                                <input
                                                    type="text"
                                                    value={parentPath}
                                                    onChange={(e) => setParentPath(e.target.value)}
                                                    placeholder="C:\Codebases   or   /Users/you/code"
                                                    className="flex-1 px-3 py-2 text-[12px] bg-vd-bg-input border border-vd-border rounded-md text-vd-text-primary placeholder:text-vd-text-tertiary focus:border-vd-accent-gold/60 focus:outline-none"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[11px] text-vd-text-secondary">Folder name</label>
                                            <input
                                                type="text"
                                                value={folderName}
                                                onChange={(e) => setFolderName(e.target.value)}
                                                placeholder="my-new-project"
                                                className="w-full mt-1 px-3 py-2 text-[12px] bg-vd-bg-input border border-vd-border rounded-md text-vd-text-primary placeholder:text-vd-text-tertiary focus:border-vd-accent-gold/60 focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 pt-1">
                                        <button
                                            disabled={creating}
                                            onClick={handleCreateFolder}
                                            className="px-3 py-1.5 text-[11px] font-medium border border-vd-accent-gold/40 text-vd-accent-gold rounded-md hover:bg-vd-accent-gold/10 disabled:opacity-50"
                                        >
                                            {creating ? 'Creating…' : 'Create folder + git init'}
                                        </button>
                                        {folderPath && <span className="text-[11px] text-emerald-400">Created at <code className="text-vd-text-secondary">{folderPath}</code></span>}
                                    </div>
                                    {createError && <p className="text-[11px] text-red-400">{createError}</p>}
                                </div>
                            )}
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-vd-text-primary mb-1">Connect a coding agent</h3>
                                    <p className="text-[11px] text-vd-text-tertiary">Pick the agent ADHDev should drive on your tickets. We&apos;ll detect what&apos;s already on your machine and one-click install the rest.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={detectAgents}
                                    disabled={agentInstallsLoading}
                                    className="flex-shrink-0 text-[10px] px-2 py-1 rounded border border-vd-border text-vd-text-tertiary hover:text-vd-text-secondary hover:bg-vd-bg-tertiary disabled:opacity-50"
                                    title="Re-probe each agent CLI for installed status"
                                >
                                    {agentInstallsLoading ? 'Detecting…' : 'Re-detect'}
                                </button>
                            </div>

                            <div className="space-y-2">
                                {RECOGNISED_CLIS.map((agent, idx) => {
                                    const status = agentInstalls[agent.id];
                                    const isInstalled = !!status?.installed;
                                    const isLiveDetected = agentDetected === agent.id; // running NOW (terminal-status poll)
                                    const isRecommended = idx === 0; // Claude Code is index 0
                                    const isExpanded = expandedAgentId === agent.id;
                                    const isPreferred = preferredAgent?.id === agent.id;
                                    const variantId = agentVariantSel[agent.id] || agent.defaultVariantId;
                                    const variant = agent.variants.find(v => v.id === variantId) || agent.variants[0];
                                    const customFlags = agentCustomFlags[agent.id] || '';
                                    const installRes = installResults[agent.id];
                                    const isInstalling = installingAgentId === agent.id;
                                    const previewCmd = `${agent.runCommand}${variantId === 'custom' ? (customFlags ? ' ' + customFlags : '') : (variant.flags ? ' ' + variant.flags : '')}`.trim();

                                    const borderClass = isPreferred
                                        ? 'border-emerald-400/50 bg-emerald-500/10'
                                        : isLiveDetected
                                            ? 'border-emerald-400/40 bg-emerald-500/5'
                                            : isRecommended
                                                ? 'border-vd-accent-gold/40 bg-vd-accent-gold/5'
                                                : 'border-vd-border';

                                    return (
                                        <div key={agent.id} className={`px-3 py-2.5 rounded-md border ${borderClass}`}>
                                            {/* Header row */}
                                            <div className="flex items-center gap-3">
                                                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isLiveDetected ? 'bg-emerald-400' : isInstalled ? 'bg-emerald-400/60' : 'bg-vd-text-tertiary/40'}`} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-semibold text-vd-text-primary flex items-center gap-2 flex-wrap">
                                                        {agent.label}
                                                        {isRecommended && <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-vd-accent-gold/20 text-vd-accent-gold font-semibold">Recommended</span>}
                                                        {isPreferred && <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-semibold">Selected</span>}
                                                    </div>
                                                    <div className="text-[10px] text-vd-text-tertiary mt-0.5">
                                                        {agentInstallsLoading && !status ? (
                                                            <span>Probing…</span>
                                                        ) : isInstalled ? (
                                                            <span className="text-emerald-400">✓ Installed{status.version ? ` (${status.version})` : ''}{isLiveDetected ? ' · running now' : ''}</span>
                                                        ) : (
                                                            <span>Not installed — {agent.installSupported ? 'we can install it for you.' : agent.installHint}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                {/* Action button */}
                                                {isInstalled ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandedAgentId(isExpanded ? null : agent.id)}
                                                        className="flex-shrink-0 px-2.5 py-1 text-[10px] font-medium border border-vd-border rounded hover:bg-vd-bg-tertiary"
                                                    >
                                                        {isExpanded ? 'Close' : isPreferred ? 'Configure' : 'Use this'}
                                                    </button>
                                                ) : agent.installSupported ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleInstallAgent(agent.id)}
                                                        disabled={!!installingAgentId}
                                                        className={`flex-shrink-0 px-3 py-1 text-[11px] font-semibold rounded ${isRecommended ? 'bg-vd-accent-gold text-vd-text-inverse' : 'border border-vd-accent-gold/40 text-vd-accent-gold hover:bg-vd-accent-gold/10'} disabled:opacity-50`}
                                                    >
                                                        {isInstalling ? 'Starting…' : `Install ${agent.label}`}
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleInstallAgent(agent.id)}
                                                        className="flex-shrink-0 px-2.5 py-1 text-[10px] font-medium border border-vd-border rounded hover:bg-vd-bg-tertiary text-vd-text-tertiary"
                                                    >
                                                        How to install
                                                    </button>
                                                )}
                                            </div>

                                            {/* Install result (started / error / guidance) */}
                                            {installRes && (
                                                <p className={`mt-2 text-[10px] ${installRes.kind === 'error' ? 'text-red-400' : installRes.kind === 'guidance' ? 'text-vd-text-secondary' : 'text-vd-text-tertiary'}`}>
                                                    {installRes.kind === 'error' && '✗ '}
                                                    {installRes.kind === 'started' && '→ '}
                                                    {installRes.kind === 'guidance' && 'ⓘ '}
                                                    {installRes.message}
                                                </p>
                                            )}

                                            {/* Expanded variant picker */}
                                            {isExpanded && isInstalled && (
                                                <div className="mt-3 pt-3 border-t border-vd-border space-y-2">
                                                    <div className="text-[10px] text-vd-text-secondary font-medium">Run mode</div>
                                                    <div className="space-y-1">
                                                        {agent.variants.map(v => (
                                                            <label key={v.id} className="flex items-start gap-2 px-2 py-1 rounded cursor-pointer hover:bg-vd-bg-tertiary/40">
                                                                <input
                                                                    type="radio"
                                                                    name={`variant-${agent.id}`}
                                                                    checked={variantId === v.id}
                                                                    onChange={() => setAgentVariantSel(prev => ({ ...prev, [agent.id]: v.id }))}
                                                                    className="mt-0.5 accent-vd-accent-gold flex-shrink-0"
                                                                />
                                                                <div className="flex-1">
                                                                    <div className="text-[11px] text-vd-text-primary">{v.label}</div>
                                                                    <div className="text-[9px] text-vd-text-tertiary">{v.help}</div>
                                                                </div>
                                                            </label>
                                                        ))}
                                                    </div>
                                                    {variantId === 'custom' && (
                                                        <input
                                                            type="text"
                                                            value={customFlags}
                                                            onChange={(e) => setAgentCustomFlags(prev => ({ ...prev, [agent.id]: e.target.value }))}
                                                            placeholder="--your-flag --another"
                                                            className="w-full px-2 py-1.5 text-[11px] bg-vd-bg-input border border-vd-border rounded font-mono text-vd-text-primary placeholder:text-vd-text-tertiary focus:border-vd-accent-gold/60 focus:outline-none"
                                                        />
                                                    )}
                                                    <div className="flex items-center justify-between gap-2 pt-1">
                                                        <code className="text-[10px] text-vd-accent-gold bg-vd-bg-input/60 px-2 py-1 rounded font-mono truncate flex-1">{previewCmd}</code>
                                                        <button
                                                            type="button"
                                                            onClick={() => { handleConfirmAgent(agent.id); setExpandedAgentId(null); }}
                                                            className="flex-shrink-0 px-3 py-1 text-[10px] font-semibold bg-vd-accent-gold text-vd-text-inverse rounded hover:opacity-90"
                                                        >
                                                            {isPreferred ? 'Update' : 'Use this'}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <p className="text-[10px] text-vd-text-tertiary">You can change agents and run modes any time from Settings. Click <em>Next</em> when ready.</p>
                        </div>
                    )}

                    {step === 3 && folderSource === 'existing' && (
                        <div className="space-y-3">
                            <div>
                                <h3 className="text-sm font-semibold text-vd-text-primary mb-1">Populate the board?</h3>
                                <p className="text-[11px] text-vd-text-tertiary">If you already have <code>TODO.md</code> / <code>TASKS.md</code> / <code>BACKLOG.md</code> / <code>ROADMAP.md</code>, we can pull checklist items in as draft tickets.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    disabled={scanning}
                                    onClick={handleScan}
                                    className="px-3 py-1.5 text-[11px] font-medium border border-vd-accent-gold/40 text-vd-accent-gold rounded-md hover:bg-vd-accent-gold/10 disabled:opacity-50"
                                >
                                    {scanning ? 'Scanning…' : 'Scan for tasks'}
                                </button>
                                {scanResult && (
                                    <span className="text-[11px] text-vd-text-secondary">
                                        {scanResult.candidates.length} candidate{scanResult.candidates.length === 1 ? '' : 's'} across {scanResult.files.length} file{scanResult.files.length === 1 ? '' : 's'}.
                                    </span>
                                )}
                            </div>
                            {scanError && <p className="text-[11px] text-red-400">{scanError}</p>}

                            {scanResult && scanResult.candidates.length > 0 && (
                                <>
                                    <div className="flex items-center justify-between text-[10px] text-vd-text-tertiary">
                                        <div>
                                            {selectedIdx.size} of {scanResult.candidates.length} selected
                                            {scanResult.breakdown && (
                                                <span className="ml-2 opacity-80">
                                                    ({Object.entries(scanResult.breakdown).map(([k, v]) => `${v} ${k}`).join(' · ')})
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={selectAll} className="hover:text-vd-text-secondary">All</button>
                                            <span>·</span>
                                            <button onClick={selectNone} className="hover:text-vd-text-secondary">None</button>
                                        </div>
                                    </div>
                                    <div className="border border-vd-border rounded-md max-h-56 overflow-y-auto bg-vd-bg-tertiary/30">
                                        {scanResult.candidates.map((c, i) => (
                                            <label
                                                key={i}
                                                className="flex items-start gap-2 px-3 py-1.5 border-b border-vd-border last:border-b-0 text-[11px] cursor-pointer hover:bg-vd-bg-tertiary/50"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIdx.has(i)}
                                                    onChange={() => toggleSelected(i)}
                                                    disabled={!!importResult}
                                                    className="mt-0.5 accent-vd-accent-gold flex-shrink-0"
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-vd-text-primary truncate">{c.title}</div>
                                                    <div className="text-[9px] text-vd-text-tertiary truncate">
                                                        {c.kind && <span className="opacity-80 mr-1">[{c.kind}]</span>}
                                                        {c.source}
                                                    </div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            disabled={importing || selectedIdx.size === 0 || !!importResult}
                                            onClick={handleImport}
                                            className="px-3 py-1.5 text-[11px] font-medium border border-vd-accent-gold/40 text-vd-accent-gold rounded-md hover:bg-vd-accent-gold/10 disabled:opacity-50"
                                        >
                                            {importing ? 'Importing…' : `Import ${selectedIdx.size} ticket${selectedIdx.size === 1 ? '' : 's'}`}
                                        </button>
                                        {importResult && (
                                            <span className="text-[11px] text-emerald-400">
                                                ✓ Imported {importResult.imported} ticket{importResult.imported === 1 ? '' : 's'}
                                                {importResult.failed > 0 ? ` (${importResult.failed} failed)` : ''}.
                                            </span>
                                        )}
                                        {importError && <span className="text-[11px] text-red-400">{importError}</span>}
                                    </div>
                                </>
                            )}

                            {scanResult && scanResult.candidates.length === 0 && (
                                <p className="text-[10px] text-vd-text-tertiary">
                                    No candidates found — that's fine, your board will start empty. Click <em>Next</em> to continue.
                                </p>
                            )}
                        </div>
                    )}

                    {step === 4 && (
                        <div className="space-y-3">
                            <div>
                                <h3 className="text-sm font-semibold text-vd-text-primary mb-1">Git posture</h3>
                                <p className="text-[11px] text-vd-text-tertiary">No coding background needed — pick whichever feels right. You can change this later in Settings.</p>
                            </div>
                            <div className="space-y-2">
                                {([
                                    { id: 'experiment', label: "I'm just experimenting", help: "Local-only git history. Nothing leaves your machine. We'll run `git init` and write a sensible `.gitignore`." },
                                    { id: 'remote',     label: "I already have a remote", help: "Tell us the URL — we'll initialise git here and wire `origin` to your remote." },
                                    { id: 'github',     label: "Hook up to GitHub later", help: "Save the intent for now. We'll add a guided GitHub setup (create repo + push) in Settings post-launch." },
                                ] as Array<{ id: 'experiment'|'github'|'remote'; label: string; help: string }>).map(opt => (
                                    <label
                                        key={opt.id}
                                        className={`flex items-start gap-3 px-3 py-2 rounded-md border cursor-pointer ${gitPosture === opt.id ? 'border-vd-accent-gold bg-vd-accent-gold/10' : 'border-vd-border hover:border-vd-text-tertiary'}`}
                                    >
                                        <input
                                            type="radio"
                                            name="gitPosture"
                                            checked={gitPosture === opt.id}
                                            onChange={() => setGitPosture(opt.id)}
                                            className="mt-0.5 accent-vd-accent-gold"
                                        />
                                        <div className="flex-1">
                                            <div className="text-xs font-semibold text-vd-text-primary">{opt.label}</div>
                                            <div className="text-[10px] text-vd-text-tertiary">{opt.help}</div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                            {gitPosture === 'remote' && (
                                <input
                                    type="text"
                                    value={remoteUrl}
                                    onChange={(e) => setRemoteUrl(e.target.value)}
                                    placeholder="git@github.com:you/your-repo.git"
                                    className="w-full px-3 py-2 text-[12px] bg-vd-bg-input border border-vd-border rounded-md text-vd-text-primary placeholder:text-vd-text-tertiary focus:border-vd-accent-gold/60 focus:outline-none"
                                />
                            )}
                            {finishError && <p className="text-[11px] text-red-400">{finishError}</p>}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-vd-border">
                    <button
                        disabled={step === 1}
                        onClick={goBack}
                        className="px-3 py-1.5 text-[11px] font-medium border border-vd-border text-vd-text-secondary rounded-md hover:bg-vd-bg-tertiary disabled:opacity-30"
                    >
                        Back
                    </button>
                    {step < 4 ? (
                        <button
                            disabled={step === 1 && !canAdvanceFromStep1}
                            onClick={goNext}
                            className="px-3 py-1.5 text-[11px] font-medium bg-vd-accent-gold text-vd-text-inverse rounded-md hover:opacity-90 disabled:opacity-30"
                        >
                            Next
                        </button>
                    ) : (
                        <button
                            disabled={finishing || !gitPosture || (gitPosture === 'remote' && !remoteUrl.trim())}
                            onClick={handleFinish}
                            className="px-3 py-1.5 text-[11px] font-medium bg-vd-accent-gold text-vd-text-inverse rounded-md hover:opacity-90 disabled:opacity-30"
                        >
                            {finishing ? 'Finishing…' : 'Finish'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
