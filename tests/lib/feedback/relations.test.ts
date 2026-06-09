import { describe, it, expect } from 'vitest';
import {
    applyInverse,
    diffRelations,
    inverseKind,
    normalizeRelations,
    type Relation,
} from '@/lib/feedback/relations';

describe('inverseKind', () => {
    it('parent <-> subtask', () => {
        expect(inverseKind('parent')).toBe('subtask');
        expect(inverseKind('subtask')).toBe('parent');
    });

    it('blocks <-> blocked-by', () => {
        expect(inverseKind('blocks')).toBe('blocked-by');
        expect(inverseKind('blocked-by')).toBe('blocks');
    });

    it('duplicate-of has no inverse', () => {
        expect(inverseKind('duplicate-of')).toBeNull();
    });
});

describe('normalizeRelations', () => {
    it('returns [] for non-array input', () => {
        expect(normalizeRelations(null)).toEqual([]);
        expect(normalizeRelations({})).toEqual([]);
        expect(normalizeRelations(undefined)).toEqual([]);
    });

    it('uppercases ticketIds and lowercases kind', () => {
        const out = normalizeRelations([{ kind: 'PARENT', ticketId: 'ad-12' }]);
        expect(out).toEqual([{ kind: 'parent', ticketId: 'AD-12' }]);
    });

    it('drops invalid kinds', () => {
        const out = normalizeRelations([
            { kind: 'parent', ticketId: 'AD-12' },
            { kind: 'noise', ticketId: 'AD-13' },
        ]);
        expect(out).toEqual([{ kind: 'parent', ticketId: 'AD-12' }]);
    });

    it('drops malformed ticketIds', () => {
        const out = normalizeRelations([
            { kind: 'parent', ticketId: 'AD-12' },
            { kind: 'parent', ticketId: 'not-a-ticket' },
            { kind: 'parent', ticketId: '' },
        ]);
        expect(out).toEqual([{ kind: 'parent', ticketId: 'AD-12' }]);
    });

    it('dedupes duplicate kind+ticketId pairs', () => {
        const out = normalizeRelations([
            { kind: 'parent', ticketId: 'AD-12' },
            { kind: 'parent', ticketId: 'AD-12' },
        ]);
        expect(out).toEqual([{ kind: 'parent', ticketId: 'AD-12' }]);
    });
});

describe('diffRelations', () => {
    it('detects added entries', () => {
        const prev: Relation[] = [{ kind: 'parent', ticketId: 'AD-1' }];
        const next: Relation[] = [
            { kind: 'parent', ticketId: 'AD-1' },
            { kind: 'blocks', ticketId: 'AD-2' },
        ];
        const { added, removed } = diffRelations(prev, next);
        expect(added).toEqual([{ kind: 'blocks', ticketId: 'AD-2' }]);
        expect(removed).toEqual([]);
    });

    it('detects removed entries', () => {
        const prev: Relation[] = [
            { kind: 'parent', ticketId: 'AD-1' },
            { kind: 'blocks', ticketId: 'AD-2' },
        ];
        const next: Relation[] = [{ kind: 'parent', ticketId: 'AD-1' }];
        const { added, removed } = diffRelations(prev, next);
        expect(added).toEqual([]);
        expect(removed).toEqual([{ kind: 'blocks', ticketId: 'AD-2' }]);
    });

    it('handles undefined prev', () => {
        const next: Relation[] = [{ kind: 'parent', ticketId: 'AD-1' }];
        const { added, removed } = diffRelations(undefined, next);
        expect(added).toEqual([{ kind: 'parent', ticketId: 'AD-1' }]);
        expect(removed).toEqual([]);
    });

    it('returns empty added/removed when arrays are equal', () => {
        const rel: Relation[] = [{ kind: 'parent', ticketId: 'AD-1' }];
        const { added, removed } = diffRelations(rel, [...rel]);
        expect(added).toEqual([]);
        expect(removed).toEqual([]);
    });
});

describe('applyInverse', () => {
    it('parent on A → adds subtask edge on target', () => {
        const result = applyInverse([], 'add', 'AD-1', 'parent');
        expect(result).toEqual([{ kind: 'subtask', ticketId: 'AD-1' }]);
    });

    it('subtask on A → adds parent edge on target', () => {
        const result = applyInverse([], 'add', 'AD-1', 'subtask');
        expect(result).toEqual([{ kind: 'parent', ticketId: 'AD-1' }]);
    });

    it('blocks on A → adds blocked-by edge on target', () => {
        const result = applyInverse([], 'add', 'AD-1', 'blocks');
        expect(result).toEqual([{ kind: 'blocked-by', ticketId: 'AD-1' }]);
    });

    it('blocked-by on A → adds blocks edge on target', () => {
        const result = applyInverse([], 'add', 'AD-1', 'blocked-by');
        expect(result).toEqual([{ kind: 'blocks', ticketId: 'AD-1' }]);
    });

    it('duplicate-of has no inverse → returns array unchanged', () => {
        const result = applyInverse([{ kind: 'parent', ticketId: 'AD-9' }], 'add', 'AD-1', 'duplicate-of');
        expect(result).toEqual([{ kind: 'parent', ticketId: 'AD-9' }]);
    });

    it('add is idempotent (no duplicate edges on second add)', () => {
        const first = applyInverse([], 'add', 'AD-1', 'parent');
        const second = applyInverse(first, 'add', 'AD-1', 'parent');
        expect(second).toEqual([{ kind: 'subtask', ticketId: 'AD-1' }]);
    });

    it('remove drops the inverse edge', () => {
        const seeded: Relation[] = [{ kind: 'subtask', ticketId: 'AD-1' }, { kind: 'parent', ticketId: 'AD-9' }];
        const result = applyInverse(seeded, 'remove', 'AD-1', 'parent');
        expect(result).toEqual([{ kind: 'parent', ticketId: 'AD-9' }]);
    });

    it('remove is idempotent (no-op if edge absent)', () => {
        const result = applyInverse([{ kind: 'parent', ticketId: 'AD-9' }], 'remove', 'AD-1', 'parent');
        expect(result).toEqual([{ kind: 'parent', ticketId: 'AD-9' }]);
    });

    it('uppercases the source ticketId', () => {
        const result = applyInverse([], 'add', 'ad-7', 'parent');
        expect(result).toEqual([{ kind: 'subtask', ticketId: 'AD-7' }]);
    });

    it('handles undefined target relations', () => {
        const result = applyInverse(undefined, 'add', 'AD-1', 'parent');
        expect(result).toEqual([{ kind: 'subtask', ticketId: 'AD-1' }]);
    });
});
