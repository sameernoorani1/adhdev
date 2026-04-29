'use client';

// AD-136: Pinned activation checklist. Four items, ticked purely off board
// state + onboardingEvents. No nag — hides itself when all four complete
// or the user explicitly dismisses.

import { Ticket } from './TicketCard';

interface ActivationChecklistProps {
    tickets: Ticket[];
    events: Record<string, string>;
    dismissed: boolean;
    onDismiss: () => void;
}

interface Item {
    key: string;
    label: string;
    done: boolean;
}

function computeItems(tickets: Ticket[], events: Record<string, string>): Item[] {
    const demoRan = tickets.some(t => t.ticketType === 'onboarding' && t.status === 'done');
    const createdReal = Boolean(events.firstUserTicketAt);
    // AD-138's firstRunAt would be cleanest, but it gets set on ANY run — demo or real.
    // Instead: check whether any non-onboarding ticket has an execution record at all.
    const ranReal = tickets.some(t => t.ticketType !== 'onboarding' && !!t.execution);
    const reviewed = tickets.some(t => t.status === 'reviewed');
    return [
        { key: 'demo',     label: 'Ran the demo ticket',       done: demoRan },
        { key: 'created',  label: 'Created your first real ticket', done: createdReal },
        { key: 'ran',      label: 'Ran your first real ticket', done: ranReal },
        { key: 'reviewed', label: 'Moved a ticket to reviewed', done: reviewed },
    ];
}

export function ActivationChecklist({ tickets, events, dismissed, onDismiss }: ActivationChecklistProps) {
    if (dismissed) return null;
    const items = computeItems(tickets, events);
    const allDone = items.every(i => i.done);
    if (allDone) return null;

    return (
        <div className="mt-4 rounded-lg border border-vd-border/60 bg-vd-bg-tertiary/30 p-3">
            <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-vd-accent-gold font-semibold">
                    Get started
                </div>
                <button
                    onClick={onDismiss}
                    aria-label="Dismiss onboarding checklist"
                    className="text-[10px] text-vd-text-tertiary hover:text-vd-text-secondary"
                >
                    Dismiss
                </button>
            </div>
            <ul className="space-y-1.5">
                {items.map(item => (
                    <li key={item.key} className="flex items-center gap-2 text-xs">
                        <span
                            className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                                item.done
                                    ? 'bg-emerald-500/25 text-emerald-300'
                                    : 'border border-vd-border bg-vd-bg-secondary'
                            }`}
                            aria-label={item.done ? 'Complete' : 'Incomplete'}
                        >
                            {item.done && (
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </span>
                        <span className={item.done ? 'text-vd-text-tertiary line-through' : 'text-vd-text-secondary'}>
                            {item.label}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
