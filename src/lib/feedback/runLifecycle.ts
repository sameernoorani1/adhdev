// AD-269: the single, canonical running-state lifecycle.
//
// The rule, in one line: a ticket ANIMATES (running mascot / pill) only when it
// has an OPEN, CLAIMED lease — never because a prompt was merely dispatched.
//
//   dispatch  → lease status 'dispatching'  → NOT running (prompt sent, no agent
//                                              has confirmed it). Self-expires via
//                                              sweepStaleRuns if no claim arrives.
//   claim     → lease status 'running'       → running. The agent declaring it is
//                                              working (agent-claim, a live claim
//                                              comment, etc.) is the ONLY start.
//   close     → done/blocked/interrupted/    → NOT running. Driven by explicit
//               failed/stale                    completion, process-exit, interrupt,
//                                              or heartbeat staleness.
//
// This replaces the old "mark running the instant the prompt is sent" behaviour
// (markRunSubmitted), which lit the animation even when no agent was there to
// pick it up — the flaky false-positive.

import type { FeedbackData, FeedbackRun } from './core';
import { ACTIVE_RUN_STATUSES, createRunRecord, upsertRun } from './runs';

// The lease statuses that mean "an agent is actually working this ticket now".
// 'dispatching' is deliberately excluded — that is "sent, awaiting a claim".
export const RUNNING_LEASE_STATUSES = new Set<FeedbackRun['status']>(['running', 'finishing']);

/** The single source of truth for which tickets are running (animated). */
export function deriveRunningTicketIds(data: Pick<FeedbackData, 'activeRuns'>): string[] {
    if (!Array.isArray(data.activeRuns)) return [];
    const ids = new Set<string>();
    for (const run of data.activeRuns) {
        if (!RUNNING_LEASE_STATUSES.has(run.status)) continue;
        for (const id of run.ticketIds || []) ids.add(String(id).toUpperCase());
    }
    return Array.from(ids);
}

export function isTicketRunning(data: Pick<FeedbackData, 'activeRuns'>, ticketId: string): boolean {
    const normalized = String(ticketId || '').toUpperCase();
    if (!normalized) return false;
    return deriveRunningTicketIds(data).includes(normalized);
}

/**
 * Dispatch: the prompt was SENT into the terminal. Keep the lease 'dispatching'
 * — it animates nothing. It promotes to 'running' only when the agent actually
 * claims, and self-expires (sweepStaleRuns, RUN_DISPATCH_STALE_MS) if no claim
 * ever arrives. Returns false if the run record doesn't exist.
 */
export function markRunSent(
    data: FeedbackData,
    runId: string,
    nowIso: string,
    terminalSessionId?: string | null,
): boolean {
    if (!Array.isArray(data.activeRuns)) data.activeRuns = [];
    const run = data.activeRuns.find(r => r.runId === runId);
    if (!run) return false;
    // Only a not-yet-claimed lease stays 'dispatching'. If a claim already
    // promoted it to 'running' (race: agent claimed before /execute returned),
    // leave it running — never demote a confirmed run back to dispatching.
    if (run.status === 'dispatching') {
        run.dispatchResult = 'sent';
        run.updatedAt = nowIso;
        run.lastHeartbeatAt = nowIso;
        if (terminalSessionId) run.terminalSessionId = terminalSessionId;
    }
    return true;
}

/**
 * Claim: the agent declares it is working these tickets — the ONLY thing that
 * starts running state, regardless of how the work was initiated (Run button,
 * batch, direct ADHDev terminal, external terminal). Promotes a matching
 * still-open lease to 'running', or opens a fresh 'running' lease.
 */
export function claimRun(
    data: FeedbackData,
    params: {
        ticketIds: string[];
        agent: string;
        source: FeedbackRun['source'];
        nowIso: string;
        projectId?: string | null;
        runId?: string;
        startedRef?: string;
    },
): FeedbackRun {
    if (!Array.isArray(data.activeRuns)) data.activeRuns = [];
    const wanted = new Set(params.ticketIds.map(id => String(id).toUpperCase()).filter(Boolean));

    // Promote an existing open (dispatching/running/finishing) lease that already
    // covers one of these tickets — so a UI dispatch's lease becomes the running
    // one rather than spawning a duplicate.
    const existing = data.activeRuns.find(run =>
        ACTIVE_RUN_STATUSES.has(run.status) &&
        (run.ticketIds || []).some(id => wanted.has(String(id).toUpperCase())));
    if (existing) {
        existing.status = 'running';
        existing.agent = params.agent || existing.agent;
        existing.updatedAt = params.nowIso;
        existing.lastHeartbeatAt = params.nowIso;
        existing.dispatchResult = existing.dispatchResult === 'sent' ? 'claimed' : (existing.dispatchResult || 'claimed');
        existing.failure = null;
        existing.blocker = null;
        return existing;
    }

    const runId = params.runId || `claim-${Date.now().toString(36)}-${[...wanted].join('-').toLowerCase()}`;
    const run = createRunRecord({
        runId,
        projectId: params.projectId ?? null,
        ticketIds: [...wanted],
        agent: params.agent,
        nowIso: params.nowIso,
        startedRef: params.startedRef,
        source: params.source,
    });
    run.status = 'running';
    run.dispatchResult = 'claimed';
    run.lastHeartbeatAt = params.nowIso;
    upsertRun(data, run);
    return run;
}
