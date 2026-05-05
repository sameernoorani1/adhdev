import { describe, it, expect } from 'vitest';
import { fixupCommentTimestamps } from '@/lib/feedback/core';

function makeComment(id: string, authorType: 'ai' | 'human', createdAt: string): {
    id: string;
    author: string;
    authorType: string;
    content: string;
    images: { url: string; filename: string }[];
    createdAt: string;
} {
    return {
        id,
        author: authorType === 'ai' ? 'Claude Code' : 'Sameer',
        authorType,
        content: 'x',
        images: [],
        createdAt,
    };
}

const TICKET_CREATED = '2026-04-30T10:00:00.000Z';

describe('fixupCommentTimestamps', () => {
    it('returns the array as-is when empty', () => {
        const out = fixupCommentTimestamps([], TICKET_CREATED);
        expect(out).toEqual([]);
    });

    it('preserves real ms-precision timestamps unchanged', () => {
        const c1 = makeComment('c1', 'ai', '2026-04-30T10:00:01.123Z');
        const c2 = makeComment('c2', 'human', '2026-04-30T10:00:02.456Z');
        const out = fixupCommentTimestamps([c1, c2], TICKET_CREATED);
        expect(out[0].createdAt).toBe('2026-04-30T10:00:01.123Z');
        expect(out[1].createdAt).toBe('2026-04-30T10:00:02.456Z');
        // Real ms-precision input should round-trip the very same comment object
        expect(out[0]).toBe(c1);
        expect(out[1]).toBe(c2);
    });

    it('makes timestamps monotonically non-decreasing when out of order', () => {
        const c1 = makeComment('c1', 'human', '2026-04-30T10:00:05.000Z');
        const c2 = makeComment('c2', 'human', '2026-04-30T10:00:03.000Z'); // earlier than c1
        const out = fixupCommentTimestamps([c1, c2], TICKET_CREATED);
        const t1 = Date.parse(out[0].createdAt);
        const t2 = Date.parse(out[1].createdAt);
        expect(t2).toBeGreaterThan(t1);
    });

    it('bumps fudged round AI timestamps (:MM:00.000Z) by +1000ms', () => {
        const c1 = makeComment('c1', 'human', '2026-04-30T10:00:01.123Z');
        const c2 = makeComment('c2', 'ai', '2026-04-30T10:00:00.000Z'); // round AI — fudged
        const out = fixupCommentTimestamps([c1, c2], TICKET_CREATED);
        const t1 = Date.parse(out[0].createdAt);
        const t2 = Date.parse(out[1].createdAt);
        // Fudged round AI timestamp gets pushed to prev + 1000ms
        expect(t2).toBe(t1 + 1000);
    });

    it('does not bump round timestamps from human authors', () => {
        const c1 = makeComment('c1', 'human', '2026-04-30T10:00:00.000Z'); // round but human
        const out = fixupCommentTimestamps([c1], TICKET_CREATED);
        // Human round timestamps are passed through unchanged (still must be monotonic vs ticket start, but ticket created at 10:00:00 means c1 at 10:00:00 is 1 ms later via prev+1)
        // ticketStart is 10:00:00, prevMs starts at ticketStart - 1, so 10:00:00 (parsed) > prevMs holds, no bump applied
        expect(out[0].createdAt).toBe('2026-04-30T10:00:00.000Z');
    });

    it('is idempotent: running fixup twice yields the same result', () => {
        const c1 = makeComment('c1', 'human', '2026-04-30T10:00:01.123Z');
        const c2 = makeComment('c2', 'ai', '2026-04-30T10:00:00.000Z'); // fudged
        const c3 = makeComment('c3', 'human', '2026-04-30T10:00:00.500Z'); // out of order
        const once = fixupCommentTimestamps([c1, c2, c3], TICKET_CREATED);
        const twice = fixupCommentTimestamps(once, TICKET_CREATED);
        expect(twice.map(c => c.createdAt)).toEqual(once.map(c => c.createdAt));
    });

    it('repairs invalid/missing timestamps to prev + 1ms', () => {
        const c1 = makeComment('c1', 'human', '2026-04-30T10:00:01.123Z');
        const c2 = makeComment('c2', 'human', 'not-a-date');
        const out = fixupCommentTimestamps([c1, c2], TICKET_CREATED);
        const t1 = Date.parse(out[0].createdAt);
        const t2 = Date.parse(out[1].createdAt);
        expect(Number.isFinite(t2)).toBe(true);
        expect(t2).toBe(t1 + 1);
    });

    it('uses ticketCreatedAt as the floor when first timestamp is too early', () => {
        const c1 = makeComment('c1', 'human', '2020-01-01T00:00:00.000Z'); // way before ticket
        const out = fixupCommentTimestamps([c1], TICKET_CREATED);
        const t = Date.parse(out[0].createdAt);
        const ticketStart = Date.parse(TICKET_CREATED);
        // First comment is bumped to ticketStart (since prevMs starts at ticketStart - 1)
        expect(t).toBeGreaterThanOrEqual(ticketStart);
    });

    it('does not invent earlier times — only pushes forward', () => {
        const c1 = makeComment('c1', 'human', '2026-04-30T11:00:00.500Z');
        const c2 = makeComment('c2', 'ai', '2026-04-30T10:00:00.000Z'); // earlier AND fudged
        const out = fixupCommentTimestamps([c1, c2], TICKET_CREATED);
        const t1 = Date.parse(out[0].createdAt);
        const t2 = Date.parse(out[1].createdAt);
        // c2 is moved forward to after c1, never backwards
        expect(t2).toBeGreaterThan(t1);
    });
});
