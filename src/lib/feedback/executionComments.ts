export interface ExecutionComment {
    author?: string;
    authorType?: string;
    content?: string;
    createdAt?: string;
}

function normalize(value: unknown): string {
    return String(value || '').trim();
}

export function isLifecycleAiComment(comment: ExecutionComment): boolean {
    const content = normalize(comment.content).toLowerCase();
    return content.startsWith('**claiming ticket.**') || content.startsWith('claiming ticket.');
}

export function hasSubstantiveAiCommentForExecution(
    comments: ExecutionComment[],
    actor?: string | null,
    startedAt?: string | null,
): boolean {
    const actorName = normalize(actor).toLowerCase();
    const startedMs = startedAt ? Date.parse(startedAt) : NaN;

    return comments.some(comment => {
        if (comment.authorType !== 'ai') return false;
        if (actorName && normalize(comment.author).toLowerCase() !== actorName) return false;
        if (!normalize(comment.content)) return false;
        if (isLifecycleAiComment(comment)) return false;

        if (!Number.isNaN(startedMs)) {
            const commentMs = comment.createdAt ? Date.parse(comment.createdAt) : NaN;
            if (!Number.isNaN(commentMs) && commentMs < startedMs) return false;
        }

        return true;
    });
}

export function getMissingExecutionCommentError(ticketId: string): string {
    return `Cannot complete execution for ${ticketId} without a substantive AI ticket comment after the run started. Claim/plan comments do not count; post findings, recommendations, implementation summary, or blocker details via POST /api/feedback/${ticketId}/comments first.`;
}
