// AD-244: shared heartbeat helper for the terminal-status poll.
//
// Heartbeat-ONLY: bumps `execution.updatedAt` on tickets whose execution is
// already `in_progress`. Never creates an execution row, never mutates
// status. The contract mirrors the AD-232 fix in
// `feedback/[id]/comments/route.ts`: running state must come from an
// explicit Run trigger (UI button → /api/run, or the terminal server's own
// `bumpExecutionForActiveTickets` on /execute with ticketIds). Polls don't.
//
// Pinned by tests/lib/feedback/captureHeartbeat.test.ts so a future refactor
// that re-adds the create-on-poll branch trips the suite.

import type { FeedbackData } from './core';

export function applyCaptureHeartbeat(
    data: FeedbackData,
    ticketIdsToBump: string[],
    nowIso: string,
): boolean {
    if (!Array.isArray(data?.tickets) || ticketIdsToBump.length === 0) return false;
    const idSet = new Set(ticketIdsToBump.map(id => String(id).toUpperCase()));
    let changed = false;
    for (const ticket of data.tickets) {
        if (!idSet.has(String(ticket.id || '').toUpperCase())) continue;
        const prior = ticket.execution;
        if (prior?.status !== 'in_progress') continue;
        ticket.execution = { ...prior, updatedAt: nowIso };
        ticket.updatedAt = nowIso;
        changed = true;
    }
    return changed;
}
