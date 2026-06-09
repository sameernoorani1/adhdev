import { describe, expect, it } from 'vitest';
import {
    getLatestCommentCursor,
    isUnreadAiTicket,
    migrateLegacyReadTickets,
    type ReadStateTicket,
} from '@/lib/feedback/readState';

const ticket = (comments: ReadStateTicket['comments']): ReadStateTicket => ({
    id: 'AD-1',
    comments,
});

describe('read state cursors', () => {
    it('uses the latest comment id as the read cursor', () => {
        expect(getLatestCommentCursor(ticket([
            { id: 'c-1', authorType: 'human', createdAt: '2026-05-20T00:00:00.000Z' },
            { id: 'c-2', authorType: 'ai', createdAt: '2026-05-20T00:01:00.000Z' },
        ]))).toBe('c-2');
    });

    it('marks a newer AI comment unread when the stored cursor points at an older comment', () => {
        const t = ticket([
            { id: 'c-1', authorType: 'ai' },
            { id: 'c-2', authorType: 'ai' },
        ]);

        expect(isUnreadAiTicket(t, { 'AD-1': 'c-1' })).toBe(true);
    });

    it('does not mark a ticket unread when the latest AI comment cursor was read', () => {
        const t = ticket([{ id: 'c-2', authorType: 'ai' }]);

        expect(isUnreadAiTicket(t, { 'AD-1': 'c-2' })).toBe(false);
    });

    it('does not mark a ticket unread when a human comment is latest', () => {
        const t = ticket([
            { id: 'c-1', authorType: 'ai' },
            { id: 'c-2', authorType: 'human' },
        ]);

        expect(isUnreadAiTicket(t, { 'AD-1': 'c-1' })).toBe(false);
    });

    it('migrates legacy ticket-id read state to current comment cursors', () => {
        expect(migrateLegacyReadTickets([
            { id: 'AD-1', comments: [{ id: 'c-1', authorType: 'ai' }] },
            { id: 'AD-2', comments: [{ id: 'c-2', authorType: 'ai' }] },
        ], ['AD-2'])).toEqual({ 'AD-2': 'c-2' });
    });
});
