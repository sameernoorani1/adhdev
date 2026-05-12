// AD-216: pure rules for `clearActiveRunTickets` extracted so they can be
// unit-tested without importing terminal.mjs (which boots a WS server on
// import). terminal.mjs imports the same constants from here so behavior
// stays single-sourced.

// Reasons that indicate the agent is genuinely gone — safe to auto-complete
// any tickets that were still in_progress.
//   - shell_exited: the shell process is dead. Nothing is going to PATCH this
//     ticket from this session anymore.
//   - detection_stale: the heartbeat hasn't seen any agent output in a long
//     time AND we already saw earlier that the agent had exited (see AD-156
//     reopen #2).
//   - timed_out: ACTIVE_RUN_TTL_MS (2 min) of no shell output at all — strong
//     signal the run is dead.
//   - max_runtime_exceeded: AD-221 watchdog. If a run has been in_progress
//     longer than MAX_RUN_DURATION_MS without natural completion, the
//     agent has crashed silently or was forgotten — drop the mascot so it
//     doesn't haunt the board indefinitely.
// Heuristic triggers (`shell_prompt`, `agent_idle`) used to auto-complete too,
// but in practice they fired mid-run: a chunk happened to end with a
// shell-prompt-shaped string, or the busy markers paused briefly between
// tickets — and the FE running pill dropped on tickets the agent hadn't
// finished posting comments/PATCH for. Now those reasons just clear the
// active set + stop the heartbeat; execution.status stays `in_progress`
// until the agent's own PATCH lands.
export const AUTO_COMPLETE_ON_CLEAR_REASONS = new Set([
    'shell_exited',
    'detection_stale',
    'timed_out',
    'max_runtime_exceeded',
]);

const ACTIVE_RUN_STATUSES = new Set(['dispatching', 'running', 'finishing']);

/**
 * Decides whether `clearActiveRunTickets(session, reason)` should
 * auto-complete the still-active executions for the given reason.
 * Returns false for `interrupted` (callers handle that semantically before
 * clearing) and for any reason not in the auto-complete set.
 */
export function shouldAutoCompleteOnClear(reason) {
    if (reason === 'interrupted') return false;
    return AUTO_COMPLETE_ON_CLEAR_REASONS.has(reason);
}

/**
 * AD-270: the max-runtime watchdog must read the live run lease, not the
 * ticket's durable execution receipt. Reopened tickets commonly carry an old
 * execution.startedAt from a completed run; using that old timestamp makes a
 * fresh active run look older than the max runtime and clears the animation
 * even while the terminal agent is still running.
 *
 * @param {unknown} boardData
 * @param {unknown[]} ticketIds
 * @param {number} cutoffMs
 * @param {string | null} [runId]
 */
export function hasActiveRunExceededMaxDuration(boardData, ticketIds, cutoffMs, runId = null) {
    if (!boardData || !Array.isArray(boardData.activeRuns)) return false;
    if (!Array.isArray(ticketIds) || ticketIds.length === 0) return false;
    if (!Number.isFinite(cutoffMs)) return false;

    const ids = new Set(ticketIds.map(id => String(id || '').toUpperCase()).filter(Boolean));
    if (ids.size === 0) return false;

    for (const run of boardData.activeRuns) {
        if (!run || !ACTIVE_RUN_STATUSES.has(run.status)) continue;
        if (runId && run.runId !== runId) continue;
        const runTicketIds = Array.isArray(run.ticketIds) ? run.ticketIds : [];
        if (!runTicketIds.some(id => ids.has(String(id || '').toUpperCase()))) continue;

        const startedMs = new Date(run.startedAt || run.updatedAt || '').getTime();
        if (Number.isFinite(startedMs) && startedMs < cutoffMs) return true;
    }

    return false;
}
