'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Ticket } from './TicketCard';
import { CommentTimeline } from './CommentTimeline';
import { ImageDropZone, UploadedFile } from './ImageDropZone';
import { TagInput } from './TagInput';
import { type Relation, type RelationKind, RELATION_KINDS, RELATION_LABEL } from '@/lib/feedback/relations';
import { compressImage } from '@/lib/feedback/imageCompress';
import { buildRunPrompt } from '@/lib/feedback/runPrompt';
import { isTicketExecutionActive } from '@/lib/feedback/executionState';
import { CoachMark } from './CoachMark';
import {
    buildComparisonRows,
    parseExpectationSections,
    summarizeChatTranscript,
    type ComparisonRow,
} from '@/lib/feedback/ticketComparison';

// Build the "copy for AI" prompt text from ticket(s)
function buildPrompt(tickets: Ticket[]): string {
    return buildRunPrompt(tickets.map(t => t.id));
}

function getCreatorLabel(ticket: Ticket & { sourceMessageId?: string; createdByType?: 'human' | 'ai' | 'system' }): string {
    if (ticket.sourceMessageId) return `AI for ${ticket.reporter || 'you'}`;
    const createdActivity = ticket.activity?.find(entry => entry.action === 'created');
    const createdByType = ticket.createdByType || createdActivity?.byType;
    if (createdByType === 'ai' || createdByType === 'system' || ticket.tags?.includes('ai')) return 'AI';
    return ticket.reporter;
}

// Run | Copy split button
function RunButton({
    ticket,
    onOpenTerminal,
    activeExecutionIds,
}: {
    ticket: Ticket;
    onOpenTerminal?: () => void;
    activeExecutionIds?: Set<string>;
}) {
    const [isRunning, setIsRunning] = useState(false);
    const [terminalStatus, setTerminalStatus] = useState<{
        connected: boolean;
        agentActive: boolean;
        requestStatus: 'idle' | 'dispatching' | 'running' | 'interrupted';
    } | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);
    const [copyFeedback, setCopyFeedback] = useState(false);
    const isExecuting = isTicketExecutionActive(ticket, activeExecutionIds);

    // AD-167: skip the poll while the tab is hidden so we don't carpet the
    // dev-server log with /api/terminal-status hits when nobody is looking.
    useEffect(() => {
        const poll = () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            fetch('/api/terminal-status')
                .then(r => r.json())
                .then(d => setTerminalStatus({
                    connected: !!d.connected,
                    agentActive: !!d.agentActive,
                    requestStatus: d.requestStatus === 'running' || d.requestStatus === 'dispatching' || d.requestStatus === 'interrupted' ? d.requestStatus : 'idle',
                }))
                .catch(() => setTerminalStatus({ connected: false, agentActive: false, requestStatus: 'idle' }));
        };
        poll();
        const interval = setInterval(poll, 2000);
        const onVisible = () => { if (document.visibilityState === 'visible') poll(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    const handleRun = async () => {
        // Not connected — prevent run and show guidance with terminal opening
        setIsRunning(true);
        setFeedback(null);
        try {
            const res = await fetch('/api/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticketId: ticket.id }),
            });
            const data = await res.json();
            if (data.success && data.terminal) {
                onOpenTerminal?.();
                setFeedback({
                    type: 'success',
                    message: data.message || 'Sent to coding agent.',
                });
                setTimeout(() => setFeedback(null), 3000);
            } else if (data.autoOpenTerminal || !data.agentReady) {
                onOpenTerminal?.();
                setFeedback({
                    type: 'error',
                    message: data.message || 'Start your coding agent, then run again.',
                });
            }
        } catch {
            setFeedback({ type: 'error', message: 'Failed to send the prompt to the coding agent.' });
        } finally {
            setIsRunning(false);
        }
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(buildPrompt([ticket]));
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 1500);
    };

    return (
        <div className="relative flex items-center">
            <button
                onClick={handleRun}
                disabled={isRunning}
                className={`relative transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                    !terminalStatus?.connected || !terminalStatus?.agentActive
                        ? 'text-vd-text-tertiary'
                        : isExecuting
                        ? 'text-vd-accent-gold animate-pulse'
                        : 'text-vd-accent-gold hover:text-vd-accent-gold-light'
                } ${
                    isExecuting ? 'ring-2 ring-vd-accent-gold/30 ring-offset-1 ring-offset-vd-bg-secondary' : ''
                }`}
                title={
                    !terminalStatus?.connected
                        ? 'Open terminal and start your coding agent'
                        : !terminalStatus?.agentActive
                            ? 'Coding agent is not running'
                            : isExecuting
                                ? 'Currently being worked on'
                                : 'Send prompt to coding agent'
                }
            >
                <span className={isExecuting ? 'relative' : ''}>
                    {isRunning ? '⚡ Executing...' : isExecuting ? '🔄 Running...' : '▶ Run'}
                    {isExecuting && (
                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-vd-accent-gold rounded-full animate-ping"></span>
                    )}
                </span>
            </button>
            <span className="text-vd-text-tertiary/30 mx-1.5">|</span>
            <button
                onClick={handleCopy}
                className="text-vd-accent-gold/60 hover:text-vd-accent-gold transition-colors"
                title="Copy prompt to clipboard"
            >
                {copyFeedback ? '✓ Copied' : 'Copy'}
            </button>

            {/* Feedback toast */}
            {feedback && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setFeedback(null)} />
                    <div className={`absolute right-0 top-full mt-2 border rounded-lg shadow-panel z-20 p-3 w-72 ${
                        feedback.type === 'error' ? 'bg-red-500/10 border-red-500/30' :
                        feedback.type === 'warning' ? 'bg-amber-500/10 border-amber-500/30' :
                        'bg-emerald-500/10 border-emerald-500/30'
                    }`}>
                        <p className={`text-[11px] font-medium mb-1 ${
                            feedback.type === 'error' ? 'text-red-400' :
                            feedback.type === 'warning' ? 'text-amber-400' :
                            'text-emerald-400'
                        }`}>
                            {feedback.type === 'error' ? 'Cannot Run' : feedback.type === 'warning' ? 'Sent to Terminal' : 'Done'}
                        </p>
                        <p className="text-[10px] text-vd-text-secondary">{feedback.message}</p>
                    </div>
                </>
            )}
        </div>
    );
}

const STATUSES = ['backlog', 'todo', 'reopen', 'done', 'reviewed', 'observe', 'deferred'] as const;
const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

const STATUS_LABELS: Record<string, string> = {
    backlog: 'Backlog',
    todo: 'To Do',
    reopen: 'Reopen',
    done: 'For Review',
    reviewed: 'Closed',
    observe: 'Observe',
    deferred: 'Deferred',
};

const STATUS_BADGE_COLORS: Record<string, string> = {
    backlog: 'bg-red-500/15 text-red-400',
    todo: 'bg-amber-500/15 text-amber-400',
    reopen: 'bg-purple-500/15 text-purple-400',
    done: 'bg-emerald-500/15 text-emerald-400',
    reviewed: 'bg-green-500/15 text-green-400',
    observe: 'bg-cyan-500/15 text-cyan-400',
    deferred: 'bg-slate-500/15 text-slate-400',
};

// Next-state transitions: primary = forward (→), non-primary = backward (←)
const NEXT_STATES: Record<string, { label: string; target: string; primary?: boolean; direction: 'forward' | 'back' }[]> = {
    backlog: [{ label: 'Todo', target: 'todo', primary: true, direction: 'forward' }],
    todo: [{ label: 'For Review', target: 'done', primary: true, direction: 'forward' }],
    reopen: [{ label: 'For Review', target: 'done', primary: true, direction: 'forward' }],
    done: [
        { label: 'Closed', target: 'reviewed', primary: true, direction: 'forward' },
        { label: 'Reopen', target: 'reopen', direction: 'back' },
    ],
    reviewed: [
        { label: 'Observe', target: 'observe', primary: true, direction: 'forward' },
        { label: 'Reopen', target: 'reopen', direction: 'back' },
    ],
    observe: [{ label: 'Reopen', target: 'reopen', direction: 'back' }],
    deferred: [
        { label: 'Todo', target: 'todo', primary: true, direction: 'forward' },
        { label: 'Backlog', target: 'backlog', direction: 'back' },
    ],
};

const PRIORITY_COLORS: Record<string, string> = {
    critical: 'text-red-400',
    high: 'text-orange-400',
    medium: 'text-yellow-400',
    low: 'text-blue-400',
};

const PRIORITY_ICONS: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🔵',
};

const AI_MENTION_OPTIONS = [
    { label: '@claude', help: 'Notify Claude only', accent: 'text-amber-300' },
    { label: '@codex', help: 'Notify Codex only', accent: 'text-emerald-300' },
    { label: '@chatgpt', help: 'Notify ChatGPT only', accent: 'text-cyan-300' },
];

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
}

