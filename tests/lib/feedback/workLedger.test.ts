import { describe, expect, it } from 'vitest';
import type { SessionActivityEntry } from '../../../src/lib/feedback/core';
import { detectUntrackedWork, hasUntrackedWork } from '../../../src/lib/feedback/workLedger';

const edit = (
    file: string,
    ticketId: string | null,
    sessionId = 's1',
    at = '2026-06-05T00:00:00.000Z',
    action: 'file_edited' | 'file_created' = 'file_edited',
): SessionActivityEntry => ({ type: 'tool_use', action, file, ticketId, sessionId, at });

describe('workLedger — detectUntrackedWork (AD-338)', () => {
    it('flags file edits with no ticket as untracked', () => {
        const sa = [edit('src/a.ts', null), edit('src/b.ts', null, 's1', '2026-06-05T00:00:01.000Z', 'file_created')];
        const r = detectUntrackedWork(sa);
        expect(r.untrackedCount).toBe(2);
        expect(r.untrackedFiles).toEqual(['src/a.ts', 'src/b.ts']);
        expect(hasUntrackedWork(sa)).toBe(true);
    });

    it('does NOT flag edits attributed to a ticket', () => {
        const sa = [edit('src/a.ts', 'AD-1'), edit('src/b.ts', 'AD-1')];
        expect(detectUntrackedWork(sa).untrackedCount).toBe(0);
        expect(hasUntrackedWork(sa)).toBe(false);
    });

    it('counts only create/edit — reads, commands and searches are not "work"', () => {
        const sa: SessionActivityEntry[] = [
            { type: 'tool_use', action: 'file_read', file: 'src/a.ts', ticketId: null, sessionId: 's1', at: '2026-06-05T00:00:00.000Z' },
            { type: 'tool_use', action: 'command_run', detail: 'ran x', ticketId: null, sessionId: 's1', at: '2026-06-05T00:00:01.000Z' },
            { type: 'tool_use', action: 'search', ticketId: null, sessionId: 's1', at: '2026-06-05T00:00:02.000Z' },
        ];
        expect(detectUntrackedWork(sa).untrackedCount).toBe(0);
    });

    it('groups untracked edits by session (newest first), de-duping files', () => {
        const sa = [
            edit('src/a.ts', null, 's1', '2026-06-05T00:00:01.000Z'),
            edit('src/a.ts', null, 's1', '2026-06-05T00:00:02.000Z'), // same file+session → counts once
            edit('src/c.ts', null, 's2', '2026-06-05T00:00:05.000Z'),
        ];
        const r = detectUntrackedWork(sa);
        expect(r.untrackedCount).toBe(2); // a.ts, c.ts
        expect(r.bySession[0].sessionId).toBe('s2'); // newest first
        expect(r.bySession.find(s => s.sessionId === 's1')!.count).toBe(1); // de-duped
    });

    it('mixed: only the untracked edits surface', () => {
        const sa = [edit('src/a.ts', 'AD-1'), edit('src/b.ts', null)];
        expect(detectUntrackedWork(sa).untrackedFiles).toEqual(['src/b.ts']);
    });

    it('handles empty / undefined safely', () => {
        expect(detectUntrackedWork(undefined).untrackedCount).toBe(0);
        expect(detectUntrackedWork([]).untrackedCount).toBe(0);
        expect(hasUntrackedWork(undefined)).toBe(false);
    });
});
