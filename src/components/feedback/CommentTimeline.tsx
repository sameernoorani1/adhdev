'use client';

import { useState, useCallback } from 'react';
import { ActivityEntry, timeAgo, useTimeTick } from './TicketCard';

interface CommentImage {
    url: string;
    filename: string;
    isImage?: boolean;
    size?: number;
    caption?: string;
}

interface Comment {
    id: string;
    author: string;
    authorType: 'human' | 'ai';
    content: string;
    images: CommentImage[];
    createdAt: string;
}

/** Unified timeline entry — either a comment or an activity event */
type TimelineEntry =
    | { kind: 'comment'; data: Comment }
    | { kind: 'activity'; data: ActivityEntry };

interface CommentTimelineProps {
    comments: Comment[];
    activity?: ActivityEntry[];
    onDeleteComment?: (commentId: string) => void;
    onImageClick?: (url: string) => void;
    // AD-186: open the Brain Dump panel and scroll to a chat message id
    // when the user clicks an `m-xxx` token in a comment body.
    onOpenChatMessage?: (messageId: string) => void;
}

// timeAgo imported from TicketCard

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getFileIcon(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (['pdf'].includes(ext)) return '📄';
    if (['doc', 'docx'].includes(ext)) return '📝';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
    if (['ppt', 'pptx'].includes(ext)) return '📑';
    if (['txt', 'md', 'log'].includes(ext)) return '📃';
    if (['json', 'js', 'ts', 'tsx', 'py'].includes(ext)) return '💻';
    return '📎';
}

function formatActivity(entry: ActivityEntry): string {
    switch (entry.action) {
        case 'created': return 'created this ticket';
        case 'status_changed': return `moved from ${entry.from} → ${entry.to}`;
        case 'priority_changed': return `changed priority from ${entry.from} → ${entry.to}`;
        case 'ai_enabled': return 'enabled AI addressable';
        case 'ai_disabled': return 'disabled AI addressable';
        case 'comment_added': return 'added a comment';
        case 'execution_started': return 'started working on this ticket';
        case 'execution_completed': return 'completed the recorded execution';
        case 'execution_interrupted': return 'interrupted the recorded execution';
        case 'execution_updated': return 'updated execution details';
        case 'terminal_run_declared': return 'declared a terminal run for this ticket';
        case 'title_edited': return 'edited the title';
        case 'description_edited': return 'edited the description';
        case 'ai_mentioned': {
            const target = ((entry as unknown as Record<string, unknown>).targetAgent as string | undefined) || 'ai';
            return `mentioned @${target} for AI response`;
        }
        case 'claimed': return 'claimed this ticket';
        default: return entry.action;
    }
}

// AD-169: extended brand detection so Gemini, Cursor, Aider, Continue and
// generic models render with a recognisable badge instead of falling back to
// a plain "AI" pill. New brands use a coloured monogram (no SVG required) so
// adding more agents later is just a row in BRAND_TOKENS.
type AiBrand = 'openai' | 'claude' | 'gemini' | 'aider' | 'cursor' | 'continue' | 'generic';

function detectAiBrand(author: string): AiBrand {
    const lower = author.toLowerCase();
    if (lower.includes('codex') || lower.includes('openai') || lower.includes('chatgpt') || lower.includes('gpt')) return 'openai';
    if (lower.includes('claude') || lower.includes('anthropic')) return 'claude';
    if (lower.includes('gemini') || lower.includes('google ai') || lower.includes('bard')) return 'gemini';
    if (lower.includes('aider')) return 'aider';
    if (lower.includes('cursor')) return 'cursor';
    if (lower.includes('continue')) return 'continue';
    return 'generic';
}

interface MonogramTokens {
    bg: string;
    inner: string;
    border: string;
    text: string;
    label: string;
    initial: string;
}

const MONOGRAM_TOKENS: Record<Exclude<AiBrand, 'openai' | 'claude'>, MonogramTokens> = {
    gemini:   { bg: 'bg-[#101a2b]', inner: 'bg-[#dbeafe]', border: 'border-sky-300/30',     text: 'text-sky-700',     label: 'Gemini',   initial: 'G' },
    aider:    { bg: 'bg-[#1d2410]', inner: 'bg-[#ecfccb]', border: 'border-lime-300/30',    text: 'text-lime-700',    label: 'Aider',    initial: 'A' },
    cursor:   { bg: 'bg-[#1f1024]', inner: 'bg-[#f5d0fe]', border: 'border-fuchsia-300/30', text: 'text-fuchsia-700', label: 'Cursor',   initial: 'C' },
    continue: { bg: 'bg-[#1a1410]', inner: 'bg-[#fde68a]', border: 'border-amber-300/30',   text: 'text-amber-800',   label: 'Continue', initial: 'C' },
    generic:  { bg: 'bg-violet-500/15', inner: '', border: 'border-violet-400/25', text: 'text-violet-300', label: 'AI', initial: 'AI' },
};

