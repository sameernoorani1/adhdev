import type { FeedbackTicket, AgentRules } from './core';

// ─── Types ──────────────────────────────────────────────────────────
export interface PrioritizedTicket {
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    ticketType: string;
    reopenCount: number;
    tags: string[];
    instruction: string;
    latestHumanComment: string | null;
    latestAiComment: string | null;
    commentCount: number;
    imageCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface WorkQueueSummary {
    totalActionable: number;
    skippedStale: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
}

// ─── Constants ──────────────────────────────────────────────────────
const STATUS_RANK: Record<string, number> = {
    reopen: 0,
    todo: 1,
};

const PRIORITY_RANK: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
};

const ACTIONABLE_STATUSES = new Set(['reopen', 'todo']);

// ─── Helpers ────────────────────────────────────────────────────────
function getEffectivePriority(priority: string, reopenCount: number): string {
    if (reopenCount < 2) return priority;
    // Boost by one tier
    const rank = PRIORITY_RANK[priority] ?? 2;
    const boosted = Math.max(0, rank - 1);
    const entries = Object.entries(PRIORITY_RANK);
    return entries.find(([, r]) => r === boosted)?.[0] ?? priority;
}

function getLatestComment(
    comments: FeedbackTicket['comments'],
    type: 'human' | 'ai',
): string | null {
    for (let i = comments.length - 1; i >= 0; i--) {
        if (comments[i].authorType === type) return comments[i].content;
    }
    return null;
}

function buildInstruction(
    ticket: FeedbackTicket,
    rules: AgentRules,
): string {
    const parts: string[] = [];

    // Status instruction
    const statusInst = rules.statusInstructions[ticket.status];
    if (statusInst) parts.push(statusInst);

    // Workflow instruction
    const workflow = rules.workflows[ticket.ticketType] || rules.workflows['issue'];
    if (workflow) parts.push(workflow.instructions);

    // Reopen callout
    if (ticket.reopenCount >= 2) {
        parts.push(`WARNING: Reopened ${ticket.reopenCount} times. Read all prior comments carefully.`);
    }

    return parts.join(' ');
}

// ─── Staleness Check ─────────────────────────────────────────────────
/** Returns true if the AI already responded and the human hasn't done anything since */
function isStaleForAi(ticket: FeedbackTicket): boolean {
    if (!ticket.comments || ticket.comments.length === 0) return false;

    // Find the last AI comment and last human comment
    let lastAiIdx = -1;
    let lastHumanIdx = -1;
    for (let i = ticket.comments.length - 1; i >= 0; i--) {
        if (ticket.comments[i].authorType === 'ai' && lastAiIdx === -1) lastAiIdx = i;
        if (ticket.comments[i].authorType === 'human' && lastHumanIdx === -1) lastHumanIdx = i;
    }

    // If AI has commented but human hasn't responded after it → stale
    if (lastAiIdx !== -1 && lastAiIdx > lastHumanIdx) {
        // Exception: if ticket was moved to reopen or status changed AFTER the AI comment,
        // that counts as human activity (check updatedAt vs AI comment time)
        const aiCommentTime = new Date(ticket.comments[lastAiIdx].createdAt).getTime();
        const updatedTime = new Date(ticket.updatedAt).getTime();
        // If ticket was updated (status change, edit) after the AI comment, it's not stale
        // Use a 5-second buffer to account for the AI's own status change
        if (updatedTime > aiCommentTime + 5000) return false;
        return true;
    }

    return false;
}

// ─── Main ───────────────────────────────────────────────────────────
export function prioritizeTickets(
    tickets: FeedbackTicket[],
    rules: AgentRules,
    agent?: string,
): { workQueue: PrioritizedTicket[]; summary: WorkQueueSummary } {
    // Filter: actionable status + AI addressable, OR targeted AI mention in any status.
    const normalizedAgent = (agent || '').toLowerCase();
    const hasPendingMention = (t: FeedbackTicket): boolean => {
        if (!t.activity) return false;
        const lastMention = [...t.activity].reverse().find((a) => {
            if (a.action !== 'ai_mentioned') return false;
            const target = ((a as unknown as Record<string, unknown>).targetAgent as string | undefined) || 'ai';
            return !normalizedAgent || target === 'ai' || target === normalizedAgent;
        });
        if (!lastMention) return false;
        // Check if AI has responded after the mention
        const mentionTime = new Date(lastMention.at).getTime();
        const lastAi = [...t.comments].reverse().find(c => c.authorType === 'ai');
        if (lastAi && new Date(lastAi.createdAt).getTime() > mentionTime) return false;
        return true;
    };
    const candidates = tickets.filter(
        t => t.aiAddressable && (ACTIONABLE_STATUSES.has(t.status) || hasPendingMention(t)),
    );
    // Exclude stale tickets (AI already responded, human hasn't acted since)
    const stale = candidates.filter(t => isStaleForAi(t));
    const actionable = candidates.filter(t => !isStaleForAi(t));

    // Sort
    actionable.sort((a, b) => {
        // 1. Status rank (reopen > todo > backlog)
        const sa = STATUS_RANK[a.status] ?? 9;
        const sb = STATUS_RANK[b.status] ?? 9;
        if (sa !== sb) return sa - sb;

        // 2. Effective priority
        const pa = PRIORITY_RANK[getEffectivePriority(a.priority, a.reopenCount)] ?? 2;
        const pb = PRIORITY_RANK[getEffectivePriority(b.priority, b.reopenCount)] ?? 2;
        if (pa !== pb) return pa - pb;

        // 3. FIFO by createdAt
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // Map to work queue items
    const workQueue: PrioritizedTicket[] = actionable.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        ticketType: t.ticketType,
        reopenCount: t.reopenCount,
        tags: t.tags || [],
        instruction: buildInstruction(t, rules),
        latestHumanComment: getLatestComment(t.comments, 'human'),
        latestAiComment: getLatestComment(t.comments, 'ai'),
        commentCount: t.comments.length,
        imageCount: t.images.length,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
    }));

    // Summary
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const t of actionable) {
        byStatus[t.status] = (byStatus[t.status] || 0) + 1;
        byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    }

    return {
        workQueue,
        summary: {
            totalActionable: actionable.length,
            skippedStale: stale.length,
            byStatus,
            byPriority,
        },
    };
}
