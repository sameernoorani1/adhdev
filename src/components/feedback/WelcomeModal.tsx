'use client';

import { useMemo, useState } from 'react';

interface WelcomeModalProps {
    demoTicketId: string | null;
    onClose: () => void;
    onRunDemo: (ticketId: string) => Promise<void> | void;
    onStartSetup: () => void;
}

const steps = [
    {
        eyebrow: 'Control plane',
        title: 'ADHDev keeps AI coding work visible.',
        body: 'Capture requests as tickets, keep the agent run attached to the work, and review the receipt before you close the loop.',
        points: [
            ['Tickets', 'Concrete work items with status, comments, screenshots, and execution history.'],
            ['Brain Dump', 'Fast capture for messy thoughts; Run Chat turns them into board actions.'],
            ['Batches', 'Group related tickets so an agent can handle a coherent pass.'],
        ],
    },
    {
        eyebrow: 'Connect',
        title: 'Start with your repo and a coding agent.',
        body: 'Pick a project folder, connect Codex, Claude, or another supported CLI, then choose the run mode you want ADHDev to use.',
        points: [
            ['Project folder', 'The board lives beside the code it controls.'],
            ['Agent status', 'The terminal button shows whether a shell, agent, or ticket run is active.'],
            ['Local first', 'Tickets and run receipts stay on this machine.'],
        ],
    },
    {
        eyebrow: 'Run loop',
        title: 'Run the ticket, then review the result.',
        body: 'When an agent is active, Run sends the selected ticket prompt into the terminal. If no agent is active, ADHDev opens the terminal flow instead of silently dropping the request.',
        points: [
            ['Run', 'Send one ticket or a batch to the connected agent.'],
            ['Receipt', 'The agent comments back with changed files, checks, and result.'],
            ['Review', 'You decide what is done, reopened, or closed.'],
        ],
    },
];

function StepIcon({ index }: { index: number }) {
    const paths = [
        'M5 5h14v14H5z M8 9h8 M8 13h5',
        'M4 7h16 M7 7v10a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7 M9 7V5h6v2',
        'M5 12h10 M12 5l7 7-7 7',
    ];
    return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={paths[index] || paths[0]} />
        </svg>
    );
}

export function WelcomeModal({ demoTicketId, onClose, onRunDemo, onStartSetup }: WelcomeModalProps) {
    const [step, setStep] = useState(0);
    const [running, setRunning] = useState(false);
    const current = steps[step];
    const isLast = step === steps.length - 1;
    const primaryLabel = useMemo(() => {
        if (!isLast) return 'Next';
        return demoTicketId ? 'Run demo ticket' : 'Connect an agent';
    }, [demoTicketId, isLast]);

    const handlePrimary = async () => {
        if (!isLast) {
            setStep(prev => Math.min(prev + 1, steps.length - 1));
            return;
        }
        if (demoTicketId) {
            if (running) return;
            setRunning(true);
            try {
                await onRunDemo(demoTicketId);
                onClose();
            } finally {
                setRunning(false);
            }
            return;
        }
        onClose();
        onStartSetup();
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-6">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

            <div className="relative w-full max-w-3xl max-h-[min(760px,calc(100vh-32px))] overflow-hidden rounded-xl border border-vd-border bg-vd-bg-secondary shadow-panel">
                <button
                    onClick={onClose}
                    aria-label="Close welcome"
                    className="absolute top-3 right-3 z-10 text-vd-text-tertiary hover:text-vd-text-primary text-lg leading-none"
                >
                    &times;
                </button>

                <div className="grid md:grid-cols-[0.82fr_1.18fr]">
                    <div className="bg-vd-bg-tertiary/70 border-b md:border-b-0 md:border-r border-vd-border p-5 md:p-6 flex flex-col justify-between gap-6">
                        <div>
                            <div className="text-[10px] uppercase tracking-[0.2em] text-vd-accent-gold font-semibold mb-3">Welcome to ADHDev</div>
                            <h2 className="text-2xl md:text-3xl font-semibold text-vd-text-primary leading-tight">Your AI workbench for shipping with agents.</h2>
                        </div>
                        <div className="space-y-2">
                            {steps.map((item, i) => (
                                <button
                                    key={item.eyebrow}
                                    type="button"
                                    onClick={() => setStep(i)}
                                    className={`w-full text-left flex items-center gap-3 rounded-md border px-3 py-2 transition-colors ${
                                        i === step
                                            ? 'border-vd-accent-gold bg-vd-accent-gold/10 text-vd-accent-gold'
                                            : 'border-vd-border text-vd-text-secondary hover:bg-vd-bg-secondary'
                                    }`}
                                >
                                    <span className="flex-shrink-0"><StepIcon index={i} /></span>
                                    <span className="min-w-0">
                                        <span className="block text-[11px] font-semibold">{item.eyebrow}</span>
                                        <span className="block text-[10px] text-vd-text-tertiary truncate">{item.title}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="p-5 md:p-7">
                        <div className="min-h-[300px]">
                            <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-vd-accent-gold font-semibold mb-3">
                                <StepIcon index={step} />
                                {current.eyebrow}
                            </div>
                            <h3 className="text-xl md:text-2xl font-semibold text-vd-text-primary leading-snug mb-3">{current.title}</h3>
                            <p className="text-sm text-vd-text-secondary leading-relaxed mb-5">{current.body}</p>

                            <div className="grid gap-3">
                                {current.points.map(([label, text]) => (
                                    <div key={label} className="rounded-md border border-vd-border bg-vd-bg-primary/50 px-3 py-2.5">
                                        <div className="text-xs font-semibold text-vd-text-primary">{label}</div>
                                        <div className="text-[11px] text-vd-text-tertiary mt-0.5 leading-relaxed">{text}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 pt-5 mt-5 border-t border-vd-border">
                            <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
                                {steps.map((_, i) => (
                                    <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-vd-accent-gold' : 'w-1.5 bg-vd-border'}`} />
                                ))}
                            </div>
                            <div className="flex items-center gap-2">
                                {step > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setStep(prev => Math.max(prev - 1, 0))}
                                        className="text-xs px-3 py-2 rounded-md border border-vd-border text-vd-text-secondary hover:bg-vd-bg-tertiary"
                                    >
                                        Back
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="text-xs px-3 py-2 rounded-md text-vd-text-secondary hover:bg-vd-bg-tertiary"
                                >
                                    Skip
                                </button>
                                <button
                                    type="button"
                                    onClick={handlePrimary}
                                    disabled={running}
                                    className="text-xs px-4 py-2 rounded-md bg-vd-accent-gold text-vd-text-inverse font-semibold hover:bg-vd-accent-gold-light disabled:opacity-50"
                                >
                                    {running ? 'Running...' : primaryLabel}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
