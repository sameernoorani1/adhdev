// AD-338: the work-ledger — make the board maintain itself instead of trusting
// the agent to remember.
//
// The `.claude` PostToolUse activity hook (/api/hooks/activity) already records
// every file create/edit, tagged with a ticketId WHEN one is known (the
// `x-adhdev-ticket` header). A file edit with NO ticketId is exactly the failure
// case: code changed, but the board has no trail for it. This module DETECTS
// that — so untracked work becomes visible and attributable, not silently lost.
//
// This is the same philosophy as AD-318 (detect the agent, don't trust text) and
// AD-269 (detect the claim, don't trust the dispatch): detect the WORK, don't
// trust the agent to log it.

import type { SessionActivityEntry } from './core';

const EDIT_ACTIONS = new Set(['file_created', 'file_edited']);

export interface UntrackedSession {
    sessionId: string;
    count: number;
    files: string[];
    lastAt: string;
}

export interface UntrackedWork {
    untrackedCount: number;       // distinct files changed with no ticket trail
    untrackedFiles: string[];
    bySession: UntrackedSession[];
}

/**
 * Untracked work = file create/edit activity not attributed to any ticket.
 * Pure: derives entirely from the recorded session activity.
 */
export function detectUntrackedWork(sessionActivity: SessionActivityEntry[] | undefined): UntrackedWork {
    const edits = (sessionActivity || []).filter(
        (e): e is SessionActivityEntry =>
            !!e &&
            e.type === 'tool_use' &&
            EDIT_ACTIONS.has(String(e.action)) &&
            !!e.file &&
            !e.ticketId,
    );

    const bySessionMap = new Map<string, { files: Set<string>; lastAt: string }>();
    const allFiles = new Set<string>();
    for (const e of edits) {
        const sid = e.sessionId || 'unknown';
        const file = String(e.file);
        allFiles.add(file);
        const cur = bySessionMap.get(sid) || { files: new Set<string>(), lastAt: '' };
        cur.files.add(file);
        if (!cur.lastAt || String(e.at) > cur.lastAt) cur.lastAt = String(e.at);
        bySessionMap.set(sid, cur);
    }

    const bySession: UntrackedSession[] = [...bySessionMap.entries()]
        .map(([sessionId, v]) => ({
            sessionId,
            count: v.files.size,
            files: [...v.files].sort(),
            lastAt: v.lastAt,
        }))
        .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));

    return {
        untrackedCount: allFiles.size,
        untrackedFiles: [...allFiles].sort(),
        bySession,
    };
}

export function hasUntrackedWork(sessionActivity: SessionActivityEntry[] | undefined): boolean {
    return detectUntrackedWork(sessionActivity).untrackedCount > 0;
}
