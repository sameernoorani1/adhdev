// AD-180: first-class ticket-to-ticket relations.
//
// A relation is stored on the ticket whose perspective it represents:
//   on A: { kind: 'parent', ticketId: 'AD-12' }   means "A's parent is AD-12"
//   on A: { kind: 'subtask', ticketId: 'AD-15' }  means "AD-15 is a sub-task of A"
//
// To keep the graph consistent, the API write path mirrors changes to the
// other side via INVERSE: if A gains `{kind:'parent', ticketId:B}`, then B
// gains `{kind:'subtask', ticketId:A}`. Same on removal. `relates` is
// symmetric (its inverse is itself); `duplicate-of` is one-way (no inverse
// stored — readers query reverse via lookup).

// AD-193: dropped `relates` — it was being abused as a generic "noise"
// link. Five kinds remain. parent↔subtask and blocks↔blocked-by are
// auto-mirrored via INVERSE on every write; callers only set one side.
export type RelationKind =
    | 'parent'
    | 'subtask'
    | 'duplicate-of'
    | 'blocks'
    | 'blocked-by';

export interface Relation {
    kind: RelationKind;
    ticketId: string;
}

export const RELATION_KINDS: RelationKind[] = [
    'parent', 'subtask', 'duplicate-of', 'blocks', 'blocked-by',
];

export const RELATION_LABEL: Record<RelationKind, string> = {
    'parent': 'Parent',
    'subtask': 'Sub-task',
    'duplicate-of': 'Duplicate of',
    'blocks': 'Blocks',
    'blocked-by': 'Blocked by',
};

const INVERSE: Record<RelationKind, RelationKind | null> = {
    'parent': 'subtask',
    'subtask': 'parent',
    'blocks': 'blocked-by',
    'blocked-by': 'blocks',
    'duplicate-of': null, // one-way; readers query reverse via scan
};

export function inverseKind(kind: RelationKind): RelationKind | null {
    return INVERSE[kind] ?? null;
}

export function normalizeRelations(input: unknown): Relation[] {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const out: Relation[] = [];
    for (const raw of input) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as { kind?: unknown; ticketId?: unknown };
        const kind = String(r.kind || '').toLowerCase() as RelationKind;
        const ticketId = String(r.ticketId || '').trim().toUpperCase();
        if (!RELATION_KINDS.includes(kind)) continue;
        if (!/^[A-Z]{2,6}-\d+$/.test(ticketId)) continue;
        const key = `${kind}:${ticketId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ kind, ticketId });
    }
    return out;
}

/**
 * Diff two relation arrays. Returns the added and removed entries.
 */
export function diffRelations(
    prev: Relation[] | undefined,
    next: Relation[],
): { added: Relation[]; removed: Relation[] } {
    const prevSet = new Set((prev || []).map(r => `${r.kind}:${r.ticketId}`));
    const nextSet = new Set(next.map(r => `${r.kind}:${r.ticketId}`));
    const added: Relation[] = next.filter(r => !prevSet.has(`${r.kind}:${r.ticketId}`));
    const removed: Relation[] = (prev || []).filter(r => !nextSet.has(`${r.kind}:${r.ticketId}`));
    return { added, removed };
}

/**
 * Apply an inverse-relation patch to the target ticket's relations array.
 * Returns the new array. Add or remove based on `op`.
 */
export function applyInverse(
    targetRelations: Relation[] | undefined,
    op: 'add' | 'remove',
    sourceTicketId: string,
    sourceKind: RelationKind,
): Relation[] {
    const inverse = inverseKind(sourceKind);
    if (!inverse) return targetRelations || [];
    const sourceId = sourceTicketId.toUpperCase();
    const current = (targetRelations || []).filter(r => !(r.kind === inverse && r.ticketId === sourceId));
    if (op === 'add') current.push({ kind: inverse, ticketId: sourceId });
    return current;
}
