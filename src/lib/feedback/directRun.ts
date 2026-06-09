// AD-269 / AD-338: decide whether an AI comment STARTS running state (mascot +
// pill) on a ticket. This is the comment-path complement to the agent-claim
// endpoint — when an agent posts a claim/plan comment (instead of, or before,
// calling agent-claim), the animation must still fire reliably.
//
// Why there is NO "is the agent live?" gate any more: a claim/plan comment IS an
// agent declaring it is working — posting it proves an agent is there. The old
// agentLive gate (a cross-process probe of the terminal /status) was the
// FALSE-NEGATIVE behind "claimed but no animation": when the terminal server
// wasn't restarted / mis-reported, a real claim opened nothing. Accuracy is the
// CLOSE's job (process-exit / done / stale), not the open's. The guards that stay:
//   - only on an ACTIVE ticket (never done/reviewed/observe/deferred — the
//     AD-221/AD-244 "auto-claim resurrected a finished ticket" regression),
//   - never when already running (the heartbeat path owns that),
//   - only on a real CLAIM/PLAN comment — not analysis/discussion/completion, so
//     ordinary comments don't spuriously light the animation.

const NON_START_MARKERS = [
    'implementation complete',
    'completion note',
    'completion summary',
    'workflow blocker',
    'blocked by',
    'reopening',
    'reopen —',
    'reopen -',
];

// Markers that an AI comment is CLAIMING / planning work (vs. merely discussing
// it). The standard claim comment is "**Claiming ticket.**"; plan comments lead
// with a plan. Match intent, not just "any non-completion text".
const CLAIM_MARKERS = [
    'claiming ticket',
    'claiming ',
    '**claim',
    'picking it up',
    'picking up',
    'picked up',
    'plan:',
    '**plan',
    "i'll start",
    'i will start',
    'starting work',
    'will inspect',
    'will implement',
    'will fix',
    'will work on',
    'will analyze',
];

const ACTIVE_TICKET_STATUSES = new Set(['todo', 'in_progress', 'reopen']);

/** True for a real claim/plan comment (not analysis/discussion, not completion). */
export function isClaimComment(content: string): boolean {
    const c = (content || '').toLowerCase();
    if (!c.trim()) return false;
    if (NON_START_MARKERS.some(m => c.includes(m))) return false;
    return CLAIM_MARKERS.some(m => c.includes(m));
}

export interface DirectRunStartInput {
    content: string;
    ticketStatus: string;
    priorExecutionStatus?: string | null;
}

export function shouldStartDirectRun(input: DirectRunStartInput): boolean {
    if (input.priorExecutionStatus === 'in_progress') return false; // already running
    if (!ACTIVE_TICKET_STATUSES.has(input.ticketStatus)) return false;
    return isClaimComment(input.content);
}
