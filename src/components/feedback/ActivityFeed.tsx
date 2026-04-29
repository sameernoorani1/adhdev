'use client';

import { useState, useMemo } from 'react';

interface ActivityItem {
    type: string;
    action?: string;
    detail?: string;
    by?: string;
    byType?: string;
    ticketId?: string | null;
    ticketTitle?: string;
    tool?: string;
    file?: string | null;
    from?: string;
    to?: string;
    at: string;
    sessionId?: string;
}

interface Ticket {
    id: string;
    title: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activity?: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    comments?: any[];
    [key: string]: unknown;
}

interface ActivityFeedProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tickets: any[];
    sessionActivity: ActivityItem[];
    onClose: () => void;
    onTicketClick?: (ticketId: string) => void;
}

function timeAgo(dateStr: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function actionIcon(action: string): string {
    switch (action) {
        case 'created': return '➕';
        case 'status_changed': return '🔄';
        case 'priority_changed': return '⚡';
        case 'claimed': return '🤖';
        case 'ai_mentioned': return '💬';
        case 'title_edited': case 'description_edited': return '✏️';
        case 'comment_added': return '💬';
        case 'file_edited': case 'file_created': return '📝';
        case 'file_read': return '👁';
        case 'command_run': return '⚙️';
        case 'search': return '🔍';
        case 'session_start': return '▶️';
        case 'session_stop': return '⏹️';
        default: return '•';
    }
}

function actionLabel(item: ActivityItem): string {
    const action = item.action || item.type;
    switch (action) {
        case 'created': return 'created ticket';
        case 'status_changed': return `moved ${item.from} → ${item.to}`;
        case 'priority_changed': return `priority ${item.from} → ${item.to}`;
        case 'claimed': return 'claimed ticket';
        case 'ai_mentioned': return 'mentioned AI';
        case 'execution_started': return 'execution started';
        case 'execution_completed': return 'execution completed';
        case 'execution_interrupted': return 'execution interrupted';
        case 'execution_updated': return 'execution updated';
        case 'terminal_run_declared': return 'terminal run declared';
        case 'title_edited': return 'edited title';
        case 'description_edited': return 'edited description';
        case 'comment_added': return 'commented';
        case 'file_edited': return `edited ${item.file || 'file'}`;
        case 'file_created': return `created ${item.file || 'file'}`;
        case 'file_read': return `read ${item.file || 'file'}`;
        case 'command_run': return item.detail || 'ran command';
        case 'search': return item.detail || 'searched';
        case 'session_start': return 'session started';
        case 'session_stop': return 'session ended';
        case 'tool_use': return item.detail || `used ${item.tool}`;
        default: return action;
    }
}

type FilterType = 'all' | 'human' | 'ai' | 'status' | 'comments' | 'files';

export function ActivityFeed({ tickets, sessionActivity, onClose, onTicketClick }: ActivityFeedProps) {
    const [filter, setFilter] = useState<FilterType>('all');
    const [searchQuery, setSearchQuery] = useState('');

    // Build unified timeline from ticket activity + session activity
    const allItems = useMemo(() => {
        const items: ActivityItem[] = [];

        // Ticket activity
        for (const t of tickets) {
            if (t.activity) {
                for (const a of t.activity) {
                    items.push({
                        type: 'ticket_activity',
                        action: a.action,
                        by: a.by,
                        byType: a.byType,
                        ticketId: t.id,
                        ticketTitle: t.title,
                        from: a.from,
                        to: a.to,
                        at: a.at,
                    });
                }
            }
            // Comments as activity
            if (t.comments) {
                for (const c of t.comments) {
                    const detail = typeof c.content === 'string' ? c.content.trim()
                        : typeof c.text === 'string' ? c.text.trim()
                        : typeof c.body === 'string' ? c.body.trim()
                        : '';
                    if (!detail && (!Array.isArray(c.images) || c.images.length === 0)) continue;
                    items.push({
                        type: 'ticket_activity',
                        action: 'comment_added',
                        by: c.author,
                        byType: c.authorType,
                        ticketId: t.id,
                        ticketTitle: t.title,
                        detail: detail.length > 80 ? detail.slice(0, 80) + '...' : detail || `${Array.isArray(c.images) ? c.images.length : 0} attachment(s)`,
                        at: c.createdAt,
                    });
                }
            }
        }

        // Session activity (from hooks)
        for (const s of sessionActivity) {
            items.push(s);
        }

        // Sort newest first
        items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
        return items;
    }, [tickets, sessionActivity]);

    // Filter
    const filteredItems = useMemo(() => {
        let items = allItems;

        if (filter === 'human') items = items.filter(i => i.byType === 'human');
        else if (filter === 'ai') items = items.filter(i => i.byType === 'ai' || i.type === 'tool_use' || i.action === 'claimed' || i.action === 'terminal_run_declared' || i.action?.startsWith('execution_'));
        else if (filter === 'status') items = items.filter(i => i.action === 'status_changed' || i.action === 'created' || i.action?.startsWith('execution_'));
        else if (filter === 'comments') items = items.filter(i => i.action === 'comment_added' || i.action === 'ai_mentioned');
        else if (filter === 'files') items = items.filter(i => i.action === 'file_edited' || i.action === 'file_created' || i.action === 'file_read');

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            items = items.filter(i =>
                i.ticketId?.toLowerCase().includes(q) ||
                i.ticketTitle?.toLowerCase().includes(q) ||
                i.by?.toLowerCase().includes(q) ||
                i.detail?.toLowerCase().includes(q) ||
                i.file?.toLowerCase().includes(q)
            );
        }

        return items;
    }, [allItems, filter, searchQuery]);

    const FILTERS: { id: FilterType; label: string }[] = [
        { id: 'all', label: 'All' },
        { id: 'human', label: 'Human' },
        { id: 'ai', label: 'AI' },
        { id: 'status', label: 'Status' },
        { id: 'comments', label: 'Comments' },
        { id: 'files', label: 'Files' },
    ];

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="fixed inset-y-0 right-0 z-50 w-80 bg-vd-bg-secondary border-l border-vd-border flex flex-col shadow-panel">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-vd-border flex-shrink-0">
                    <h3 className="text-xs font-semibold text-vd-text-primary">Activity Feed</h3>
                    <button onClick={onClose} className="text-vd-text-tertiary hover:text-vd-text-primary text-sm">&times;</button>
                </div>

                {/* Search */}
                <div className="px-3 py-2 border-b border-vd-border/50">
                    <input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Filter activity..."
                        className="w-full bg-vd-bg-input border border-vd-border rounded px-2.5 py-1.5 text-[11px] text-vd-text-primary placeholder:text-vd-text-tertiary outline-none focus:border-vd-accent-gold"
                    />
                </div>

                {/* Filter pills */}
                <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-vd-border/50">
                    {FILTERS.map(f => (
                        <button
                            key={f.id}
                            onClick={() => setFilter(f.id)}
                            className={`text-[9px] px-2 py-0.5 rounded-full transition-colors ${
                                filter === f.id
                                    ? 'bg-vd-accent-gold/15 text-vd-accent-gold border border-vd-accent-gold/30'
                                    : 'bg-vd-bg-tertiary text-vd-text-tertiary border border-transparent hover:text-vd-text-secondary'
                            }`}
                        >{f.label}</button>
                    ))}
                </div>

                {/* Timeline */}
                <div className="flex-1 overflow-y-auto px-3 py-2">
                    {filteredItems.length === 0 ? (
                        <p className="text-center text-[11px] text-vd-text-tertiary py-8">No activity yet</p>
                    ) : (
                        <div className="space-y-0.5">
                            {filteredItems.slice(0, 200).map((item, i) => (
                                <div
                                    key={`${item.at}-${i}`}
                                    className="flex gap-2 py-1.5 px-1 rounded hover:bg-vd-bg-tertiary/50 group"
                                >
                                    <span className="text-[11px] flex-shrink-0 w-4 text-center">{actionIcon(item.action || item.type)}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline gap-1.5">
                                            {item.by && (
                                                <span className={`text-[10px] font-medium ${item.byType === 'ai' ? 'text-purple-400' : 'text-vd-text-primary'}`}>
                                                    {item.by}
                                                </span>
                                            )}
                                            <span className="text-[10px] text-vd-text-secondary truncate">
                                                {actionLabel(item)}
                                            </span>
                                        </div>
                                        {item.ticketId && (
                                            <button
                                                onClick={() => onTicketClick?.(item.ticketId!)}
                                                className="text-[9px] text-vd-accent-gold hover:underline truncate block max-w-full text-left"
                                            >
                                                {item.ticketId}: {item.ticketTitle || ''}
                                            </button>
                                        )}
                                        {item.detail && (
                                            <p className="text-[9px] text-vd-text-tertiary truncate">{item.detail}</p>
                                        )}
                                    </div>
                                    <span className="text-[9px] text-vd-text-tertiary flex-shrink-0 opacity-0 group-hover:opacity-100">
                                        {timeAgo(item.at)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer stats */}
                <div className="px-3 py-2 border-t border-vd-border/50 text-[9px] text-vd-text-tertiary">
                    {filteredItems.length} events {filter !== 'all' ? `(filtered from ${allItems.length})` : ''}
                </div>
            </div>
        </>
    );
}
