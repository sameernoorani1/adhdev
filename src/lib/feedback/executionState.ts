// AD-149 permanent fix: single source of truth for the running indicator.
// The server-side heartbeat loop (see server/terminal.mjs) owns all writes
// to `execution.status`. It bumps `updatedAt` every 10 s for live runs and
// auto-completes executions when the active set clears.
//
// Client rule: `execution.status === 'in_progress'` AND `updatedAt` is fresh.
// The freshness check is a defensive backstop — if the heartbeat isn't
// firing (server crash mid-run, pre-heartbeat legacy record, network
// partition), the indicator self-heals within ~45 s of the last heartbeat.
// The heartbeat cadence is 10 s, so 45 s tolerates four missed heartbeats.

interface ExecutionShape {
    status?: string | null;
    updatedAt?: string | null;
}

interface TicketExecutionShape {
    id: string;
    status: string;
    execution?: ExecutionShape | null;
}

// 45 s = 4.5 × heartbeat interval. Tolerates missed heartbeats + network lag
// without letting stale records light up forever.
const HEARTBEAT_STALE_MS = 45 * 1000;

export function isTicketExecutionActive(
    ticket: TicketExecutionShape,
    // Kept in the signature so existing callers compile without changes. The
    // value is ignored — the live poll is no longer part of the authoritative
    // signal.
    activeExecutionIds?: Iterable<string> | null,
): boolean {
    // AD-341: the done/reviewed guard must run FIRST — before the
    // activeExecutionIds membership check. The terminal's captureTicketIds can
    // still list a ticket the agent just PATCHed to `done` (the terminal clears
    // its own active set lazily, on turn-end / timeout — it doesn't know about
    // the board-side done PATCH). Without this ordering, a finished Run kept
    // animating "Running" off that stale terminal list until the terminal
    // cleared it ~2 min later. A done/reviewed ticket is never running, period.
    // (AD-232: same guard also covers the AD-284 write race that leaves
    // execution.status stuck as 'in_progress' after the status flip.)
    if (ticket.status === 'done' || ticket.status === 'reviewed') return false;
    if (activeExecutionIds) {
        const id = String(ticket.id || '').toUpperCase();
        for (const activeId of activeExecutionIds) {
            if (String(activeId || '').toUpperCase() === id) return true;
        }
    }
    if (ticket.execution?.status !== 'in_progress') return false;
    const updatedAtRaw = ticket.execution?.updatedAt;
    if (!updatedAtRaw) return false;
    const updatedAt = new Date(updatedAtRaw).getTime();
    if (Number.isNaN(updatedAt)) return false;
    return Date.now() - updatedAt < HEARTBEAT_STALE_MS;
}

// AD-196: freshness-free variant for the mascot animation. The 45 s
// heartbeat-stale window in `isTicketExecutionActive` is the right gate for
// the running *pill* (loud, easy to notice when stuck). The mascot
// animation by contrast is a small visual flourish — and we noticed
// the opposite failure mode: the heartbeat pauses during agent_idle gaps
// (a known heuristic-misfire pattern documented in server/terminal.mjs
// AUTO_COMPLETE_ON_CLEAR_REASONS), the freshness check fails, and the
// mascot stops while the agent is genuinely still working between AI
// comments. For the mascot, just bind to `execution.status` directly: the
// animation runs as long as the canonical status is in_progress. Stuck
// tickets after a hard server crash get cleaned by `recoverStaleInProgressTickets`
// at next startup.
export function isTicketExecutionInProgress(ticket: TicketExecutionShape): boolean {
    // AD-232: same defensive gate as isTicketExecutionActive — a ticket whose
    // work status is done/reviewed cannot legitimately have a still-running
    // execution. The AD-284 cross-process write race intermittently leaves
    // execution.status stuck as 'in_progress' after the status flip; without
    // this guard the mascot would animate on a closed ticket until the next
    // server-side sweep (~30 s) or page reload.
    if (ticket.status === 'done' || ticket.status === 'reviewed') return false;
    return ticket.execution?.status === 'in_progress';
}
