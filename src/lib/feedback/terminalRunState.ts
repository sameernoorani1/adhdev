import type { FeedbackData } from './core';
import { applyCaptureHeartbeat } from './captureHeartbeat';
import { ACTIVE_RUN_STATUSES, heartbeatActiveRuns } from './runs';

function idSet(ticketIds: string[]): Set<string> {
    return new Set((ticketIds || []).map(id => String(id || '').toUpperCase()).filter(Boolean));
}

function overlaps(runTicketIds: unknown, ids: Set<string>): boolean {
    if (!Array.isArray(runTicketIds) || ids.size === 0) return false;
    return runTicketIds.some(id => ids.has(String(id || '').toUpperCase()));
}

export function applyTerminalHeartbeat(
    data: FeedbackData,
    ticketIds: string[],
    nowIso: string,
    runId?: string | null,
): boolean {
    const ticketChanged = applyCaptureHeartbeat(data, ticketIds, nowIso);
    const runChanged = heartbeatActiveRuns(data, ticketIds, nowIso, runId);
    return ticketChanged || runChanged;
}

export function markTerminalActiveRunsCleared(
    data: FeedbackData,
    ticketIds: string[],
    reason: string,
    nowIso: string,
): boolean {
    if (!Array.isArray(data.activeRuns)) return false;
    const ids = idSet(ticketIds);
    const status = reason === 'interrupted' ? 'interrupted' : 'stale';
    let changed = false;

    for (const run of data.activeRuns) {
        if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
        if (!overlaps(run.ticketIds, ids)) continue;
        run.status = status;
        run.updatedAt = nowIso;
        run.completedAt = nowIso;
        run.blocker = run.blocker || (reason === 'interrupted'
            ? 'Interrupted by user (Esc / Ctrl+C).'
            : `Recovered: terminal run cleared (${reason}).`);
        changed = true;
    }

    return changed;
}

export function markTerminalTicketsInterrupted(
    data: FeedbackData,
    ticketIds: string[],
    nowIso: string,
): boolean {
    if (!Array.isArray(data.tickets)) return false;
    const ids = idSet(ticketIds);
    let changed = false;

    for (const ticket of data.tickets) {
        if (!ids.has(String(ticket.id || '').toUpperCase())) continue;
        if (ticket.execution?.status !== 'in_progress') continue;

        ticket.execution = {
            ...ticket.execution,
            status: 'blocked',
            updatedAt: nowIso,
            blocker: ticket.execution.blocker || 'Interrupted by user (Esc / Ctrl+C).',
        };
        ticket.activity = [
            ...(ticket.activity || []),
            {
                action: 'execution_interrupted',
                by: ticket.execution.actor || 'Coding Agent',
                byType: 'ai',
                at: nowIso,
            },
        ];
        ticket.updatedAt = nowIso;
        changed = true;
    }

    return changed;
}

// AD-303: when a run auto-completes via the watchdog path (timed_out /
// detection_stale / shell_exited / max_runtime_exceeded), the agent went
// silent without posting a closing comment. The activity entry alone is
// easy to miss in the timeline — the ticket's comment trail still shows
// only the auto-injected "Claiming ticket" line, so the user is left
// thinking nothing happened. Surface a one-line system comment so the
// silent-end is visible where the user is actually reading.
const SILENT_END_REASON_BLURB: Record<string, string> = {
    timed_out: 'no shell output for 2 min',
    detection_stale: 'no agent-detection signal for 60s',
    shell_exited: 'terminal shell exited',
    max_runtime_exceeded: 'exceeded the 60-min run ceiling',
};

function buildSilentEndCommentContent(reason: string): string {
    const blurb = SILENT_END_REASON_BLURB[reason] || `auto-cleared (${reason})`;
    return `⚠ Run auto-cleared — ${blurb} — without the agent posting a closing comment. Any work done during the run is only in the terminal scrollback.`;
}

export function autoCompleteTerminalTickets(
    data: FeedbackData,
    ticketIds: string[],
    reason: string,
    nowIso: string,
): boolean {
    if (!Array.isArray(data.tickets)) return false;
    const ids = idSet(ticketIds);
    let changed = false;

    for (const ticket of data.tickets) {
        if (!ids.has(String(ticket.id || '').toUpperCase())) continue;
        const prior = ticket.execution;
        if (prior?.status !== 'in_progress') continue;

        ticket.execution = {
            ...prior,
            status: 'done',
            result: 'success',
            completedAt: nowIso,
            updatedAt: nowIso,
        };
        ticket.activity = [
            ...(ticket.activity || []),
            {
                action: 'execution_completed',
                by: prior.actor || 'Coding Agent',
                byType: 'ai',
                at: nowIso,
                reason,
            },
        ];
        ticket.comments = [
            ...(ticket.comments || []),
            {
                id: `c-silent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                author: prior.actor || 'ADHDev',
                authorType: 'system',
                content: buildSilentEndCommentContent(reason),
                images: [],
                createdAt: nowIso,
            },
        ];
        ticket.updatedAt = nowIso;
        changed = true;
    }

    return changed;
}

export function recoverTerminalRestartState(
    data: FeedbackData,
    nowIso: string,
): boolean {
    let changed = false;

    if (Array.isArray(data.activeRuns)) {
        for (const run of data.activeRuns) {
            if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
            run.status = 'stale';
            run.updatedAt = nowIso;
            run.completedAt = nowIso;
            run.blocker = run.blocker || 'Terminal server restarted while run was in progress.';
            changed = true;
        }
    }

    if (Array.isArray(data.tickets)) {
        for (const ticket of data.tickets) {
            if (ticket.execution?.status !== 'in_progress') continue;
            ticket.execution = {
                ...ticket.execution,
                status: 'blocked',
                updatedAt: nowIso,
                blocker: ticket.execution.blocker || 'Terminal server restarted while run was in progress.',
            };
            ticket.updatedAt = nowIso;
            changed = true;
        }
    }

    return changed;
}
