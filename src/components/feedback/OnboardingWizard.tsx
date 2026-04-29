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

export interface WizardOnboardingState {
    wizardCompleted?: boolean;
    wizardStep?: number;
    folderSource?: 'existing' | 'new' | null;
    folderPath?: string | null;
    agentDetected?: string | null;
    populated?: boolean;
    gitPosture?: 'experiment' | 'github' | 'remote' | null;
    remoteUrl?: string | null;
}

interface OnboardingWizardProps {
    initialState: WizardOnboardingState;
    onPatchOnboarding: (patch: Record<string, unknown>) => Promise<void> | void;
    onClose: () => void;
}

interface ScanCandidate { title: string; source: string }
interface ScanResult { candidates: ScanCandidate[]; files: string[]; cappedAt: number }

const RECOGNISED_CLIS: Array<{ id: string; label: string; installHint: string; runCommand: string }> = [
    { id: 'Claude Code', label: 'Claude Code', installHint: 'npm i -g @anthropic-ai/claude-code', runCommand: 'claude' },
    { id: 'Codex',       label: 'Codex',       installHint: 'npm i -g @openai/codex',          runCommand: 'codex' },
    { id: 'Gemini CLI',  label: 'Gemini CLI',  installHint: 'npm i -g @google/gemini-cli',     runCommand: 'gemini' },
    { id: 'Aider',       label: 'Aider',       installHint: 'pip install aider-chat',          runCommand: 'aider' },
    { id: 'Cursor Agent', label: 'Cursor Agent', installHint: 'Install Cursor (cursor.sh) — ships with cursor-agent', runCommand: 'cursor-agent' },
    { id: 'Continue',    label: 'Continue',    installHint: 'See continue.dev/install',        runCommand: 'continue' },
];