interface TicketDetailModalProps {
    ticket: Ticket | null;
    open: boolean;
    onClose: () => void;
    onUpdate: (id: string, updates: Partial<Ticket>) => void;
    onAddComment: (ticketId: string, content: string, images: UploadedFile[]) => void;
    onDelete: (id: string) => void;
    onDeleteComment?: (ticketId: string, commentId: string) => void;
    allTags?: string[];
    missionOptions?: Array<{ id: string; title: string }>;
    waveOptions?: string[];
    sessionOptions?: string[];
    isSelected?: boolean;
    onToggleSelect?: (id: string) => void;
    onOpenTerminal?: () => void;
    activeExecutionIds?: Set<string>;
    terminalVisible?: boolean;
    terminalPlacement?: 'right' | 'left' | 'bottom' | 'top';
    // AD-137: coach marks
    coachMarks?: Record<string, boolean>;
    hideTips?: boolean;
    onCoachMarkSeen?: (key: string) => void;
    onHideAllTips?: () => void;
    // AD-180 follow-up: full ticket list for the Linked panel's title-search.
    // AD-251: also exposes priority + ticketType so the rendered row can
    // surface them next to status without a second lookup.
    allTickets?: Pick<Ticket, 'id' | 'title' | 'status' | 'priority' | 'ticketType'>[];
    // Open a sub-task quick-create with this ticket pre-filled as parent.
    onCreateSubtask?: (parentTicketId: string) => void;
    // AD-186: open the Brain Dump panel and scroll to a chat message id.
    onOpenChatMessage?: (messageId: string) => void;
    // AD-251: switch the modal to a different ticket when the user clicks a
    // linked row in the Linked Tickets panel. The parent (FeedbackBoard)
    // resolves the id and sets selectedTicket; we just hand it the id.
    onSelectTicket?: (ticketId: string) => void;
}

