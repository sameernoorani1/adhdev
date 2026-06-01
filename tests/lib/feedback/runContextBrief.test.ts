import { describe, expect, it } from 'vitest';
import { buildRunContextBrief, getUnaddressedHumanComments } from '../../../src/lib/feedback/runContextBrief';
import type { FeedbackData, FeedbackTicket } from '../../../src/lib/feedback/core';

function ticket(comments: FeedbackTicket['comments']): FeedbackTicket {
    return {
        id: 'AD-327',
        title: 'Agent comments miss the actual request',
        description: 'Agents must consider comments and record substantive thoughts.',
        status: 'todo',
        priority: 'high',
        ticketType: 'normal',
        aiAddressable: true,
        reporter: 'Sameer',
        images: [],
        tags: [],
        reopenCount: 3,
        comments,
        activity: [],
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
        resolvedAt: null,
    };
}

describe('run context brief', () => {
    it('does not let claim comments hide human comments from the run prompt', () => {
        const t = ticket([
            { id: 'c-human-1', author: 'Sameer', authorType: 'human', content: 'Why did the agent skip my comments?', images: [], createdAt: '2026-05-20T01:00:00.000Z' },
            { id: 'c-claim', author: 'Codex', authorType: 'ai', content: '**Claiming ticket.** I will inspect it.', images: [], createdAt: '2026-05-20T01:01:00.000Z' },
        ]);

        expect(getUnaddressedHumanComments(t).map(c => c.id)).toEqual(['c-human-1']);
    });

    it('only includes human comments after the last substantive AI response', () => {
        const t = ticket([
            { id: 'c-human-1', author: 'Sameer', authorType: 'human', content: 'First concern', images: [], createdAt: '2026-05-20T01:00:00.000Z' },
            { id: 'c-ai-1', author: 'Claude Code', authorType: 'ai', content: 'Evidence: I checked this. Recommendation: fix dispatcher.', images: [], createdAt: '2026-05-20T01:05:00.000Z' },
            { id: 'c-human-2', author: 'Sameer', authorType: 'human', content: 'Also consider Claude response above.', images: [], createdAt: '2026-05-20T01:10:00.000Z' },
        ]);

        expect(getUnaddressedHumanComments(t).map(c => c.id)).toEqual(['c-human-2']);
        const brief = buildRunContextBrief({ tickets: [t] } as FeedbackData, ['AD-327']);
        expect(brief).toContain('c-human-2');
        expect(brief).toContain('c-ai-1');
        expect(brief).not.toContain('c-human-1 |');
    });

    it('surfaces attachment-only comments with image metadata', () => {
        const t = ticket([
            { id: 'c-img', author: 'Sameer', authorType: 'human', content: '', images: [{ filename: 'evidence.png', url: '/uploads/evidence.png' }], createdAt: '2026-05-20T01:00:00.000Z' },
        ]);

        const brief = buildRunContextBrief({ tickets: [t] } as FeedbackData, ['AD-327']);
        expect(brief).toContain('(attachments only)');
        expect(brief).toContain('evidence.png /uploads/evidence.png');
    });
});
