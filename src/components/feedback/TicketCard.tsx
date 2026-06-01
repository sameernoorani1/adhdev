'use client';

import { useState, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { isTicketExecutionActive } from '@/lib/feedback/executionState';
import { isUnreadAiTicket, type ReadTicketCursors } from '@/lib/feedback/readState';
import { AgentMascot, type MascotAgent } from './AgentMascot';

function inferMascotAgent(actor?: string | null): MascotAgent {
    const lower = (actor || '').toLowerCase();
    if (lower.includes('codex') || lower.includes('openai')) return 'codex';
    if (lower.includes('aider')) return 'aider';
    return 'claude';
}

interface TicketImage {
    url: string;
    filename: string;
    caption?: string;
}

export interface TicketComment {
    id: string;
    author?: string;
    authorType?: 'human' | 'ai';
    content?: string;
    text?: string;
    images?: TicketImage[];
    createdAt?: string;
}

export interface ActivityEntry {
    action: string;
    by: string;
    byType: 'human' | 'ai' | 'system';
    at: string;
    from?: string;
    to?: string;
    snapshot?: { title?: string; description?: string };
}

export interface Ticket {
    id: string;
    title: string;
    description: string;
    status: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    missionId?: string;
    wave?: string;
    session?: string;
    aiAddressable: boolean;
    reporter: string;
    createdByType?: 'human' | 'ai' | 'system';
    images: TicketImage[];
    comments: TicketComment[];
    activity?: ActivityEntry[];
    execution?: {
        runId: string;
        actor: string;
        actorType: 'human' | 'ai';
        status: 'in_progress' | 'done' | 'blocked';
        startedAt: string;
        updatedAt: string;
    };
    reopenCount?: number;
    tags?: string[];
    ticketType?: 'issue' | 'idea' | 'normal' | 'discussion' | 'onboarding';
    sourceMessageId?: string;
    // AD-180: first-class ticket-to-ticket relations.
    relations?: { kind: 'parent' | 'subtask' | 'relates' | 'duplicate-of' | 'blocks' | 'blocked-by'; ticketId: string }[];
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
}

interface TicketCardProps {
    ticket: Ticket;
    onClick: () => void;
    onToggleAi?: (id: string, value: boolean) => void;
    isSelected?: boolean;
    onToggleSelect?: (id: string) => void;
    isDragDisabled?: boolean;
    readTicketCursors?: ReadTicketCursors;
    activeExecutionIds?: Set<string>;
    activeRunStatus?: 'dispatching' | 'running' | 'finishing';
    hiddenFields?: Array<'status' | 'priority' | 'wave' | 'session' | 'mission'>;
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
    critical: { label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/15' },
    high: { label: 'High', color: 'text-orange-400', bg: 'bg-orange-500/15' },
    medium: { label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-500/15' },
    low: { label: 'Low', color: 'text-blue-400', bg: 'bg-blue-500/15' },
};

function isRecent(dateStr: string): boolean {
    return Date.now() - new Date(dateStr).getTime() < 24 * 60 * 60 * 1000;
}

export function timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const ts = new Date(dateStr).getTime();
    if (isNaN(ts)) return dateStr; // fallback for bad dates
    const diff = Date.now() - ts;
    // Small future skew can happen from optimistic client updates, but larger future values should not stay "just now".
    if (diff < 0) {
        if (diff > -5 * 60 * 1000) return 'just now';
        const d = new Date(ts);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
}

/** Hook that ticks every 30s to keep relative timestamps fresh */
export function useTimeTick(intervalMs = 30000): number {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return tick;
}

export function TicketCard({
    ticket,
    onClick,
    onToggleAi,
    isSelected,
    onToggleSelect,
    isDragDisabled,
    readTicketCursors,
    activeExecutionIds,
    activeRunStatus,
    hiddenFields = [],
}: TicketCardProps) {
    const _tick = useTimeTick(); // re-render every 30s for timestamp aging
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: ticket.id, disabled: isDragDisabled });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: 'manipulation',
    };

    const priority = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.medium;
    const recent = isRecent(ticket.updatedAt);
    // 3-state dot: gold pulsing = unread AI response, purple = AI was last (read), grey = recently updated
    const lastComment = ticket.comments.length > 0 ? ticket.comments[ticket.comments.length - 1] : null;
    const lastIsAi = lastComment?.authorType === 'ai';
    const isDispatching = activeRunStatus === 'dispatching';
    const isExecuting = activeRunStatus === 'running'
        || activeRunStatus === 'finishing'
        || (!activeRunStatus && isTicketExecutionActive(ticket, activeExecutionIds));
    // detect AI-created tickets
    const createdActivity = ticket.activity?.find(entry => entry.action === 'created');
    const createdByType = ticket.createdByType || createdActivity?.byType;
    const isAiCreated = ticket.sourceMessageId ||
        createdByType === 'ai' ||
        createdByType === 'system' ||
        ticket.tags?.includes('ai') ||
        ticket.reporter?.toLowerCase() === 'system' ||
        ticket.reporter?.toLowerCase().includes('claude') ||
        ticket.reporter?.toLowerCase().includes('codex') ||
        ticket.reporter?.toLowerCase() === 'ai';
    const creatorLabel = ticket.sourceMessageId
        ? `AI for ${ticket.reporter || 'you'}`
        : isAiCreated
            ? 'AI'
            : 'Human';
    const isUnreadAi = isUnreadAiTicket(ticket, readTicketCursors || {});
    const hiddenFieldSet = new Set(hiddenFields);

    return (
        <div
            ref={setNodeRef}
            data-ticket-id={ticket.id}
            style={style}
            {...attributes}
            {...listeners}
            onClick={onClick}
            className={`
                relative bg-vd-bg-secondary rounded-lg p-3 cursor-pointer
                border border-vd-border hover:border-vd-text-tertiary
                transition-[border-color,box-shadow,background-color,opacity] duration-100
                overflow-hidden
                ${isDragging ? 'opacity-50 shadow-gold-md' : 'hover:shadow-card-hover'}
                ${recent ? 'ring-1 ring-vd-accent-gold/30' : ''}
                ${isExecuting ? 'ring-1 ring-blue-400/40 bg-blue-500/[0.06] adhdev-card-shimmer' : ''}
                ${isDispatching ? 'ring-1 ring-amber-400/35 bg-amber-500/[0.04]' : ''}
                ${isUnreadAi && !isExecuting && !isDispatching ? 'adhdev-card-unread' : ''}
            `}
        >
            {/* Status dot + selection checkbox stacked in top-right corner */}
            <div className="absolute top-2 right-2 flex flex-col items-center gap-1">
                {isExecuting ? (
                    <span className="w-2.5 h-2.5 bg-blue-400 rounded-full animate-pulse shadow-[0_0_10px_rgba(96,165,250,0.7)]" title={`In progress${ticket.execution?.actor ? ` • ${ticket.execution.actor}` : ''}`} />
                ) : isDispatching ? (
                    <span className="w-2.5 h-2.5 bg-amber-300 rounded-full animate-pulse shadow-[0_0_10px_rgba(251,191,36,0.55)]" title="Prompt sent; waiting for agent activity" />
                ) : isUnreadAi ? (
                    <span className="w-2.5 h-2.5 bg-vd-accent-gold rounded-full animate-pulse" title="New AI response — click to read" />
                ) : lastIsAi ? (
                    <span className="w-2 h-2 bg-purple-400 rounded-full" title="AI responded — awaiting your input" />
                ) : recent ? (
                    <span className="w-2 h-2 bg-vd-text-tertiary/40 rounded-full" title="Recently updated" />
                ) : (
                    <span className="w-2 h-2" /> /* spacer to keep checkbox aligned */
                )}
                {onToggleSelect && (
                    <input
                        type="checkbox"
                        checked={isSelected ?? false}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                            e.stopPropagation();
                            onToggleSelect(ticket.id);
                        }}
                        className="w-3.5 h-3.5 rounded border-vd-border accent-vd-accent-gold cursor-pointer"
                        title="Select for batch / AI copy"
                    />
                )}
            </div>

            {/* Title */}
            <h4 className="text-sm font-medium text-vd-text-primary pr-4 line-clamp-2">{ticket.title}</h4>

            {/* Tags */}
            {ticket.tags && ticket.tags.length > 0 && (
                <div className="flex gap-1 mt-1.5 flex-wrap">
                    {ticket.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-vd-bg-tertiary text-vd-text-tertiary">
                            {tag}
                        </span>
                    ))}
                    {ticket.tags.length > 3 && (
                        <span className="text-[9px] text-vd-text-tertiary">+{ticket.tags.length - 3}</span>
                    )}
                </div>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        isAiCreated || ticket.sourceMessageId
                            ? 'bg-violet-500/15 text-violet-400'
                            : 'bg-vd-bg-tertiary text-vd-text-tertiary'
                    }`}
                    title={ticket.sourceMessageId ? `Created by AI from Brain Dump ${ticket.sourceMessageId}` : `Created by ${isAiCreated ? 'AI' : ticket.reporter}`}
                >
                    {creatorLabel}
                </span>

                {/* Ticket type badge */}
                {(ticket.ticketType === 'idea' || ticket.ticketType === 'discussion') && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 flex items-center gap-0.5" title="Discussion only — no code changes">
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                        Discussion
                    </span>
                )}

                {ticket.ticketType === 'onboarding' && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 flex items-center gap-0.5" title="Guided onboarding step">
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Onboarding
                    </span>
                )}

                {(isExecuting || isDispatching) && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${isDispatching ? 'bg-amber-500/15 text-amber-300' : 'bg-blue-500/15 text-blue-400'}`} title={isDispatching ? 'Waiting for agent activity' : (ticket.execution?.actor || 'Coding agent')}>
                        <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="14 42" />
                        </svg>
                        {isDispatching ? 'Sending' : 'Running'}
                    </span>
                )}

                {!hiddenFieldSet.has('status') && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-300" title="Status">
                        {ticket.status}
                    </span>
                )}

                {ticket.missionId && !hiddenFieldSet.has('mission') && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300" title="Mission">
                        {ticket.missionId}
                    </span>
                )}

                {ticket.wave && !hiddenFieldSet.has('wave') && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300" title="Wave">
                        {ticket.wave}
                    </span>
                )}

                {ticket.session && !hiddenFieldSet.has('session') && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300" title="Session">
                        {ticket.session}
                    </span>
                )}

                {/* Priority badge */}
                {!hiddenFieldSet.has('priority') && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${priority.bg} ${priority.color}`}>
                        {priority.label}
                    </span>
                )}

                {/* Image count */}
                {ticket.images.length > 0 && (
                    <span className="text-[10px] text-vd-text-tertiary">📷 {ticket.images.length}</span>
                )}

                {/* Comment count */}
                {ticket.comments.length > 0 && (
                    <span className="text-[10px] text-vd-text-tertiary">💬 {ticket.comments.length}</span>
                )}

                {/* Reopen count badge */}
                {(ticket.reopenCount ?? 0) > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400" title={`Reopened ${ticket.reopenCount} time${ticket.reopenCount! > 1 ? 's' : ''}`}>
                        ↻{ticket.reopenCount}
                    </span>
                )}

                {/* Last updated + Ticket ID */}
                <span className="text-[10px] text-vd-text-tertiary ml-auto" title={`Updated: ${new Date(ticket.updatedAt).toLocaleString()}`}>
                    {timeAgo(ticket.updatedAt)}
                </span>
                <span className="text-[10px] text-vd-text-tertiary">{ticket.id}</span>
            </div>

            {/* 8-bit agent mascot — plays a looping work animation whenever the
                agent is actively on this ticket. Deterministic seed on ticket
                id + run start so the animation stays stable across re-renders.
                AD-147: bumped size to 48px + top-right placement so it doesn't
                overlap the meta row, and the mascot owns a dark backdrop (via
                globals.css) so it reads against any card tint/shimmer.
                AD-269: gate on the same active Run signal as the pill/shimmer.
                The persisted run lease is now the live source of truth; legacy
                execution freshness remains only as a compatibility fallback. */}
            {isExecuting && (
                <div
                    className="pointer-events-none absolute bottom-1 right-1"
                    title={ticket.execution?.actor ? `${ticket.execution.actor} is working…` : 'Agent is working…'}
                >
                    <AgentMascot
                        agent={inferMascotAgent(ticket.execution?.actor)}
                        seed={`${ticket.id}-${ticket.execution?.startedAt ?? ''}`}
                        size={72}
                    />
                </div>
            )}
        </div>
    );
}

/** Lightweight overlay shown during drag */
export function TicketCardOverlay({ ticket }: { ticket: Ticket }) {
    const priority = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.medium;

    return (
        <div className="bg-vd-bg-secondary rounded-lg p-3 border-2 border-vd-accent-gold shadow-gold-md w-[250px]">
            <h4 className="text-sm font-medium text-vd-text-primary line-clamp-2">{ticket.title}</h4>
            <div className="flex items-center gap-2 mt-2">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${priority.bg} ${priority.color}`}>
                    {priority.label}
                </span>
                <span className="text-[10px] text-vd-text-tertiary ml-auto">{ticket.id}</span>
            </div>
        </div>
    );
}
