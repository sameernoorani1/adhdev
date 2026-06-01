export const READ_CURSORS_KEY = 'vd-read-ticket-cursors-v2';
export const LEGACY_READ_TICKETS_KEY = 'vd-read-tickets';

export interface ReadStateComment {
    id?: string;
    authorType?: string;
    createdAt?: string;
}

export interface ReadStateTicket {
    id: string;
    comments: ReadStateComment[];
}

export type ReadTicketCursors = Record<string, string>;

export function getLatestCommentCursor(ticket: Pick<ReadStateTicket, 'comments'>): string {
    const lastComment = ticket.comments.length > 0 ? ticket.comments[ticket.comments.length - 1] : null;
    if (!lastComment) return '';
    return String(lastComment.id || lastComment.createdAt || '');
}

export function isUnreadAiTicket(ticket: ReadStateTicket, readCursors: ReadTicketCursors): boolean {
    const lastComment = ticket.comments.length > 0 ? ticket.comments[ticket.comments.length - 1] : null;
    if (lastComment?.authorType !== 'ai') return false;
    const cursor = getLatestCommentCursor(ticket);
    return !!cursor && readCursors[ticket.id] !== cursor;
}

export function migrateLegacyReadTickets(tickets: ReadStateTicket[], legacyIds: Iterable<string>): ReadTicketCursors {
    const legacySet = new Set(legacyIds);
    const migrated: ReadTicketCursors = {};
    for (const ticket of tickets) {
        if (!legacySet.has(ticket.id)) continue;
        const cursor = getLatestCommentCursor(ticket);
        if (cursor) migrated[ticket.id] = cursor;
    }
    return migrated;
}
