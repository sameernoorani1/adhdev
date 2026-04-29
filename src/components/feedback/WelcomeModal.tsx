'use client';

// AD-136: First-run welcome screen. Single modal, three sections (intro /
// core loop / CTA), no multi-step tour. Shown once — dismissal flips
// `onboardingState.welcomeSeen` in .adhdev/config.json.

import { useState } from 'react';

interface WelcomeModalProps {
    demoTicketId: string | null;
    onClose: () => void;
    onRunDemo: (ticketId: string) => Promise<void> | void;
}

export function WelcomeModal({ demoTicketId, onClose, onRunDemo }: WelcomeModalProps) {
    const [running, setRunning] = useState(false);

    const handleRunDemo = async () => {
        if (!demoTicketId || running) return;
        setRunning(true);
        try {
            await onRunDemo(demoTicketId);
        } finally {
            setRunning(false);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

            <div className="relative bg-vd-bg-secondary border border-vd-border rounded-xl shadow-panel w-full max-w-lg mx-4 p-7">
                <button
                    onClick={onClose}
                    aria-label="Close welcome"
                    className="absolute top-3 right-3 text-vd-text-tertiary hover:text-vd-text-primary text-lg leading-none"
                >
                    ×
                </button>

                {/* Intro — painpoint first, then what ADHDev actually is, then the emotional hook. */}
                <div className="mb-5">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-vd-accent-gold font-semibold mb-2">
                        Welcome to ADHDev
                    </div>
                    <h2 className="text-xl font-semibold text-vd-text-primary mb-3 leading-snug">
                        Claude Code writes the code.<br />
                        <span className="text-vd-accent-gold">ADHDev runs the project.</span>
                    </h2>
                    <div className="space-y-3 text-sm text-vd-text-secondary leading-relaxed">
                        <p>
                            You open a chat, describe a fix, watch Claude do it, close the tab. Repeat.
                            By Friday you can't remember what you shipped, what broke, or what you
                            meant to come back to. Half your AI work is invisible — even to you.
                        </p>
                        <p>
                            <span className="text-vd-text-primary font-medium">ADHDev is the missing control plane.</span>{' '}
                            Every idea becomes a ticket. Every ticket is one click from running.
                            Every run writes back what changed and why. Nothing gets lost. Nothing
                            gets merged without you seeing it.
                        </p>
                        <p>
                            <span className="text-vd-text-primary font-medium">And it's yours.</span>{' '}
                            Your repo. Your board. Your machine. No SaaS, no login,
                            no queue. Your tickets never leave your laptop.
                        </p>
                        <p className="text-xs text-vd-text-tertiary pt-1 italic">
                            Sixty seconds from here to your first AI commit. Let's go.
                        </p>
                    </div>
                </div>

                {/* Core loop */}
                <div className="mb-6 rounded-lg border border-vd-border/60 bg-vd-bg-tertiary/40 p-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-vd-text-tertiary font-semibold mb-2">
                        The core loop
                    </div>
                    <ol className="text-sm text-vd-text-secondary space-y-1.5">
                        <li><span className="text-vd-accent-gold font-mono mr-2">1.</span>Write a ticket</li>
                        <li><span className="text-vd-accent-gold font-mono mr-2">2.</span>Click Run — Claude picks it up</li>
                        <li><span className="text-vd-accent-gold font-mono mr-2">3.</span>Claude comments back with what it did</li>
                        <li><span className="text-vd-accent-gold font-mono mr-2">4.</span>Review the diff and move to done</li>
                    </ol>
                </div>

                {/* CTA */}
                <div className="flex items-center justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="text-xs px-3 py-2 rounded-lg text-vd-text-secondary hover:bg-vd-bg-tertiary"
                    >
                        Skip for now
                    </button>
                    <button
                        onClick={handleRunDemo}
                        disabled={!demoTicketId || running}
                        className="text-xs px-4 py-2 rounded-lg bg-vd-accent-gold text-vd-text-inverse font-semibold hover:bg-vd-accent-gold-light disabled:opacity-50 disabled:cursor-not-allowed"
                        title={demoTicketId ? `Run ${demoTicketId}` : 'No demo ticket seeded'}
                    >
                        {running ? 'Running…' : 'Run the demo ticket'}
                    </button>
                </div>
            </div>
        </div>
    );
}