function AiAvatar({ author }: { author: string }) {
    const brand = detectAiBrand(author);
    if (brand === 'openai') {
        return (
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-[#102117] border border-emerald-300/30 overflow-hidden shadow-[0_0_0_1px_rgba(16,33,23,0.35)]">
                <div className="w-6 h-6 rounded-full bg-[#f7faf8] flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/feedback-agent-openai.svg"
                        alt="OpenAI"
                        className="w-4 h-4 object-contain"
                    />
                </div>
            </div>
        );
    }
    if (brand === 'claude') {
        return (
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-[#2b1d15] border border-orange-300/30 overflow-hidden shadow-[0_0_0_1px_rgba(43,29,21,0.35)]">
                <div className="w-6 h-6 rounded-full bg-[#fff7ef] flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/feedback-agent-claude.svg"
                        alt="Claude"
                        className="w-4 h-4 object-contain"
                    />
                </div>
            </div>
        );
    }
    if (brand === 'generic') {
        return (
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-violet-500/15 text-violet-300 border border-violet-400/25 text-[10px] font-semibold">
                AI
            </div>
        );
    }
    const tokens = MONOGRAM_TOKENS[brand];
    return (
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${tokens.bg} border ${tokens.border} overflow-hidden shadow-[0_0_0_1px_rgba(0,0,0,0.35)]`} aria-label={tokens.label}>
            <div className={`w-6 h-6 rounded-full ${tokens.inner} flex items-center justify-center text-[11px] font-bold ${tokens.text}`}>
                {tokens.initial}
            </div>
        </div>
    );
}

/** Detect if content looks like markdown (has headers, lists, tables, code blocks, bold) */
function isMarkdownContent(content: string): boolean {
    const mdSignals = [
        /^#{1,6}\s/m,                // Headers
        /^\|.+\|/m,                  // Tables
        /^```/m,                     // Code blocks
        /^---$/m,                    // Horizontal rules
        /^\s*[-*]\s.+/m,            // Unordered lists (multiple)
        /^\s*\d+\.\s.+/m,          // Ordered lists
        /\*\*[^*]+\*\*/,            // Bold
    ];
    let hits = 0;
    for (const pattern of mdSignals) {
        if (pattern.test(content)) hits++;
    }
    // 2+ markdown signals = treat as markdown
    return hits >= 2;
}

/** Minimal markdown renderer — handles headers, bold, code, tables, lists, hr */
function renderMarkdown(content: string, onOpenChatMessage?: (id: string) => void): React.ReactNode[] {
    const lines = content.split('\n');
    const nodes: React.ReactNode[] = [];
    let i = 0;
    let key = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Code block
        if (line.startsWith('```')) {
            const lang = line.slice(3).trim();
            const codeLines: string[] = [];
            i++;
            while (i < lines.length && !lines[i].startsWith('```')) {
                codeLines.push(lines[i]);
                i++;
            }
            i++; // skip closing ```
            nodes.push(
                <pre key={key++} className="bg-vd-bg-primary rounded-md px-3 py-2 my-1.5 overflow-x-auto text-[11px] text-vd-text-secondary font-mono">
                    {lang && <div className="text-[9px] text-vd-text-tertiary mb-1">{lang}</div>}
                    <code>{codeLines.join('\n')}</code>
                </pre>
            );
            continue;
        }

        // Horizontal rule
        if (/^---+$/.test(line.trim())) {
            nodes.push(<hr key={key++} className="border-vd-border my-2" />);
            i++;
            continue;
        }

        // Headers
        const headerMatch = line.match(/^(#{1,6})\s(.+)/);
        if (headerMatch) {
            const level = headerMatch[1].length;
            const text = headerMatch[2];
            const sizes: Record<number, string> = {
                1: 'text-sm font-bold',
                2: 'text-[13px] font-semibold',
                3: 'text-xs font-semibold',
                4: 'text-xs font-medium',
                5: 'text-[11px] font-medium',
                6: 'text-[11px] font-medium',
            };
            nodes.push(
                <div key={key++} className={`${sizes[level] || sizes[3]} text-vd-text-primary mt-2 mb-0.5`}>
                    {renderInline(text, onOpenChatMessage)}
                </div>
            );
            i++;
            continue;
        }

        // Table (collect all | lines)
        if (/^\|.+\|/.test(line)) {
            const tableLines: string[] = [];
            while (i < lines.length && /^\|.+\|/.test(lines[i])) {
                tableLines.push(lines[i]);
                i++;
            }
            nodes.push(renderTable(tableLines, key++, onOpenChatMessage));
            continue;
        }

        // Unordered list item
        if (/^\s*[-*]\s/.test(line)) {
            const indent = line.match(/^(\s*)/)?.[1].length || 0;
            const text = line.replace(/^\s*[-*]\s/, '');
            nodes.push(
                <div key={key++} className="flex gap-1.5 text-[12px] text-vd-text-secondary" style={{ paddingLeft: `${Math.min(indent, 8) * 4}px` }}>
                    <span className="text-vd-text-tertiary flex-shrink-0">•</span>
                    <span>{renderInline(text, onOpenChatMessage)}</span>
                </div>
            );
            i++;
            continue;
        }

        // Ordered list item
        const olMatch = line.match(/^\s*(\d+)\.\s(.+)/);
        if (olMatch) {
            nodes.push(
                <div key={key++} className="flex gap-1.5 text-[12px] text-vd-text-secondary">
                    <span className="text-vd-text-tertiary flex-shrink-0 w-4 text-right">{olMatch[1]}.</span>
                    <span>{renderInline(olMatch[2], onOpenChatMessage)}</span>
                </div>
            );
            i++;
            continue;
        }

        // Empty line
        if (line.trim() === '') {
            nodes.push(<div key={key++} className="h-1.5" />);
            i++;
            continue;
        }

        // Regular paragraph
        nodes.push(
            <p key={key++} className="text-[12px] text-vd-text-secondary leading-relaxed">
                {renderInline(line, onOpenChatMessage)}
            </p>
        );
        i++;
    }

    return nodes;
}

// AD-186: chat-message id token. Existing breadcrumb comments wrap the id
// in inline-code (e.g. `m-moimstfc-aatd`), so we hijack the inline-code
// branch when the captured text matches this shape.
const CHAT_MSG_ID_RE = /^m-[a-z0-9-]+$/;

/** Render inline markdown: bold, italic, code, links, strikethrough */
function renderInline(text: string, onOpenChatMessage?: (id: string) => void): React.ReactNode {
    // Split by inline patterns and rebuild
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let partKey = 0;

    while (remaining.length > 0) {
        // Bold **text**
        const boldMatch = remaining.match(/^([\s\S]*?)\*\*([^*]+)\*\*([\s\S]*)/);
        if (boldMatch) {
            if (boldMatch[1]) parts.push(boldMatch[1]);
            parts.push(<strong key={partKey++} className="font-semibold text-vd-text-primary">{boldMatch[2]}</strong>);
            remaining = boldMatch[3];
            continue;
        }

        // Inline code `text`
        const codeMatch = remaining.match(/^([\s\S]*?)`([^`]+)`([\s\S]*)/);
        if (codeMatch) {
            if (codeMatch[1]) parts.push(codeMatch[1]);
            const codeText = codeMatch[2];
            // AD-186: chat-message id rendered as a clickable link instead
            // of plain code when an opener is wired.
            if (onOpenChatMessage && CHAT_MSG_ID_RE.test(codeText)) {
                const id = codeText;
                parts.push(
                    <button
                        key={partKey++}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenChatMessage(id); }}
                        className="px-1 py-0.5 bg-vd-bg-primary rounded text-[11px] font-mono text-vd-accent-gold hover:underline"
                        title="Open in Brain Dump"
                    >
                        {codeText}
                    </button>
                );
            } else {
                parts.push(<code key={partKey++} className="px-1 py-0.5 bg-vd-bg-primary rounded text-[11px] font-mono text-vd-accent-gold">{codeText}</code>);
            }
            remaining = codeMatch[3];
            continue;
        }

        // Strikethrough ~~text~~
        const strikeMatch = remaining.match(/^([\s\S]*?)~~([^~]+)~~([\s\S]*)/);
        if (strikeMatch) {
            if (strikeMatch[1]) parts.push(strikeMatch[1]);
            parts.push(<del key={partKey++} className="text-vd-text-tertiary">{strikeMatch[2]}</del>);
            remaining = strikeMatch[3];
            continue;
        }

        // No more inline patterns
        parts.push(remaining);
        break;
    }

    return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/** Render a markdown table */
function renderTable(lines: string[], tableKey: number, onOpenChatMessage?: (id: string) => void): React.ReactNode {
    const rows = lines
        .filter(line => !/^\|[\s-:|]+\|$/.test(line)) // skip separator row
        .map(line =>
            line.split('|').filter(Boolean).map(cell => cell.trim())
        );

    if (rows.length === 0) return null;
    const header = rows[0];
    const body = rows.slice(1);

    return (
        <div key={tableKey} className="overflow-x-auto my-1.5">
            <table className="w-full text-[11px] border-collapse">
                <thead>
                    <tr>
                        {header.map((cell, j) => (
                            <th key={j} className="text-left px-2 py-1 border-b border-vd-border text-vd-text-primary font-semibold bg-vd-bg-primary">
                                {renderInline(cell)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {body.map((row, ri) => (
                        <tr key={ri}>
                            {row.map((cell, ci) => (
                                <td key={ci} className="px-2 py-1 border-b border-vd-border/50 text-vd-text-secondary">
                                    {renderInline(cell)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** Max lines before truncation with "show more" */
const COLLAPSED_HEIGHT = 200; // px

function CommentContent({ content, onOpenChatMessage }: { content: string; onOpenChatMessage?: (id: string) => void }) {
    const [expanded, setExpanded] = useState(false);
    if (!content) return null;
    const isMd = isMarkdownContent(content);
    const isLong = content.split('\n').length > 12 || content.length > 800;

    if (isMd) {
        const rendered = renderMarkdown(content, onOpenChatMessage);
        return (
            <div className="mt-1.5 bg-vd-bg-tertiary/50 border border-vd-border/50 rounded-lg px-3 py-2">
                {isLong && !expanded ? (
                    <>
                        <div className="overflow-hidden relative" style={{ maxHeight: `${COLLAPSED_HEIGHT}px` }}>
                            {rendered}
                            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-vd-bg-tertiary/90 to-transparent" />
                        </div>
                        <button
                            onClick={() => setExpanded(true)}
                            className="text-xs text-vd-accent-gold hover:text-vd-accent-gold-light mt-1 font-medium"
                        >
                            Show more
                        </button>
                    </>
                ) : (
                    <>
                        {rendered}
                        {isLong && (
                            <button
                                onClick={() => setExpanded(false)}
                                className="text-xs text-vd-accent-gold hover:text-vd-accent-gold-light mt-1 font-medium"
                            >
                                Show less
                            </button>
                        )}
                    </>
                )}
            </div>
        );
    }

    // Plain text — original behavior
    const lines = content.split('\n');
    const needsTruncation = lines.length > 10;

    if (!needsTruncation || expanded) {
        return (
            <>
                <p className="text-sm text-vd-text-secondary mt-0.5 whitespace-pre-wrap">{content}</p>
                {needsTruncation && (
                    <button onClick={() => setExpanded(false)} className="text-xs text-vd-accent-gold hover:text-vd-accent-gold-light mt-1">
                        Show less
                    </button>
                )}
            </>
        );
    }

    const truncated = lines.slice(0, 10).join('\n');
    return (
        <>
            <p className="text-sm text-vd-text-secondary mt-0.5 whitespace-pre-wrap">{truncated}...</p>
            <button onClick={() => setExpanded(true)} className="text-xs text-vd-accent-gold hover:text-vd-accent-gold-light mt-1">
                Show more ({lines.length - 10} more lines)
            </button>
        </>
    );
}

/** Copy button for comments */
function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [text]);

    return (
        <button
            onClick={handleCopy}
            className={`text-[10px] transition-colors ml-1 ${
                copied
                    ? 'text-emerald-400'
                    : 'text-vd-text-tertiary/0 group-hover/comment:text-vd-text-tertiary hover:text-vd-text-secondary'
            }`}
            title="Copy comment"
        >
            {copied ? 'Copied' : 'Copy'}
        </button>
    );
}

/** VD-190: How many entries to show by default before "Load earlier" */
const DEFAULT_VISIBLE_ENTRIES = 12;

function getCommentDisplayText(comment: Comment): string {
    // Check content field first, then common alternative field names agents might use
    const raw = comment as unknown as Record<string, unknown>;
    const direct = typeof raw.content === 'string' ? (raw.content as string).trim()
        : typeof raw.text === 'string' ? (raw.text as string).trim()
        : typeof raw.body === 'string' ? (raw.body as string).trim()
        : typeof raw.message === 'string' ? (raw.message as string).trim()
        : '';
    if (direct) return direct;
    const attachmentCount = Array.isArray(comment.images) ? comment.images.length : 0;
    if (attachmentCount > 0) {
        return `[Attached ${attachmentCount} file${attachmentCount === 1 ? '' : 's'}]`;
    }
    return '[Empty comment]';
}

export function CommentTimeline({ comments, activity, onDeleteComment, onImageClick, onOpenChatMessage }: CommentTimelineProps) {
    const _tick = useTimeTick(); // re-render every 30s for timestamp aging
    const [showAll, setShowAll] = useState(false);

    // Build unified timeline sorted chronologically
    const entries: TimelineEntry[] = [];

    for (const c of comments) {
        entries.push({ kind: 'comment', data: c });
    }
    if (activity) {
        for (const a of activity) {
            // Normalize: Claude Code writes {type, actor, actorType, timestamp}
            // but UI expects {action, by, byType, at}
            const raw = a as unknown as Record<string, unknown>;
            const normalized: ActivityEntry = {
                action: (raw.action as string) || (raw.type as string) || '',
                by: (raw.by as string) || (raw.actor as string) || 'Unknown',
                byType: (raw.byType as 'human' | 'ai') || (raw.actorType as 'human' | 'ai') || 'ai',
                at: (raw.at as string) || (raw.timestamp as string) || '',
                from: raw.from as string | undefined,
                to: raw.to as string | undefined,
                snapshot: raw.snapshot as ActivityEntry['snapshot'],
            };
            // Map type field values to action field values
            if (normalized.action === 'status_change') {
                normalized.action = 'status_changed';
            }
            // Skip malformed entries that can't be meaningfully displayed
            if (!normalized.action || !normalized.at) continue;
            entries.push({ kind: 'activity', data: normalized });
        }
    }

    // Sort by date ascending (NaN-safe: invalid dates sort to the end)
    entries.sort((a, b) => {
        const dateA = a.kind === 'comment' ? a.data.createdAt : a.data.at;
        const dateB = b.kind === 'comment' ? b.data.createdAt : b.data.at;
        const tsA = new Date(dateA).getTime();
        const tsB = new Date(dateB).getTime();
        if (isNaN(tsA) && isNaN(tsB)) return 0;
        if (isNaN(tsA)) return 1;
        if (isNaN(tsB)) return -1;
        return tsA - tsB;
    });

    if (entries.length === 0) {
        return <p className="text-sm text-vd-text-tertiary italic">No activity yet</p>;
    }

    // VD-190: Show last N entries by default, "Load earlier" for the rest
    const needsPagination = entries.length > DEFAULT_VISIBLE_ENTRIES && !showAll;
    const hiddenCount = needsPagination ? entries.length - DEFAULT_VISIBLE_ENTRIES : 0;
    const visibleEntries = needsPagination ? entries.slice(-DEFAULT_VISIBLE_ENTRIES) : entries;

    return (
        <div className="space-y-3">
            {needsPagination && (
                <button
                    onClick={() => setShowAll(true)}
                    className="w-full text-center text-xs text-vd-accent-gold hover:text-vd-accent-gold-light py-1.5 border border-dashed border-vd-border/50 rounded-md hover:border-vd-accent-gold/30 transition-colors"
                >
                    Load earlier ({hiddenCount} older {hiddenCount === 1 ? 'entry' : 'entries'})
                </button>
            )}
            {visibleEntries.map((entry, i) => {
                if (entry.kind === 'activity') {
                    const act = entry.data;
                    return (
                        <div key={`act-${i}`} className="text-[11px] text-vd-text-tertiary py-0.5">
                            <div className="flex items-center gap-2">
                                <div className="w-8 flex items-center justify-center flex-shrink-0">
                                    {act.byType === 'ai' ? <AiAvatar author={act.by} /> : <span className="text-vd-accent-gold">👤</span>}
                                </div>
                                <span className="text-vd-text-secondary font-medium">{act.by}</span>
                                <span>{formatActivity(act)}</span>
                                <span className="ml-auto flex-shrink-0">{timeAgo(act.at)}</span>
                            </div>
                            {/* Show snapshot of initial title/description if captured */}
                            {act.snapshot?.title && (
                                <div className="ml-10 mt-0.5 text-[10px] text-vd-text-tertiary/70 italic max-w-[400px]">
                                    <div className="truncate" title={act.snapshot.title}>
                                        &quot;{act.snapshot.title}&quot;
                                    </div>
                                    {act.snapshot.description && (
                                        <div className="truncate mt-0.5 opacity-80" title={act.snapshot.description}>
                                            {act.snapshot.description.slice(0, 100)}{act.snapshot.description.length > 100 ? '...' : ''}
                                        </div>
                                    )}
                                </div>
                            )}
                            {/* Show old→new for title/description edits */}
                            {(act.action === 'title_edited' || act.action === 'description_edited') && act.from && (
                                <div className="ml-10 mt-0.5 text-[10px] text-vd-text-tertiary/70 truncate max-w-[400px]" title={`From: ${act.from}\nTo: ${act.to}`}>
                                    <span className="line-through opacity-60">{act.from.slice(0, 60)}</span>
                                    {' → '}
                                    <span>{act.to?.slice(0, 60)}</span>
                                </div>
                            )}
                        </div>
                    );
                }

                const comment = entry.data;
                // Resilient: some comments stored as 'text' instead of 'content'
                const commentText = getCommentDisplayText(comment);
                return (
                    <div key={comment.id} className="flex gap-3">
                        {/* Avatar */}
                        {comment.authorType === 'ai' ? (
                            <AiAvatar author={comment.author} />
                        ) : (
                            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold bg-vd-accent-gold/20 text-vd-accent-gold">
                                {comment.author.charAt(0).toUpperCase()}
                            </div>
                        )}

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 group/comment">
                                <span className="text-sm font-medium text-vd-text-primary">{comment.author}</span>
                                <span className="text-xs text-vd-text-tertiary">{timeAgo(comment.createdAt)}</span>
                                <CopyButton text={commentText} />
                                {onDeleteComment && (
                                    <button
                                        onClick={() => {
                                            if (window.confirm('Delete this comment?')) {
                                                onDeleteComment(comment.id);
                                            }
                                        }}
                                        className="text-[10px] text-red-400/0 group-hover/comment:text-red-400/60 hover:text-red-400 transition-colors ml-1"
                                        title="Delete comment"
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                            <CommentContent content={commentText} onOpenChatMessage={onOpenChatMessage} />

                            {/* Comment attachments — images + files */}
                            {comment.images && comment.images.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {comment.images.map((file, j) => {
                                        const fname = file.filename || (file as any).name || file.url?.split('/').pop() || 'file';
                                        const isImage = file.isImage !== false && !!fname.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|avif|tiff?)$/i);
                                        if (isImage) {
                                            return (
                                                <div key={j} className="space-y-0.5">
                                                    <button
                                                        onClick={() => onImageClick ? onImageClick(file.url) : window.open(file.url, '_blank')}
                                                        className="block w-20 h-20 rounded border border-vd-border overflow-hidden hover:ring-1 hover:ring-vd-accent-gold transition-all cursor-pointer">
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img src={file.url} alt={fname} className="w-full h-full object-cover" />
                                                    </button>
                                                    {file.caption && (
                                                        <p className="text-[9px] text-vd-text-tertiary max-w-[80px] leading-tight">{file.caption}</p>
                                                    )}
                                                </div>
                                            );
                                        }
                                        // Non-image file — render as file chip
                                        return (
                                            <div key={j} className="space-y-0.5">
                                                <a href={file.url} target="_blank" rel="noopener noreferrer"
                                                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-vd-border bg-vd-bg-tertiary max-w-[200px] hover:ring-1 hover:ring-vd-accent-gold transition-all">
                                                    <span className="text-sm">{getFileIcon(fname)}</span>
                                                    <span className="text-[10px] text-vd-text-secondary truncate">{fname}</span>
                                                    {file.size && <span className="text-[9px] text-vd-text-tertiary flex-shrink-0">{formatSize(file.size)}</span>}
                                                </a>
                                                {file.caption && (
                                                    <p className="text-[9px] text-vd-text-tertiary max-w-[200px] leading-tight">{file.caption}</p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