export function OnboardingWizard({ initialState, onPatchOnboarding, onClose }: OnboardingWizardProps) {
    const [step, setStep] = useState<number>(initialState.wizardStep || 1);
    const [folderSource, setFolderSource] = useState<'existing' | 'new' | null>(initialState.folderSource || null);
    const [folderPath, setFolderPath] = useState<string>(initialState.folderPath || '');
    const [parentPath, setParentPath] = useState<string>('');
    const [folderName, setFolderName] = useState<string>('');
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [agentDetected, setAgentDetected] = useState<string | null>(initialState.agentDetected || null);
    const [scanResult, setScanResult] = useState<ScanResult | null>(null);
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [gitPosture, setGitPosture] = useState<'experiment' | 'github' | 'remote' | null>(initialState.gitPosture || null);
    const [remoteUrl, setRemoteUrl] = useState<string>(initialState.remoteUrl || '');
    const [finishing, setFinishing] = useState(false);
    const [finishError, setFinishError] = useState<string | null>(null);

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

    const canAdvanceFromStep1 = folderSource && folderPath.trim().length > 0;

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
        } catch (err) {
            setScanError(String(err));
        } finally {
            setScanning(false);
        }
    };

    const handleFinish = async () => {
        setFinishError(null);
        setFinishing(true);
        try {
            // Run the git posture endpoint if posture is set. "experiment"
            // actually runs `git init` + writes .gitignore. The other two
            // record intent only for now.
            if (gitPosture && folderPath) {
                await fetch('/api/onboarding/git-init', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderPath, posture: gitPosture, remoteUrl }),
                });
            }
            await persist({
                wizardCompleted: true,
                wizardStep: 4,
                folderSource,
                folderPath,
                agentDetected,
                populated: !!scanResult && scanResult.candidates.length > 0,
                gitPosture,
                remoteUrl: remoteUrl || null,
                welcomeSeen: true,  // satisfies the existing AD-073 dismissal pattern
            } as Record<string, unknown>);
            onClose();
        } catch (err) {
            setFinishError(String(err));
        } finally {
            setFinishing(false);
        }
    };

    const handleSkipAll = async () => {
        await persist({ wizardCompleted: true, welcomeSeen: true } as Record<string, unknown>);
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

    const totalSteps = folderSource === 'new' ? 3 : 4;
    const visualStep = (() => {
        if (folderSource !== 'new') return step;
        if (step <= 2) return step;
        return 3; // collapse step 4 into "step 3 of 3" for the new-folder path
    })();

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div className="relative bg-vd-bg-secondary border border-vd-border w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden rounded-xl shadow-panel">
                {/* Header */}
                <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-vd-border">
                    <div>
                        <h2 className="text-sm font-semibold text-vd-text-primary">Welcome to ADHDev</h2>
                        <p className="text-[10px] text-vd-text-tertiary mt-0.5">Step {visualStep} of {totalSteps}</p>
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
                                    <label className="text-[11px] text-vd-text-secondary">Absolute path to the folder</label>
                                    <input
                                        type="text"
                                        autoFocus
                                        value={folderPath}
                                        onChange={(e) => setFolderPath(e.target.value)}
                                        placeholder="C:\Codebases\my-project   or   /Users/you/code/my-project"
                                        className="w-full px-3 py-2 text-[12px] bg-vd-bg-input border border-vd-border rounded-md text-vd-text-primary placeholder:text-vd-text-tertiary focus:border-vd-accent-gold/60 focus:outline-none"
                                    />
                                    <p className="text-[10px] text-vd-text-tertiary">Tip: pick somewhere outside Downloads / OneDrive — git history doesn't love sync conflicts.</p>
                                </div>
                            )}

                            {folderSource === 'new' && (
                                <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-[11px] text-vd-text-secondary">Parent path</label>
                                            <input
                                                type="text"
                                                value={parentPath}
                                                onChange={(e) => setParentPath(e.target.value)}
                                                placeholder="C:\Codebases   or   /Users/you/code"
                                                className="w-full mt-1 px-3 py-2 text-[12px] bg-vd-bg-input border border-vd-border rounded-md text-vd-text-primary placeholder:text-vd-text-tertiary focus:border-vd-accent-gold/60 focus:outline-none"
                                            />
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
                            <div>
                                <h3 className="text-sm font-semibold text-vd-text-primary mb-1">Connect a coding agent</h3>
                                <p className="text-[11px] text-vd-text-tertiary">Open the in-app terminal (the button up top) and run one of these. We'll glow the row when we see it.</p>
                            </div>
                            <div className="space-y-1.5">
                                {RECOGNISED_CLIS.map(cli => {
                                    const detected = agentDetected === cli.id;
                                    return (
                                        <div key={cli.id} className={`flex items-center gap-3 px-3 py-2 rounded-md border ${detected ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-vd-border'}`}>
                                            <div className={`w-2 h-2 rounded-full ${detected ? 'bg-emerald-400' : 'bg-vd-text-tertiary/40'}`} />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-semibold text-vd-text-primary">{cli.label}</div>
                                                <div className="text-[10px] text-vd-text-tertiary">Run <code className="text-vd-text-secondary">{cli.runCommand}</code> in the terminal — install via <code className="text-vd-text-secondary">{cli.installHint}</code></div>
                                            </div>
                                            {detected && <span className="text-[10px] font-semibold text-emerald-400">Detected</span>}
                                        </div>
                                    );
                                })}
                            </div>
                            <p className="text-[10px] text-vd-text-tertiary">You can also click <em>Next</em> now and connect later — the wizard saves your progress.</p>
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
                                <div className="border border-vd-border rounded-md max-h-56 overflow-y-auto bg-vd-bg-tertiary/30">
                                    {scanResult.candidates.map((c, i) => (
                                        <div key={i} className="px-3 py-1.5 border-b border-vd-border last:border-b-0 text-[11px]">
                                            <div className="text-vd-text-primary">{c.title}</div>
                                            <div className="text-[9px] text-vd-text-tertiary">{c.source}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {scanResult && (
                                <p className="text-[10px] text-vd-text-tertiary">
                                    Importing draft tickets is the next ticket I'll pick up — for now we just record the scan result. Click <em>Next</em> to continue.
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
                                    { id: 'github',     label: "Hook up to GitHub now",  help: "Records your intent to publish to GitHub. (Actually creating the repo is wired in a follow-up — for now we just save your choice.)" },
                                    { id: 'remote',     label: "I already have a remote", help: "Tell us the URL and we'll wire it up later. Your choice + URL get saved now." },
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
                            disabled={finishing || !gitPosture}
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
