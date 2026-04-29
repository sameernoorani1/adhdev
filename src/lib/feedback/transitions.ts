import type { AgentRules, FeedbackTicket } from './core';

export interface TransitionResult {
    allowed: boolean;
    error?: string;
}

const PLAN_KEYWORDS = ['plan', 'proposal', 'approach', 'proposed', 'recommend', 'strategy'];

/** Keywords that indicate an actual code fix was shipped (not just discussion) */
const FIX_KEYWORDS = [
    'fix', 'fixed', 'implemented', 'shipped', 'deployed', 'updated', 'changed',
    'added', 'removed', 'refactored', 'patched', 'resolved', 'build ',
    'commit', 'merged', 'released',
];

/** Keywords that indicate discussion/planning only (no fix shipped) */
const DISCUSSION_KEYWORDS = [
    'deferred', 'defer', 'will fix', 'plan to', 'going to', 'suggest',
    'analysis', 'investigation', 'looking into', 'no action', 'no further action',
    'no code change', 'discussion only', 'acknowledged',
];
const AI_ALLOWED_TARGET_STATUSES = new Set(['todo', 'reopen', 'done']);

/**
 * Check if the AI agent has posted ANY comment on this ticket.
 * This is the hard gate: agents cannot move a ticket to "done" without
 * first leaving a comment explaining what they did.
 */
function hasAiComment(comments: FeedbackTicket['comments']): boolean {
    return comments.some(c => c.authorType === 'ai');
}

function hasPlanComment(comments: FeedbackTicket['comments']): boolean {
    for (const c of comments) {
        if (c.authorType !== 'ai') continue;
        const lower = c.content.toLowerCase();
        if (PLAN_KEYWORDS.some(kw => lower.includes(kw))) return true;
    }
    return false;
}

/**
 * Check if any AI comment describes an actual fix/implementation (not just discussion).
 * Returns true if at least one AI comment contains fix-related keywords without
 * being purely discussion/deferral.
 */
function hasFixComment(comments: FeedbackTicket['comments']): boolean {
    for (const c of comments) {
        if (c.authorType !== 'ai') continue;
        const lower = c.content.toLowerCase();
        const hasFix = FIX_KEYWORDS.some(kw => lower.includes(kw));
        const isDiscussionOnly = DISCUSSION_KEYWORDS.some(kw => lower.includes(kw))
            && !FIX_KEYWORDS.some(kw => lower.includes(kw));
        if (hasFix && !isDiscussionOnly) return true;
    }
    return false;
}

function hasHumanApproval(comments: FeedbackTicket['comments']): boolean {
    // Look for a human comment AFTER the latest AI plan comment
    let lastAiPlanIdx = -1;
    for (let i = comments.length - 1; i >= 0; i--) {
        if (comments[i].authorType === 'ai') {
            const lower = comments[i].content.toLowerCase();
            if (PLAN_KEYWORDS.some(kw => lower.includes(kw))) {
                lastAiPlanIdx = i;
                break;
            }
        }
    }
    if (lastAiPlanIdx === -1) return false;
    // Any human comment after the plan = approval
    for (let i = lastAiPlanIdx + 1; i < comments.length; i++) {
        if (comments[i].authorType === 'human') return true;
    }
    return false;
}

function getExecutionMetadataError(ticket: FeedbackTicket): string | null {
    const execution = ticket.execution;
    if (!execution) return 'execution metadata is missing';
    if (!execution.summary || !execution.summary.trim()) return 'execution summary is missing';
    if (!Array.isArray(execution.filesTouched) || execution.filesTouched.length === 0) return 'filesTouched is empty';
    if (!Array.isArray(execution.verification) || execution.verification.length === 0) return 'verification is empty';
    if (execution.result !== 'success') return 'execution result must be "success"';
    return null;
}

export function validateAgentTransition(
    ticket: FeedbackTicket,
    newStatus: string,
    rules: AgentRules,
    nextTicketState: FeedbackTicket = ticket,
): TransitionResult {
    if (!AI_ALLOWED_TARGET_STATUSES.has(newStatus)) {
        return {
            allowed: false,
            error: `Agents cannot set status to "${newStatus}". AI agents may only move tickets to todo, reopen, or done.`,
        };
    }

    // 1. Forbidden statuses
    if (rules.global.forbiddenStatuses.includes(newStatus)) {
        return {
            allowed: false,
            error: `Agents cannot set status to "${newStatus}". Only humans can do this.`,
        };
    }

    // 2. Get workflow (default to 'issue' if unknown)
    const workflowKey = ticket.ticketType || 'issue';
    const workflow = rules.workflows[workflowKey] || rules.workflows['issue'];
    if (!workflow) {
        return { allowed: true }; // No workflow defined, allow
    }

    // 3. Check allowed transitions
    const allowedStatuses = workflow.allowedTransitions[ticket.status];
    if (allowedStatuses && !allowedStatuses.includes(newStatus)) {
        return {
            allowed: false,
            error: `${workflowKey} tickets cannot transition from "${ticket.status}" to "${newStatus}". Allowed: ${allowedStatuses.length > 0 ? allowedStatuses.join(', ') : 'none'}.`,
        };
    }

    // 4. HARD GATE: All tickets require an AI comment before moving to "done"
    //    This is the code-enforced version of "comment before fixing".
    //    The API returns 403 if the agent tries to close without commenting first.
    if (newStatus === 'done' && !hasAiComment(ticket.comments)) {
        return {
            allowed: false,
            error: `Cannot move ${ticket.id} to "done" without an AI comment. Post a comment explaining your fix via POST /api/feedback/${ticket.id}/comments first, then change status.`,
        };
    }

    // 4b. HARD GATE: Discussion-only tickets cannot be moved to "done"
    //     If the AI only posted discussion/deferral comments (no actual fix), block.
    if (newStatus === 'done' && hasAiComment(ticket.comments) && !hasFixComment(ticket.comments)) {
        return {
            allowed: false,
            error: `Cannot move ${ticket.id} to "done" — comments are discussion only (no fix shipped). Post a comment describing the actual code change, or leave the ticket in its current status.`,
        };
    }

    if (newStatus === 'done') {
        const executionError = getExecutionMetadataError(nextTicketState);
        if (executionError) {
            return {
                allowed: false,
                error: `Cannot move ${ticket.id} to "done" until board execution metadata is complete: ${executionError}. Include summary, filesTouched, verification, and a success result in the ticket update.`,
            };
        }
    }

    // 5. Idea-specific: require plan comment + human approval before done
    if (workflowKey === 'idea' && newStatus === 'done') {
        if (workflow.requiresPlanComment && !hasPlanComment(ticket.comments)) {
            return {
                allowed: false,
                error: 'Idea tickets require an AI plan comment before moving to done. Post a plan first.',
            };
        }
        if (workflow.requiresHumanApproval && !hasHumanApproval(ticket.comments)) {
            return {
                allowed: false,
                error: 'Idea tickets require human approval (a human comment after the AI plan) before moving to done.',
            };
        }
    }

    return { allowed: true };
}
