import { describe, expect, it } from 'vitest';
import { getMissingExecutionCommentError, hasSubstantiveAiCommentForExecution, isLifecycleAiComment } from '@/lib/feedback/executionComments';

describe('execution comment gates', () => {
    it('treats claim comments as lifecycle-only', () => {
        expect(isLifecycleAiComment({ authorType: 'ai', content: '**Claiming ticket.** Will inspect this.' })).toBe(true);
        expect(isLifecycleAiComment({ authorType: 'ai', content: 'Implemented the fix.' })).toBe(false);
    });

    it('requires a substantive AI comment after the execution start', () => {
        const comments = [
            {
                author: 'Codex',
                authorType: 'ai',
                content: '**Claiming ticket.** Starting.',
                createdAt: '2026-05-20T00:00:00.000Z',
            },
            {
                author: 'Codex',
                authorType: 'ai',
                content: 'Earlier unrelated answer.',
                createdAt: '2026-05-19T23:59:00.000Z',
            },
        ];

        expect(hasSubstantiveAiCommentForExecution(comments, 'Codex', '2026-05-20T00:00:00.000Z')).toBe(false);

        expect(hasSubstantiveAiCommentForExecution([
            ...comments,
            {
                author: 'Codex',
                authorType: 'ai',
                content: 'Findings posted to the ticket.',
                createdAt: '2026-05-20T00:01:00.000Z',
            },
        ], 'Codex', '2026-05-20T00:00:00.000Z')).toBe(true);
    });

    it('uses an actionable API error', () => {
        expect(getMissingExecutionCommentError('AD-327')).toContain('POST /api/feedback/AD-327/comments');
    });
});