/** Description block with "See more" truncation for long descriptions */
const DESC_MAX_LINES = 12;
// AD-323: render the description as markdown so **bold**, lists, code spans and
// links land formatted instead of as raw asterisks. Pipeline copied from
// NotepadPane.tsx (AD-206): marked → DOMPurify → dangerouslySetInnerHTML.
// DOMPurify strips <script>, on* handlers and javascript: URLs, so a ticket
// description copied from anywhere is safe to render via innerHTML.
function renderDescriptionHtml(md: string): string {
    const raw = marked.parse(md, { async: false }) as string;
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

function DescriptionBlock({ description }: { description: string }) {
    const [expanded, setExpanded] = useState(false);
    const lines = description.split('\n');
    const needsTruncation = lines.length > DESC_MAX_LINES || description.length > 600;
    const visibleSource = needsTruncation && !expanded
        ? lines.slice(0, DESC_MAX_LINES).join('\n') + (lines.length > DESC_MAX_LINES ? '\n…' : '')
        : description;
    const html = useMemo(() => renderDescriptionHtml(visibleSource), [visibleSource]);

    return (
        <div>
            <h4 className="text-xs text-vd-text-tertiary uppercase tracking-wider mb-1">Description</h4>
            <div
                className="text-sm text-vd-text-secondary adhdev-markdown"
                dangerouslySetInnerHTML={{ __html: html }}
            />
            {needsTruncation && !expanded && (
                <button
                    onClick={() => setExpanded(true)}
                    className="text-xs text-vd-accent-gold hover:text-vd-accent-gold-light mt-1 font-medium"
                >
                    See more ({lines.length - DESC_MAX_LINES > 0 ? `${lines.length - DESC_MAX_LINES} more lines` : 'full text'})
                </button>
            )}
            {needsTruncation && expanded && (
                <button
                    onClick={() => setExpanded(false)}
                    className="text-xs text-vd-accent-gold hover:text-vd-accent-gold-light mt-1 font-medium"
                >
                    See less
                </button>
            )}
        </div>
    );
}

function ComparisonBadge({ status }: { status: ComparisonRow['status'] }) {
    const classes: Record<ComparisonRow['status'], string> = {
        pass: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25',
        warn: 'bg-amber-500/15 text-amber-300 border-amber-400/25',
        fail: 'bg-red-500/15 text-red-300 border-red-400/25',
    };
    const label: Record<ComparisonRow['status'], string> = {
        pass: 'Pass',
        warn: 'Watch',
        fail: 'Miss',
    };

    return (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${classes[status]}`}>
            {label[status]}
        </span>
    );
}

export function TicketDetailModal({
    ticket,
    open,
    onClose,
    onUpdate,
    onAddComment,
    onDelete,
    onDeleteComment,
    allTags = [],
    missionOptions = [],
    waveOptions = [],
    sessionOptions = [],
    isSelected,
    onToggleSelect,
    onOpenTerminal,
    activeExecutionIds,
    terminalVisible = false,
    terminalPlacement = 'right',
    coachMarks,
    hideTips,
    onCoachMarkSeen,
    onHideAllTips,
    allTickets = [],
    onCreateSubtask,
    onOpenChatMessage,
    onSelectTicket,
}: TicketDetailModalProps) {
    const [commentText, setCommentText] = useState('');
    const [commentImages, setCommentImages] = useState<UploadedFile[]>([]);
    const [submittingComment, setSubmittingComment] = useState(false);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // AD-322: ref to the modal's root element so the paste handler can scope
    // itself to the ticket-modal subtree (instead of listening on `document`,
    // which leaked Brain Dump pastes into the ticket comment composer).
    const modalRootRef = useRef<HTMLDivElement | null>(null);
    const [showAllStatuses, setShowAllStatuses] = useState(false);
    const [showMentionPopup, setShowMentionPopup] = useState(false);
    const commentTextareaRef = useRef<HTMLTextAreaElement>(null);
    const [markdownAttachmentText, setMarkdownAttachmentText] = useState<string | null>(null);
    const [loadingMarkdownAttachment, setLoadingMarkdownAttachment] = useState(false);
    const [markdownAttachmentError, setMarkdownAttachmentError] = useState<string | null>(null);
    const [terminalInset, setTerminalInset] = useState(0);
    const [livePlacement, setLivePlacement] = useState<'right' | 'left' | 'bottom' | 'top' | null>(null);
    const [desktopViewport, setDesktopViewport] = useState(false);
    // AD-137: refs + derived flags for inline coach marks.
    const runButtonWrapRef = useRef<HTMLDivElement>(null);
    const timelineRef = useRef<HTMLDivElement>(null);

    // Edit mode
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editMissionId, setEditMissionId] = useState('');
    const [editWave, setEditWave] = useState('');
    const [editSession, setEditSession] = useState('');
    // Track images during edit mode (add/remove)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [editImages, setEditImages] = useState<any[]>([]);

    // Toast helper
    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 2000);
    };

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const readSavedPlacement = (): 'right' | 'left' | 'bottom' | 'top' | null => {
            const raw = localStorage.getItem('adhdev-terminal-placement');
            return raw === 'left' || raw === 'right' || raw === 'bottom' || raw === 'top' ? raw : null;
        };
        const updateViewport = () => {
            setDesktopViewport(window.innerWidth >= 768);
            const saved = parseInt(localStorage.getItem('adhdev-terminal-size') || '', 10);
            setTerminalInset(saved >= 200 ? saved : 0);
            // AD-124: seed placement from localStorage too, so the modal works even if
            // it mounts after TerminalPane has already emitted its one-shot layout event.
            const p = readSavedPlacement();
            if (p) setLivePlacement(p);
        };
        // AD-124: live updates from TerminalPane whenever it resizes or re-docks.
        const onLayout = (e: Event) => {
            const detail = (e as CustomEvent<{ size: number; placement: 'right' | 'left' | 'bottom' | 'top' }>).detail;
            if (!detail) return;
            if (typeof detail.size === 'number') setTerminalInset(detail.size >= 200 ? detail.size : 0);
            if (detail.placement) setLivePlacement(detail.placement);
        };
        updateViewport();
        window.addEventListener('resize', updateViewport);
        window.addEventListener('storage', updateViewport);
        window.addEventListener('adhdev-terminal-layout', onLayout as EventListener);
        // AD-124: ask TerminalPane to re-broadcast its current layout so late-mounting
        // modals don't stay stale on the one-shot mount emit they missed.
        window.dispatchEvent(new CustomEvent('adhdev-terminal-layout-request'));
        return () => {
            window.removeEventListener('resize', updateViewport);
            window.removeEventListener('storage', updateViewport);
            window.removeEventListener('adhdev-terminal-layout', onLayout as EventListener);
        };
    }, []);

    const activePlacement = livePlacement ?? terminalPlacement;

    // AD-124 fix: if the terminal is visible but we haven't received a size yet
    // (localStorage empty + event hasn't round-tripped), fall back to the same
    // default TerminalPane uses — 40% of the relevant viewport dimension. This
    // prevents the modal backdrop from covering the terminal on first render.
    const effectiveInset = useMemo(() => {
        if (!terminalVisible || !desktopViewport || typeof window === 'undefined') return 0;
        if (terminalInset >= 200) return terminalInset;
        const isHorizontal = activePlacement === 'left' || activePlacement === 'right';
        const base = isHorizontal ? window.innerWidth : window.innerHeight;
        return Math.floor(base * 0.4);
    }, [terminalVisible, desktopViewport, terminalInset, activePlacement]);

    const modalViewportStyle = useMemo(() => {
        if (!terminalVisible || !desktopViewport || effectiveInset <= 0) return undefined;
        if (activePlacement === 'right') return { right: `${effectiveInset}px` };
        if (activePlacement === 'left') return { left: `${effectiveInset}px` };
        if (activePlacement === 'bottom') return { bottom: `${effectiveInset}px` };
        if (activePlacement === 'top') return { top: `${effectiveInset}px` };
        return undefined;
    }, [desktopViewport, effectiveInset, activePlacement, terminalVisible]);

    // Upload file helper for drag-drop and paste
    // Routes to editImages when in edit mode, commentImages otherwise
    const uploadAndAdd = useCallback(async (files: File[]) => {
        if (files.length === 0) return;
        showToast(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);
        const results: UploadedFile[] = [];
        let failures = 0;
        for (const file of files) {
            try {
                const isImage = file.type.startsWith('image/');
                const toUpload = isImage ? await compressImage(file) : file;
                const formData = new FormData();
                formData.append('file', toUpload);
                const res = await fetch('/api/feedback/upload', { method: 'POST', body: formData });
                if (res.ok) {
                    const data = await res.json();
                    results.push({ url: data.url, filename: data.filename, isImage: data.isImage ?? isImage, size: data.size ?? file.size, uploadedAt: new Date().toISOString() });
                } else {
                    failures++;
                }
            } catch {
                failures++;
            }
        }
        if (results.length > 0) {
            if (isEditing) {
                setEditImages(prev => [...prev, ...results]);
                showToast(`${results.length} file${results.length > 1 ? 's' : ''} added to ticket`);
            } else {
                setCommentImages(prev => [...prev, ...results]);
                showToast(`${results.length} file${results.length > 1 ? 's' : ''} added to comment`);
            }
        } else if (failures > 0) {
            showToast(`Upload failed — try again`);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditing]);

    // Full-screen drag-drop handler (drop anywhere adds to comment images)
    const handleModalDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragLeaveTimer.current) { clearTimeout(dragLeaveTimer.current); dragLeaveTimer.current = null; }
        setIsDraggingOver(true);
    }, []);

    const handleModalDragLeave = useCallback((e: React.DragEvent) => {
        e.stopPropagation();
        // fix: timer-based dismiss — if no dragover fires within 150ms, the drag truly left
        if (dragLeaveTimer.current) clearTimeout(dragLeaveTimer.current);
        dragLeaveTimer.current = setTimeout(() => setIsDraggingOver(false), 150);
    }, []);

    const handleModalDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
        if (dragLeaveTimer.current) { clearTimeout(dragLeaveTimer.current); dragLeaveTimer.current = null; }
        if (e.dataTransfer.files.length > 0) {
            uploadAndAdd(Array.from(e.dataTransfer.files));
        }
    }, [uploadAndAdd]);

    // Modal-scoped paste handler — paste images anywhere INSIDE the ticket
    // modal adds to the comment images.
    //
    // AD-322: previously this was attached to `document` and fired for ANY
    // Ctrl+V on the page. When the Brain Dump pane was open alongside an
    // open ticket detail (a common combo — triage one, dump another), a paste
    // intended for the chat composer ALSO got swallowed by the ticket modal,
    // duplicating the screenshot into both surfaces.
    //
    // Fix: bind the listener to the modal's root element instead of document.
    // The modal occupies the viewport (z-50 fixed inset-0), so pastes that
    // target the ticket area still fire normally — but the Brain Dump panel
    // sits at a higher z-index and its textarea pastes never bubble here.
    // ChatPane's own paste handler is already textarea-scoped (AD-186 reopen),
    // and NewTicketModal's global paste only mounts when its `open` is true
    // (not when only the detail modal is open), so the user's "don't break
    // ticket comment / board-paste / brain-dump-paste" constraints all hold.
    useEffect(() => {
        if (!open) return;
        const root = modalRootRef.current;
        if (!root) return;
        const handlePaste = (e: Event) => {
            const ev = e as ClipboardEvent;
            const items = ev.clipboardData?.items;
            if (!items) return;
            const files: File[] = [];
            for (let i = 0; i < items.length; i++) {
                if (items[i].kind === 'file') {
                    const f = items[i].getAsFile();
                    if (f) files.push(f);
                }
            }
            if (files.length > 0) {
                ev.preventDefault();
                uploadAndAdd(files);
            }
        };
        root.addEventListener('paste', handlePaste);
        return () => root.removeEventListener('paste', handlePaste);
    }, [open, uploadAndAdd]);

    // Escape to close
    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (lightboxUrl) {
                    setLightboxUrl(null);
                } else if (isEditing) {
                    setIsEditing(false);
                } else {
                    onClose();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, lightboxUrl, isEditing, onClose]);

    // Reset edit state and close dropdowns when ticket changes
    useEffect(() => {
        setIsEditing(false);
        setShowAllStatuses(false);
        setMarkdownAttachmentText(null);
        setMarkdownAttachmentError(null);
    }, [ticket?.id]);

    const markdownAttachment = useMemo(() => {
        if (!ticket) return null;
        return ticket.images.find(img => /\.md$/i.test(img.filename)) ?? null;
    }, [ticket]);

    useEffect(() => {
        if (!open || !markdownAttachment) return;
        let cancelled = false;
        setLoadingMarkdownAttachment(true);
        setMarkdownAttachmentError(null);

        fetch(markdownAttachment.url)
            .then(async (res) => {
                if (!res.ok) {
                    throw new Error(`Failed to load transcript (${res.status})`);
                }
                return res.text();
            })
            .then((text) => {
                if (!cancelled) setMarkdownAttachmentText(text);
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setMarkdownAttachmentError(error instanceof Error ? error.message : 'Failed to load transcript');
                }
            })
            .finally(() => {
                if (!cancelled) setLoadingMarkdownAttachment(false);
            });

        return () => {
            cancelled = true;
        };
    }, [open, markdownAttachment]);

    const expectation = useMemo(() => parseExpectationSections(ticket?.description ?? ''), [ticket?.description]);
    const transcriptSummary = useMemo(
        () => summarizeChatTranscript(markdownAttachmentText ?? ''),
        [markdownAttachmentText]
    );
    const comparisonRows = useMemo(
        () => buildComparisonRows(expectation, transcriptSummary),
        [expectation, transcriptSummary]
    );

    // Close overflow dropdown on outside click
    useEffect(() => {
        if (!showAllStatuses) return;
        const handleClick = () => setShowAllStatuses(false);
        // Delay to avoid closing on the same click that opened it
        const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
        return () => { clearTimeout(timer); document.removeEventListener('click', handleClick); };
    }, [showAllStatuses]);

    // Aggregate all media from ticket + comments (must be before early return — hooks rule)
    const allMedia = useMemo(() => {
        if (!ticket) return [];
        const media: { url: string; filename: string; source: string; caption?: string }[] = [];
        for (const img of ticket.images) {
            media.push({ url: img.url, filename: img.filename, source: 'ticket', caption: img.caption });
        }
        for (const comment of ticket.comments) {
            const imgs = comment.images || [];
            for (const img of imgs) {
                const fname = img.filename || img.url.split('/').pop() || 'image';
                media.push({ url: img.url, filename: fname, source: comment.author || 'Unknown', caption: img.caption });
            }
        }
        return media;
    }, [ticket]);

    if (!open || !ticket) return null;

    // Can edit title/description if ticket is in an open status
    const canEdit = ['backlog', 'todo', 'reopen'].includes(ticket.status);

    const handleStatusChange = (newStatus: string) => {
        onUpdate(ticket.id, { status: newStatus });
    };

    const handlePriorityChange = (newPriority: string) => {
        onUpdate(ticket.id, { priority: newPriority as Ticket['priority'] });
    };


    const handleStartEdit = () => {
        setEditTitle(ticket.title);
        setEditDescription(ticket.description);
        setEditMissionId(ticket.missionId || '');
        setEditWave(ticket.wave || '');
        setEditSession(ticket.session || '');
        // Initialize edit images from ticket
        setEditImages([...ticket.images]);
        setIsEditing(true);
    };

    const handleSaveEdit = () => {
        // Save images along with title/description
        onUpdate(ticket.id, {
            title: editTitle,
            description: editDescription,
            missionId: editMissionId,
            wave: editWave.trim(),
            session: editSession.trim(),
            images: editImages,
        });
        setIsEditing(false);
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
    };

    // Tags
    const handleAddTag = (tag: string) => {
        const trimmed = tag.trim().toLowerCase();
        if (!trimmed) return;
        const currentTags = ticket.tags || [];
        if (currentTags.includes(trimmed)) return;
        onUpdate(ticket.id, { tags: [...currentTags, trimmed] });
    };

    const handleRemoveTag = (tagToRemove: string) => {
        const currentTags = ticket.tags || [];
        onUpdate(ticket.id, { tags: currentTags.filter(t => t !== tagToRemove) });
    };

    const handleSubmitComment = async () => {
        if (!commentText.trim() && commentImages.length === 0) return;
        if (submittingComment) return; // Prevent double-submit
        const pendingText = commentText;
        const pendingImages = commentImages;
        setSubmittingComment(true);
        setCommentText('');
        setCommentImages([]);
        try {
            await onAddComment(ticket.id, pendingText, pendingImages);
            showToast('Comment posted');
        } catch {
            setCommentText(pendingText);
            setCommentImages(pendingImages);
            showToast('Failed to post comment — try again');
        } finally {
            setSubmittingComment(false);
        }
    };

    const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            showToast('Posting comment...');
            handleSubmitComment();
        }
    };

    return (
        <>
            <div
                ref={modalRootRef}
                className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
                style={modalViewportStyle}
                onDragOver={handleModalDragOver}
                onDragLeave={handleModalDragLeave}
                onDrop={handleModalDrop}
            >
                {/* Backdrop */}
                <div className={`absolute inset-0 bg-black/60 ${terminalVisible && desktopViewport ? '' : 'backdrop-blur-sm'}`} onClick={onClose} />

                {/* Full-screen drag overlay */}
                {isDraggingOver && (
                    <div className="absolute inset-0 z-[65] bg-vd-accent-gold/10 border-4 border-dashed border-vd-accent-gold/50 flex items-center justify-center pointer-events-none">
                        <div className="bg-vd-bg-secondary/90 rounded-xl px-8 py-6 text-center shadow-xl">
                            <div className="text-3xl mb-2">📎</div>
                            <p className="text-sm font-medium text-vd-text-primary">Drop files to add to comment</p>
                            <p className="text-xs text-vd-text-tertiary mt-1">Images, PDFs, documents</p>
                        </div>
                    </div>
                )}

                {/* Toast (near comment area for visibility) */}
                {toast && (
                    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-lg bg-vd-accent-gold/90 text-vd-bg-primary text-xs font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
                        {toast}
                    </div>
                )}

                {/* Modal — bottom sheet on mobile */}
                <div className="relative bg-vd-bg-secondary border border-vd-border rounded-t-xl md:rounded-xl w-full max-w-2xl md:mx-4 max-h-[90vh] flex flex-col shadow-panel">
                    {/* Sticky header bar — two rows: top = ID + actions, bottom = status controls */}
                    <div className="sticky top-0 bg-vd-bg-secondary border-b border-vd-border z-10 flex-shrink-0">
                        {/* Row 1: ID + badges + Edit/Close */}
                        <div className="flex items-center justify-between gap-3 px-5 pt-2.5 pb-1.5">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(ticket.id);
                                        // AD-160: silent copy was confusing —
                                        // surface a toast so the click
                                        // visibly registers.
                                        showToast(`Copied ${ticket.id}`);
                                    }}
                                    title="Click to copy ID"
                                    className="text-xs font-mono text-vd-accent-gold bg-vd-accent-gold/10 px-2 py-0.5 rounded hover:bg-vd-accent-gold/20 transition-colors cursor-pointer"
                                >
                                    {ticket.id}
                                </button>
                                {(ticket.reopenCount ?? 0) > 0 && (
                                    <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">
                                        ↻ Reopened {ticket.reopenCount}×
                                    </span>
                                )}
                                {/* Discussion/Normal toggle */}
                                <button
                                    onClick={() => {
                                        const isDiscussion = ticket.ticketType === 'idea' || ticket.ticketType === 'discussion';
                                        onUpdate(ticket.id, { ticketType: isDiscussion ? 'normal' : 'discussion' } as Partial<Ticket>);
                                    }}
                                    className={`text-xs font-semibold px-2 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer ${
                                        (ticket.ticketType === 'idea' || ticket.ticketType === 'discussion')
                                            ? 'bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25'
                                            : 'bg-vd-bg-tertiary text-vd-text-tertiary hover:text-vd-text-secondary hover:bg-vd-bg-hover'
                                    }`}
                                    title={(ticket.ticketType === 'idea' || ticket.ticketType === 'discussion')
                                        ? 'Discussion mode ON — AI will not make code changes. Click to switch to Normal.'
                                        : 'Normal mode — AI can make code changes. Click to switch to Discussion (safety lock).'}
                                >
                                    {(ticket.ticketType === 'idea' || ticket.ticketType === 'discussion') ? (
                                        <>
                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                                            Discussion
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                                            Normal
                                        </>
                                    )}
                                </button>
                                {/* Priority with icon */}
                                <div className="flex items-center gap-1">
                                    <span className="text-xs" title={ticket.priority}>{PRIORITY_ICONS[ticket.priority] || '⚪'}</span>
                                    <select
                                        value={ticket.priority}
                                        onChange={(e) => handlePriorityChange(e.target.value)}
                                        className={`text-xs bg-vd-bg-input border border-vd-border rounded-md px-1.5 py-1 focus:border-vd-accent-gold focus:outline-none ${PRIORITY_COLORS[ticket.priority]}`}
                                    >
                                        {PRIORITIES.map((p) => (
                                            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                                        ))}
                                    </select>
                                </div>
                                {/* Select for batch */}
                                {onToggleSelect && (
                                    <button
                                        onClick={() => onToggleSelect(ticket.id)}
                                        title={isSelected ? 'Remove from selection' : 'Add to selection'}
                                        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all border ${
                                            isSelected
                                                ? 'bg-vd-accent-gold/15 border-vd-accent-gold/30 text-vd-accent-gold'
                                                : 'bg-vd-bg-secondary/60 border-vd-border text-vd-text-tertiary hover:border-vd-accent-gold/20 hover:text-vd-text-secondary'
                                        }`}
                                    >
                                        <span className={`w-3 h-3 rounded flex items-center justify-center flex-shrink-0 border ${
                                            isSelected ? 'bg-vd-accent-gold border-vd-accent-gold' : 'border-vd-text-tertiary'
                                        }`}>
                                            {isSelected && (
                                                <svg className="w-2 h-2 text-vd-bg-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </span>
                                        Select
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                {/* AD-160: Run | Copy lives in the sticky
                                    header so it stays in view as the user
                                    scrolls the timeline. Was previously in
                                    the bottom metadata row, which scrolls
                                    out of sight in long discussions. */}
                                <div ref={runButtonWrapRef} className="relative">
                                    <RunButton
                                        ticket={ticket}
                                        onOpenTerminal={onOpenTerminal}
                                        activeExecutionIds={activeExecutionIds}
                                    />
                                </div>
                                {canEdit && !isEditing && (
                                    <button
                                        onClick={handleStartEdit}
                                        className="text-xs text-vd-text-tertiary hover:text-vd-accent-gold transition-colors px-2 py-1 rounded hover:bg-vd-bg-hover"
                                    >
                                        Edit
                                    </button>
                                )}
                                {isEditing && (
                                    <>
                                        <button
                                            onClick={handleSaveEdit}
                                            className="text-xs text-vd-accent-gold hover:text-vd-accent-gold-light transition-colors px-2 py-1 rounded bg-vd-accent-gold/10"
                                        >
                                            Save
                                        </button>
                                        <button
                                            onClick={handleCancelEdit}
                                            className="text-xs text-vd-text-tertiary hover:text-vd-text-primary transition-colors px-2 py-1"
                                        >
                                            Cancel
                                        </button>
                                    </>
                                )}
                                <button onClick={onClose} className="text-vd-text-tertiary hover:text-vd-text-primary text-xl leading-none">×</button>
                            </div>
                        </div>
                        {/* Row 2: Status group — current status + transitions bound together */}
                        {/* Row 2: [← Back] [Current Status] [Forward →] */}
                        <div className="flex items-center gap-0.5 px-5 pb-2.5">
                            <div className="inline-flex items-center rounded-lg border border-vd-border overflow-hidden bg-vd-bg-tertiary">
                                {/* Back transitions (← on the left) */}
                                {(NEXT_STATES[ticket.status] || []).filter(a => a.direction === 'back').map((action) => (
                                    <button
                                        key={action.target}
                                        onClick={() => handleStatusChange(action.target)}
                                        className="text-xs px-2.5 py-1.5 text-vd-text-secondary hover:bg-vd-bg-hover transition-colors"
                                    >
                                        ← {action.label}
                                    </button>
                                ))}
                                {/* Separator before current status */}
                                {(NEXT_STATES[ticket.status] || []).some(a => a.direction === 'back') && (
                                    <div className="w-px h-5 bg-vd-border" />
                                )}
                                {/* Current status (center) */}
                                <span className={`text-xs font-semibold px-3 py-1.5 ${STATUS_BADGE_COLORS[ticket.status] || 'bg-vd-bg-tertiary text-vd-text-tertiary'}`}>
                                    {STATUS_LABELS[ticket.status] || ticket.status}
                                </span>
                                {/* Separator after current status */}
                                {(NEXT_STATES[ticket.status] || []).some(a => a.direction === 'forward') && (
                                    <div className="w-px h-5 bg-vd-border" />
                                )}
                                {/* Forward transitions (→ on the right) */}
                                {(NEXT_STATES[ticket.status] || []).filter(a => a.direction === 'forward').map((action) => (
                                    <button
                                        key={action.target}
                                        onClick={() => handleStatusChange(action.target)}
                                        className="text-xs px-2.5 py-1.5 text-vd-accent-gold hover:bg-vd-accent-gold/15 font-medium transition-colors"
                                    >
                                        {action.label} →
                                    </button>
                                ))}
                                {/* More statuses */}
                                <div className="relative">
                                    <button
                                        onClick={() => setShowAllStatuses(!showAllStatuses)}
                                        className="text-xs px-2 py-1.5 text-vd-text-tertiary hover:text-vd-text-secondary hover:bg-vd-bg-hover transition-colors"
                                        title="All statuses"
                                    >
                                        ···
                                    </button>
                                    {showAllStatuses && (
                                        <div className="absolute top-full right-0 mt-1 bg-vd-bg-secondary border border-vd-border rounded-lg shadow-panel py-1 z-20 min-w-[120px]">
                                            {STATUSES.filter(s => s !== ticket.status).map((s) => (
                                                <button
                                                    key={s}
                                                    onClick={() => { handleStatusChange(s); setShowAllStatuses(false); }}
                                                    className="w-full text-left px-3 py-1.5 text-xs text-vd-text-secondary hover:bg-vd-bg-hover hover:text-vd-text-primary transition-colors"
                                                >
                                                    {STATUS_LABELS[s]}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Scrollable body: title + content + timeline */}
                    <div className="overflow-y-auto flex-1">
                    {/* Title (scrolls with content, not pinned) */}
                    <div className="px-5 pt-4 pb-2">
                        {isEditing ? (
                            <input
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                className="w-full text-lg font-semibold bg-vd-bg-input border border-vd-border rounded-lg px-3 py-1.5 text-vd-text-primary focus:border-vd-accent-gold focus:outline-none"
                                autoFocus
                                onKeyDown={(e) => {
                                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSaveEdit();
                                    else if (e.key === 'Enter') handleSaveEdit();
                                    else if (e.key === 'Escape') handleCancelEdit();
                                }}
                            />
                        ) : (
                            <h2 className="text-lg font-semibold text-vd-text-primary leading-snug">
                                {ticket.title}
                            </h2>
                        )}
                    </div>

                    {/* Body */}
                    <div className="px-5 pb-5 space-y-5">
                        {/* Description */}
                        {isEditing ? (
                            <div className="space-y-4">
                                <div>
                                    <h4 className="text-xs text-vd-text-tertiary uppercase tracking-wider mb-1">Description</h4>
                                    <textarea
                                        value={editDescription}
                                        onChange={(e) => setEditDescription(e.target.value)}
                                        placeholder="Detailed description..."
                                        rows={4}
                                        className="w-full bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary placeholder-vd-text-tertiary focus:border-vd-accent-gold focus:outline-none resize-none"
                                        onKeyDown={(e) => {
                                            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                                e.preventDefault();
                                                handleSaveEdit();
                                            }
                                            if (e.key === 'Escape') handleCancelEdit();
                                        }}
                                    />
                                </div>
                                <div className="grid gap-3 md:grid-cols-3">
                                    <div>
                                        <h4 className="text-xs text-vd-text-tertiary uppercase tracking-wider mb-1">Mission</h4>
                                        <select
                                            value={editMissionId}
                                            onChange={(e) => setEditMissionId(e.target.value)}
                                            className="w-full bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary focus:border-vd-accent-gold focus:outline-none"
                                        >
                                            <option value="">No Mission</option>
                                            {missionOptions.map((mission) => (
                                                <option key={mission.id} value={mission.id}>{mission.id} • {mission.title}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <h4 className="text-xs text-vd-text-tertiary uppercase tracking-wider mb-1">Wave</h4>
                                        <input
                                            value={editWave}
                                            onChange={(e) => setEditWave(e.target.value)}
                                            list="ticket-detail-wave-options"
                                            placeholder={editMissionId ? 'W1' : 'Select a mission first'}
                                            disabled={!editMissionId}
                                            className="w-full bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary placeholder-vd-text-tertiary focus:border-vd-accent-gold focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                        />
                                    </div>
                                    <div>
                                        <h4 className="text-xs text-vd-text-tertiary uppercase tracking-wider mb-1">Session</h4>
                                        <input
                                            value={editSession}
                                            onChange={(e) => setEditSession(e.target.value)}
                                            list="ticket-detail-session-options"
                                            placeholder="Session 1"
                                            className="w-full bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary placeholder-vd-text-tertiary focus:border-vd-accent-gold focus:outline-none"
                                        />
                                    </div>
                                </div>
                                <datalist id="ticket-detail-wave-options">
                                    {waveOptions.map((option) => (
                                        <option key={option} value={option} />
                                    ))}
                                </datalist>
                                <datalist id="ticket-detail-session-options">
                                    {sessionOptions.map((option) => (
                                        <option key={option} value={option} />
                                    ))}
                                </datalist>
                            </div>
                        ) : ticket.description ? (
                            <DescriptionBlock description={ticket.description} />
                        ) : null}

                        {(expectation || markdownAttachment) && (
                            <div className="space-y-4 rounded-xl border border-vd-border bg-vd-bg-tertiary/40 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h4 className="text-xs text-vd-text-tertiary uppercase tracking-wider">Expectation Comparison</h4>
                                        <p className="mt-1 text-sm text-vd-text-secondary">
                                            Structured comparison between the ticket’s expected behavior and the attached Kitz transcript.
                                        </p>
                                    </div>
                                    {comparisonRows.length > 0 && (
                                        <div className="text-right text-[11px] text-vd-text-tertiary">
                                            <div>{comparisonRows.filter(row => row.status === 'pass').length} pass</div>
                                            <div>{comparisonRows.filter(row => row.status === 'warn').length} watch</div>
                                            <div>{comparisonRows.filter(row => row.status === 'fail').length} miss</div>
                                        </div>
                                    )}
                                </div>

                                {expectation && (
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <div className="rounded-lg border border-vd-border/70 bg-vd-bg-secondary/70 p-3">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-vd-text-tertiary">Expected Infer / Mode</div>
                                            {expectation.inferredIntent && (
                                                <p className="mt-2 text-sm leading-relaxed text-vd-text-secondary">{expectation.inferredIntent}</p>
                                            )}
                                            {expectation.mode && (
                                                <div className="mt-3 text-sm text-vd-text-primary">
                                                    <span className="text-vd-text-tertiary">Mode:</span> {expectation.mode}
                                                </div>
                                            )}
                                        </div>
                                        <div className="rounded-lg border border-vd-border/70 bg-vd-bg-secondary/70 p-3">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-vd-text-tertiary">Expected Good Outcome</div>
                                            <p className="mt-2 text-sm leading-relaxed text-vd-text-secondary whitespace-pre-wrap">{expectation.goodOutcome || 'No explicit good-outcome section found.'}</p>
                                        </div>
                                    </div>
                                )}

                                {comparisonRows.length > 0 && (
                                    <div className="space-y-2">
                                        {comparisonRows.map((row) => (
                                            <div key={row.label} className="rounded-lg border border-vd-border/70 bg-vd-bg-secondary/70 p-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="text-sm font-medium text-vd-text-primary">{row.label}</div>
                                                    <ComparisonBadge status={row.status} />
                                                </div>
                                                <p className="mt-2 text-sm leading-relaxed text-vd-text-secondary">{row.detail}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {(loadingMarkdownAttachment || markdownAttachmentError || transcriptSummary) && (
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <div className="rounded-lg border border-vd-border/70 bg-vd-bg-secondary/70 p-3">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-vd-text-tertiary">Actual Transcript Summary</div>
                                            {loadingMarkdownAttachment ? (
                                                <p className="mt-2 text-sm text-vd-text-secondary">Loading attached markdown transcript…</p>
                                            ) : markdownAttachmentError ? (
                                                <p className="mt-2 text-sm text-red-300">{markdownAttachmentError}</p>
                                            ) : transcriptSummary ? (
                                                <div className="mt-2 space-y-2 text-sm text-vd-text-secondary">
                                                    {transcriptSummary.title && <p><span className="text-vd-text-tertiary">Chat:</span> {transcriptSummary.title}</p>}
                                                    {transcriptSummary.firstUserPrompt && <p><span className="text-vd-text-tertiary">Prompt:</span> {transcriptSummary.firstUserPrompt}</p>}
                                                    {(transcriptSummary.mode || transcriptSummary.stage) && (
                                                        <p><span className="text-vd-text-tertiary">Mode / Stage:</span> {transcriptSummary.mode || 'unknown'} / {transcriptSummary.stage || 'unknown'}</p>
                                                    )}
                                                    {transcriptSummary.pendingInput && <p><span className="text-vd-text-tertiary">Pending input:</span> {transcriptSummary.pendingInput}</p>}
                                                    {transcriptSummary.firstThinking && (
                                                        <p><span className="text-vd-text-tertiary">First visible thinking:</span> {transcriptSummary.firstThinking}</p>
                                                    )}
                                                    {transcriptSummary.firstVisibleResponse && (
                                                        <p><span className="text-vd-text-tertiary">First visible response:</span> {transcriptSummary.firstVisibleResponse}</p>
                                                    )}
                                                </div>
                                            ) : (
                                                <p className="mt-2 text-sm text-vd-text-secondary">No markdown transcript summary available.</p>
                                            )}
                                        </div>
                                        <div className="rounded-lg border border-vd-border/70 bg-vd-bg-secondary/70 p-3">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-vd-text-tertiary">Reviewer Notes</div>
                                            {transcriptSummary?.laterDriftExcerpt ? (
                                                <div className="mt-2 space-y-2">
                                                    <p className="text-sm text-vd-text-secondary">
                                                        Later in the transcript, Kitz appears to drift into a generic strategy answer. This excerpt is surfaced so the reviewer can compare it directly against the expected diagnose-and-decide workflow:
                                                    </p>
                                                    <blockquote className="border-l-2 border-red-400/40 pl-3 text-sm leading-relaxed text-vd-text-secondary whitespace-pre-wrap">
                                                        {transcriptSummary.laterDriftExcerpt}
                                                    </blockquote>
                                                </div>
                                            ) : (
                                                <p className="mt-2 text-sm text-vd-text-secondary">
                                                    No obvious later generic-strategy drift excerpt was detected from the attached transcript.
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {expectation && (expectation.behaviorBullets.length > 0 || expectation.flowBullets.length > 0) && (
                                    <details className="group rounded-lg border border-vd-border/70 bg-vd-bg-secondary/50 p-3">
                                        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-vd-text-tertiary hover:text-vd-text-secondary">
                                            Expected Behavior And Flow
                                        </summary>
                                        <div className="mt-3 grid gap-4 md:grid-cols-2">
                                            <div>
                                                <div className="text-xs font-semibold text-vd-text-primary">Behavior</div>
                                                <ul className="mt-2 space-y-1 text-sm text-vd-text-secondary">
                                                    {expectation.behaviorBullets.map((bullet) => (
                                                        <li key={bullet} className="flex gap-2">
                                                            <span className="text-vd-text-tertiary">•</span>
                                                            <span>{bullet}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                            <div>
                                                <div className="text-xs font-semibold text-vd-text-primary">Flow</div>
                                                <ul className="mt-2 space-y-1 text-sm text-vd-text-secondary">
                                                    {expectation.flowBullets.map((bullet) => (
                                                        <li key={bullet} className="flex gap-2">
                                                            <span className="text-vd-text-tertiary">•</span>
                                                            <span>{bullet}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                        {expectation.rawNotes && (
                                            <div className="mt-4">
                                                <div className="text-xs font-semibold text-vd-text-primary">Raw Notes</div>
                                                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-vd-text-secondary">{expectation.rawNotes}</p>
                                            </div>
                                        )}
                                    </details>
                                )}
                            </div>
                        )}

                        {/* Tags */}
                        <div>
                            <h4 className="text-xs text-vd-text-tertiary uppercase tracking-wider mb-2">Tags</h4>
                            <TagInput
                                tags={ticket.tags || []}
                                allTags={allTags}
                                onAddTag={handleAddTag}
                                onRemoveTag={handleRemoveTag}
                            />
                        </div>

                        {/* AD-180: Linked tickets */}
                        <LinkedTicketsPanel
                            ticket={ticket}
                            onUpdate={onUpdate}
                            allTickets={allTickets}
                            onCreateSubtask={onCreateSubtask}
                            onSelectTicket={onSelectTicket}
                        />


                        {/* Ticket images / attachments */}
                        {/* In edit mode, show editImages with remove buttons + drop zone */}
                        {isEditing ? (
                            <div>
                                <h4 className="text-xs text-vd-text-tertiary uppercase tracking-wider mb-2">Attachments</h4>
                                <div className="flex flex-wrap gap-2">
                                    {editImages.map((img, i) => {
                                        const isImg = img.isImage !== false && !!img.filename.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|avif|tiff?)$/i);
                                        return (
                                            <div key={i} className="relative group/att">
                                                {isImg ? (
                                                    <div className="w-24 h-24 rounded-lg border border-vd-border overflow-hidden">
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img src={img.url} alt={img.filename} className="w-full h-full object-cover" />
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-vd-border bg-vd-bg-tertiary text-xs text-vd-text-secondary">
                                                        <span className="text-base">📎</span>
                                                        <span className="truncate max-w-[120px]">{img.filename}</span>
                                                    </div>
                                                )}
                                                <button
                                                    onClick={() => setEditImages(prev => prev.filter((_, j) => j !== i))}
                                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity hover:bg-red-600"
                                                    title="Remove attachment"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                                <p className="text-[11px] text-vd-text-tertiary mt-1.5">Drag, drop, or paste to add. Hover to remove.</p>
                            </div>
                        ) : ticket.images.length > 0 ? (
                            <div>
                                <h4 className="text-xs text-vd-text-tertiary uppercase tracking-wider mb-2">
                                    {ticket.images.every(img => !!img.filename.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|avif|tiff?)$/i)) ? 'Screenshots' : 'Attachments'}
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                    {ticket.images.map((img, i) => {
                                        const imgData = img as unknown as Record<string, unknown>;
                                        const isImg = imgData.isImage !== false && !!img.filename.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|avif|tiff?)$/i);
                                        return isImg ? (
                                            <div key={i} className="space-y-1">
                                                <button
                                                    onClick={() => setLightboxUrl(img.url)}
                                                    className="block w-24 h-24 rounded-lg border border-vd-border overflow-hidden hover:ring-1 hover:ring-vd-accent-gold transition-all"
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={img.url} alt={img.filename} className="w-full h-full object-cover" />
                                                </button>
                                                {img.caption && (
                                                    <p className="text-[10px] text-vd-text-tertiary max-w-[96px] truncate">
                                                        {img.caption as string}
                                                    </p>
                                                )}
                                            </div>
                                        ) : (
                                            <a key={i} href={img.url} target="_blank" rel="noopener noreferrer"
                                                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-vd-border bg-vd-bg-tertiary text-xs text-vd-text-secondary hover:ring-1 hover:ring-vd-accent-gold transition-all">
                                                <span className="text-base">📎</span>
                                                <span className="truncate max-w-[150px]">{img.filename}</span>
                                            </a>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : null}

                        {/* All Media (aggregated from ticket + comments) */}
                        {allMedia.length > 1 && (
                            <details className="group">
                                <summary className="text-xs text-vd-text-tertiary uppercase tracking-wider cursor-pointer hover:text-vd-text-secondary">
                                    All Media ({allMedia.length})
                                </summary>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {allMedia.map((m, i) => {
                                        const isImage = !!(m.filename || '').match(/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|avif|tiff?)$/i);
                                        return isImage ? (
                                            <div key={i} className="space-y-1">
                                                <button
                                                    onClick={() => setLightboxUrl(m.url)}
                                                    className="block w-20 h-20 rounded-lg border border-vd-border overflow-hidden hover:ring-1 hover:ring-vd-accent-gold transition-all"
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={m.url} alt={m.filename} className="w-full h-full object-cover" />
                                                </button>
                                                {m.caption && <p className="text-[9px] text-vd-text-tertiary max-w-[80px] truncate">{m.caption}</p>}
                                                <p className="text-[9px] text-vd-text-tertiary">{m.source}</p>
                                            </div>
                                        ) : (
                                            <a key={i} href={m.url} target="_blank" rel="noopener noreferrer"
                                                className="flex items-center gap-1 px-2 py-1 rounded-md border border-vd-border bg-vd-bg-tertiary text-[10px] text-vd-text-secondary hover:ring-1 hover:ring-vd-accent-gold">
                                                📎 {m.filename}
                                            </a>
                                        );
                                    })}
                                </div>
                            </details>
                        )}

                        {/* Metadata + Delete */}
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-vd-text-tertiary items-center">
                            {isTicketExecutionActive(ticket, activeExecutionIds) && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-1 text-blue-400">
                                    <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
                                    Running{ticket.execution?.actor ? ` • ${ticket.execution.actor}` : ''}
                                </span>
                            )}
                            {ticket.wave && (
                                <span>Wave: <span className="text-vd-text-secondary">{ticket.wave}</span></span>
                            )}
                            {ticket.missionId && (
                                <span>Mission: <span className="text-vd-text-secondary">{ticket.missionId}</span></span>
                            )}
                            {ticket.session && (
                                <span>Session: <span className="text-vd-text-secondary">{ticket.session}</span></span>
                            )}
                            <span>
                                Creator: <span className="text-vd-text-secondary">{getCreatorLabel(ticket as Ticket & { sourceMessageId?: string; createdByType?: 'human' | 'ai' | 'system' })}</span>
                                {/* AD-186: chat-spawned tickets show "via chat" as a hyperlink that opens Brain Dump at the source message. */}
                                {(ticket as Ticket & { sourceMessageId?: string }).sourceMessageId && onOpenChatMessage && (
                                    <>
                                        {' '}
                                        <button
                                            type="button"
                                            onClick={() => onOpenChatMessage((ticket as Ticket & { sourceMessageId?: string }).sourceMessageId!)}
                                            className="text-vd-accent-gold hover:underline"
                                            title="Open in Brain Dump"
                                        >via Brain Dump {(ticket as Ticket & { sourceMessageId?: string }).sourceMessageId}</button>
                                    </>
                                )}
                            </span>
                            <span>Created: <span className="text-vd-text-secondary">{formatDate(ticket.createdAt)}</span></span>
                            <span>Updated: <span className="text-vd-text-secondary">{formatDate(ticket.updatedAt)}</span></span>
                            {ticket.resolvedAt && (
                                <span>Resolved: <span className="text-vd-text-secondary">{formatDate(ticket.resolvedAt)}</span></span>
                            )}
                            {/* AD-160: Run + Copy moved to the sticky
                                header above so they stay reachable while
                                scrolling. The standalone "Copy for AI"
                                button used to live here too — it called the
                                same `buildRunPrompt(...)` as the split-
                                button's Copy, so it was a duplicate doing
                                exactly the same clipboard write. Dropped. */}
                            <button
                                onClick={() => {
                                    if (window.confirm(`Delete ticket ${ticket.id}? This cannot be undone.`)) {
                                        onDelete(ticket.id);
                                        onClose();
                                    }
                                }}
                                className="ml-auto text-red-400/60 hover:text-red-400 transition-colors"
                                title="Delete ticket"
                            >
                                Delete
                            </button>
                        </div>

                        {/* Divider */}
                        <hr className="border-vd-border" />

                        {/* Unified timeline: comments + activity interleaved chronologically */}
                        <div ref={timelineRef}>
                            <h4 className="text-xs text-vd-text-tertiary uppercase tracking-wider mb-3">Timeline</h4>
                            <CommentTimeline
                                comments={ticket.comments as Parameters<typeof CommentTimeline>[0]['comments']}
                                activity={ticket.activity}
                                onDeleteComment={onDeleteComment ? (commentId) => onDeleteComment(ticket.id, commentId) : undefined}
                                onImageClick={(url) => setLightboxUrl(url)}
                                onOpenChatMessage={onOpenChatMessage}
                            />
                        </div>

                        {/* New comment form */}
                        <div className="space-y-3 pt-2">
                            <div className="relative">
                                <textarea
                                    ref={commentTextareaRef}
                                    value={commentText}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setCommentText(val);
                                        // Show @mention popup when user types '@'
                                        const cursor = e.target.selectionStart;
                                        const beforeCursor = val.slice(0, cursor);
                                        const atMatch = beforeCursor.match(/@(\w*)$/);
                                        setShowMentionPopup(!!atMatch);
                                    }}
                                    onKeyDown={(e) => {
                                        // Handle mention popup selection
                                        if (showMentionPopup && (e.key === 'Tab' || e.key === 'Enter') && !e.ctrlKey && !e.metaKey) {
                                            e.preventDefault();
                                            const cursor = e.currentTarget.selectionStart;
                                            const beforeCursor = commentText.slice(0, cursor);
                                            const atMatch = beforeCursor.match(/@(\w*)$/);
                                            if (atMatch) {
                                                const start = cursor - atMatch[0].length;
                                                const newText = commentText.slice(0, start) + '@codex ' + commentText.slice(cursor);
                                                setCommentText(newText);
                                                setShowMentionPopup(false);
                                                // Move cursor after the inserted mention
                                                setTimeout(() => {
                                                    if (commentTextareaRef.current) {
                                                        const pos = start + '@codex '.length;
                                                        commentTextareaRef.current.selectionStart = pos;
                                                        commentTextareaRef.current.selectionEnd = pos;
                                                    }
                                                }, 0);
                                            }
                                            return;
                                        }
                                        if (showMentionPopup && e.key === 'Escape') {
                                            setShowMentionPopup(false);
                                            return;
                                        }
                                        handleCommentKeyDown(e);
                                    }}
                                    placeholder="Add a comment... (type @ to mention Claude/Codex/ChatGPT, Ctrl+Enter to post)"
                                    rows={3}
                                    className="w-full bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary placeholder-vd-text-tertiary focus:border-vd-accent-gold focus:outline-none resize-none"
                                />
                                {/* @mention autocomplete popup */}
                                {showMentionPopup && (
                                    <div className="absolute bottom-full left-0 mb-1 bg-vd-bg-secondary border border-vd-border rounded-lg shadow-panel py-1 z-20 min-w-[220px]">
                                        {AI_MENTION_OPTIONS.map((option) => (
                                            <button
                                                key={option.label}
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    const cursor = commentTextareaRef.current?.selectionStart ?? commentText.length;
                                                    const beforeCursor = commentText.slice(0, cursor);
                                                    const atMatch = beforeCursor.match(/@(\w*)$/);
                                                    if (atMatch) {
                                                        const start = cursor - atMatch[0].length;
                                                        const newText = commentText.slice(0, start) + `${option.label} ` + commentText.slice(cursor);
                                                        setCommentText(newText);
                                                    }
                                                    setShowMentionPopup(false);
                                                    commentTextareaRef.current?.focus();
                                                }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-vd-bg-hover transition-colors"
                                            >
                                                <span className={`text-sm font-semibold ${option.accent}`}>{option.label.slice(1, 2).toUpperCase()}</span>
                                                <div>
                                                    <span className="font-medium text-vd-text-primary">{option.label}</span>
                                                    <span className="text-vd-text-tertiary ml-1.5">{option.help}</span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <ImageDropZone images={commentImages} onImagesChange={setCommentImages} onImageClick={(url) => setLightboxUrl(url)} maxImages={5} />
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-vd-text-tertiary">Ctrl+Enter to post · Escape to close</span>
                                <button
                                    onClick={handleSubmitComment}
                                    disabled={(!commentText.trim() && commentImages.length === 0) || submittingComment}
                                    className="px-4 py-2 text-sm font-medium bg-vd-accent-gold text-vd-bg-primary rounded-lg hover:bg-vd-accent-gold-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {submittingComment ? 'Posting...' : 'Post Comment'}
                                </button>
                            </div>
                        </div>
                    </div>
                    </div>{/* end scrollable body */}
                </div>{/* end modal */}
            </div>{/* end overlay */}

            {/* Lightbox */}
            {lightboxUrl && (
                <div
                    className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center cursor-pointer"
                    onClick={() => setLightboxUrl(null)}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lightboxUrl} alt="Screenshot" className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl" />
                </div>
            )}

            {/* AD-137/130: coach marks — sequential, only one visible at a time.
                On a reopen/previously-failed ticket, read the timeline first; once
                that hint is dismissed, the Run hint takes over. */}
            {(() => {
                const commentsEligible = !hideTips
                    && !coachMarks?.comments
                    && (ticket.status === 'reopen' || (ticket.reopenCount ?? 0) > 0);
                const runEligible = !hideTips
                    && !coachMarks?.run
                    && ticket.ticketType !== 'onboarding'
                    && ticket.status === 'todo';
                // Priority: comments first on a reopen (read before re-running),
                // then run. Never both at once.
                const active: 'comments' | 'run' | null =
                    commentsEligible ? 'comments' :
                    runEligible ? 'run' : null;
                return (
                    <>
                        <CoachMark
                            show={active === 'comments'}
                            targetRef={timelineRef}
                            placement="top"
                            message="Check the timeline — Claude explains what it did here."
                            onSeen={() => onCoachMarkSeen?.('comments')}
                            onHideAll={() => onHideAllTips?.()}
                        />
                        <CoachMark
                            show={active === 'run'}
                            targetRef={runButtonWrapRef}
                            placement="left"
                            message="Click Run to hand this ticket to Claude."
                            onSeen={() => onCoachMarkSeen?.('run')}
                            onHideAll={() => onHideAllTips?.()}
                        />
                    </>
                );
            })()}
        </>
    );
}

// AD-180: Linked-tickets panel — parent / sub-tasks / related / blockers /
// blocked-by / duplicate-of, grouped by kind. Title-search combobox + a
// `+ New sub-task` shortcut that creates a fresh ticket with this ticket
// pre-filled as parent. Bidirectional bookkeeping happens server-side in
// the PATCH handler.
// AD-251: status pill colors mirror the kanban-column accents so a glance
// at the linked panel reads the same as a glance at the board. Kept inline
// (no shared map) to avoid a circular import on FeedbackBoard's column
// config — the values are stable across the AI-allowed status set.
const LINKED_STATUS_STYLE: Record<string, string> = {
    backlog: 'bg-rose-500/15 text-rose-300 border-rose-400/25',
    todo: 'bg-amber-500/15 text-amber-300 border-amber-400/25',
    reopen: 'bg-purple-500/15 text-purple-300 border-purple-400/25',
    done: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25',
    reviewed: 'bg-sky-500/15 text-sky-300 border-sky-400/25',
    observe: 'bg-cyan-500/15 text-cyan-300 border-cyan-400/25',
    deferred: 'bg-slate-500/15 text-slate-300 border-slate-400/25',
};
const LINKED_PRIORITY_STYLE: Record<string, string> = {
    low: 'text-slate-400',
    medium: 'text-amber-400',
    high: 'text-orange-400',
    critical: 'text-red-400',
};

function LinkedTicketsPanel({
    ticket,
    onUpdate,
    allTickets = [],
    onCreateSubtask,
    onSelectTicket,
}: {
    ticket: Ticket;
    onUpdate: (id: string, updates: Partial<Ticket>) => void;
    allTickets?: Pick<Ticket, 'id' | 'title' | 'status' | 'priority' | 'ticketType'>[];
    onCreateSubtask?: (parentTicketId: string) => void;
    onSelectTicket?: (ticketId: string) => void;
}) {
    const [addKind, setAddKind] = useState<RelationKind>('subtask');
    const [searchTerm, setSearchTerm] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const relations: Relation[] = (ticket.relations || []) as Relation[];
    // AD-193: `relates` is gone from the schema; only the five kinds remain.
    const grouped: Record<RelationKind, Relation[]> = {
        'parent': [], 'subtask': [], 'duplicate-of': [], 'blocks': [], 'blocked-by': [],
    };
    for (const r of relations) {
        if (grouped[r.kind]) grouped[r.kind].push(r);
    }

    // Index by id so the chip can show "AD-152 — title…".
    const ticketById = new Map(allTickets.map(t => [t.id.toUpperCase(), t]));

    // Title/id search: match anywhere in id or title (case-insensitive),
    // exclude self + already-linked tickets, cap at top 8.
    const linkedIds = new Set(relations.map(r => r.ticketId.toUpperCase()));
    const trimmed = searchTerm.trim().toLowerCase();
    const suggestions = trimmed
        ? allTickets
            .filter(t => t.id.toUpperCase() !== ticket.id.toUpperCase() && !linkedIds.has(t.id.toUpperCase()))
            .filter(t => t.id.toLowerCase().includes(trimmed) || (t.title || '').toLowerCase().includes(trimmed))
            .slice(0, 8)
        : [];

    const writeRelations = (next: Relation[]) => onUpdate(ticket.id, { relations: next });

    const handleAddById = (rawId: string) => {
        const id = rawId.trim().toUpperCase();
        if (!/^[A-Z]{2,6}-\d+$/.test(id)) {
            setError('Pick a ticket from the list or paste an id like AD-152');
            return;
        }
        if (id === ticket.id.toUpperCase()) { setError('Cannot link a ticket to itself'); return; }
        if (relations.some(r => r.kind === addKind && r.ticketId === id)) {
            setError('This link already exists'); return;
        }
        // Parent is exclusive — replace any existing parent.
        let next = relations;
        if (addKind === 'parent') next = next.filter(r => r.kind !== 'parent');
        writeRelations([...next, { kind: addKind, ticketId: id }]);
        setSearchTerm('');
        setShowSuggestions(false);
        setError(null);
    };

    const handleRemove = (rel: Relation) => {
        writeRelations(relations.filter(r => !(r.kind === rel.kind && r.ticketId === rel.ticketId)));
    };

    const hasAny = relations.length > 0;

    return (
        <div>
            <h4 className="text-xs text-vd-text-tertiary uppercase tracking-wider mb-2">Linked Tickets</h4>

            {hasAny && (
                // AD-251: list view (one row per linked ticket) instead of
                // the prior chip view. Each row leads with a status pill so
                // the reader can see at a glance which links are still open
                // vs already shipped, and the whole row is clickable to
                // switch the modal to that ticket. The chip view kept
                // truncating titles and made it impossible to gauge whether
                // a parent / sub-task was still in flight.
                <div className="space-y-3 mb-2">
                    {RELATION_KINDS.filter(k => grouped[k].length > 0).map(kind => (
                        <div key={kind}>
                            <div className="text-[10px] font-semibold text-vd-accent-gold/80 uppercase tracking-wider mb-1">
                                {RELATION_LABEL[kind]}
                            </div>
                            <ul className="space-y-1">
                                {grouped[kind].map(rel => {
                                    const linkedTicket = ticketById.get(rel.ticketId.toUpperCase());
                                    const status = linkedTicket?.status || 'unknown';
                                    const priority = linkedTicket?.priority;
                                    const statusClass = LINKED_STATUS_STYLE[status] || 'bg-vd-bg-tertiary text-vd-text-tertiary border-vd-border';
                                    const priorityClass = priority ? LINKED_PRIORITY_STYLE[priority] : '';
                                    const isClickable = !!onSelectTicket && !!linkedTicket;
                                    return (
                                        <li
                                            key={`${rel.kind}:${rel.ticketId}`}
                                            className={
                                                'group/linked flex items-center gap-2 px-2 py-1.5 rounded border border-vd-border bg-vd-bg-tertiary/50 ' +
                                                (isClickable ? 'cursor-pointer hover:bg-vd-bg-tertiary hover:border-vd-accent-gold/40' : '')
                                            }
                                            onClick={() => { if (isClickable) onSelectTicket!(rel.ticketId.toUpperCase()); }}
                                            role={isClickable ? 'button' : undefined}
                                            tabIndex={isClickable ? 0 : undefined}
                                            onKeyDown={e => {
                                                if (!isClickable) return;
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    onSelectTicket!(rel.ticketId.toUpperCase());
                                                }
                                            }}
                                            title={linkedTicket ? `Open ${rel.ticketId}` : `Linked ticket ${rel.ticketId} not loaded`}
                                        >
                                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide shrink-0 ${statusClass}`}>
                                                {status}
                                            </span>
                                            <span className="font-mono text-[11px] text-vd-text-secondary shrink-0">{rel.ticketId}</span>
                                            <span className="text-[12px] text-vd-text-primary flex-1 truncate">
                                                {linkedTicket?.title || <span className="italic text-vd-text-tertiary">(not loaded)</span>}
                                            </span>
                                            {priority && (
                                                <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${priorityClass}`} title="Priority">
                                                    {priority}
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={e => { e.stopPropagation(); handleRemove(rel); }}
                                                className="text-vd-text-tertiary hover:text-red-400 leading-none shrink-0 opacity-0 group-hover/linked:opacity-100 transition-opacity"
                                                title="Remove link"
                                            >
                                                ×
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex items-center gap-1.5">
                <select
                    value={addKind}
                    onChange={e => setAddKind(e.target.value as RelationKind)}
                    className="bg-vd-bg-input border border-vd-border rounded px-2 py-1 text-[11px] text-vd-text-primary focus:outline-none focus:border-vd-accent-gold"
                >
                    {RELATION_KINDS.map(k => (
                        <option key={k} value={k}>{RELATION_LABEL[k]}</option>
                    ))}
                </select>
                <div className="relative flex-1">
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={e => { setSearchTerm(e.target.value); setShowSuggestions(true); setError(null); }}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                if (suggestions.length > 0) handleAddById(suggestions[0].id);
                                else if (searchTerm.trim()) handleAddById(searchTerm);
                            }
                            if (e.key === 'Escape') setShowSuggestions(false);
                        }}
                        placeholder="Search by title or id…"
                        className="w-full bg-vd-bg-input border border-vd-border rounded px-2 py-1 text-[11px] text-vd-text-primary placeholder-vd-text-tertiary focus:outline-none focus:border-vd-accent-gold"
                    />
                    {showSuggestions && suggestions.length > 0 && (
                        <div className="absolute z-10 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-vd-bg-secondary border border-vd-border rounded-md shadow-lg">
                            {suggestions.map(s => (
                                <button
                                    key={s.id}
                                    type="button"
                                    onMouseDown={e => { e.preventDefault(); handleAddById(s.id); }}
                                    className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-vd-bg-tertiary border-b border-vd-border last:border-b-0"
                                >
                                    <span className="font-mono text-vd-accent-gold mr-2">{s.id}</span>
                                    <span className="text-vd-text-primary">{s.title || '(untitled)'}</span>
                                    <span className="text-[9px] text-vd-text-tertiary ml-2 uppercase">{s.status}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            {error && <p className="text-[10px] text-amber-400 mt-1">{error}</p>}

            {/* AD-180 follow-up: skip the search dance — open a quick-create
                with this ticket pre-filled as parent. The new ticket lands
                with `parent: <currentId>` and the inverse subtask edge is
                mirrored back here on save. */}
            {onCreateSubtask && (
                <button
                    type="button"
                    onClick={() => onCreateSubtask(ticket.id)}
                    className="mt-2 text-[11px] text-vd-accent-gold/80 hover:text-vd-accent-gold underline underline-offset-2"
                >
                    + Create new sub-task
                </button>
            )}
        </div>
    );
}
