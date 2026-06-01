'use client';

// AD-181: chat slide-in panel.
//
// Right-edge slide-in toggled from the topbar. Same composer UX as ticket
// comments — markdown, Ctrl+V images, drag-drop. Persists every message
// to `.adhdev/chat.json` via /api/chat. The "Run Chat" button POSTs to
// /api/chat/process which builds an instruction prompt and pipes it to
// the connected coding agent (same channel as /api/run).

import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { compressImage } from '@/lib/feedback/imageCompress';

export interface ChatMessage {
    id: string;
    author: string;
    authorType: 'human' | 'ai' | 'system';
    content: string;
    images: { url: string; filename: string }[];
    createdAt: string;
    status: 'unaddressed' | 'in_progress' | 'addressed' | 'noted';
    parentMessageId?: string;
    actions?: { kind: string; ticketId?: string; summary: string; at: string }[];
}

interface ChatPaneProps {
    open: boolean;
    onClose: () => void;
    onToast?: (msg: string, durationMs?: number) => void;
    // AD-181 reopen #4: open a ticket from an AD-### token clicked in chat content.
    onOpenTicket?: (ticketId: string) => void;
    // AD-186: when set, the panel scrolls the matching message bubble into
    // view. Caller should clear it (or update on each open) so a repeat
    // click on the same id still triggers the scroll.
    scrollToMessageId?: string | null;
    onScrollHandled?: () => void;
    // AD-194: lift `processing` to the parent so the topbar Brain Dump button
    // can render a pulse indicator while triage is in flight, even when the
    // panel is closed.
    onProcessingChange?: (processing: boolean) => void;
}

const POLL_MS = 3000;

export function ChatPane({ open, onClose, onToast, onOpenTicket, scrollToMessageId, onScrollHandled, onProcessingChange }: ChatPaneProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [composer, setComposer] = useState('');
    const [pendingImages, setPendingImages] = useState<{ url: string; filename: string }[]>([]);
    const [uploading, setUploading] = useState<{ key: string; name: string }[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [processing, setProcessing] = useState(false);
    // AD-190: header status filter — All / Unaddressed / Addressed / Noted.
    const [filterStatus, setFilterStatus] = useState<'all' | ChatMessage['status']>('all');
    // AD-192: lightbox state for clicking an image (posted bubble or pending strip).
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    // AD-188: keep the panel mounted-but-translated for a smooth slide-in.
    const [mounted, setMounted] = useState(open);
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/chat');
            if (!res.ok) return;
            const data = await res.json();
            if (Array.isArray(data?.messages)) setMessages(data.messages);
        } catch { /* swallow */ }
    }, []);

    useEffect(() => {
        if (!open) {
            // AD-188: keep mounted briefly so the slide-out transition can play.
            const t = setTimeout(() => setMounted(false), 250);
            return () => clearTimeout(t);
        }
        setMounted(true);
        void load();
        const t = setInterval(load, POLL_MS);
        return () => clearInterval(t);
    }, [open, load]);

    // AD-294: focus the composer textarea when the pane opens so paste/type
    // works without an extra click. Defer one frame so the slide-in transition
    // has mounted the textarea and the panel is on-screen — focusing while the
    // pane is still translated off-screen has caused mobile Safari to scroll
    // the parent unexpectedly.
    useEffect(() => {
        if (!open) return;
        const t = setTimeout(() => textareaRef.current?.focus(), 60);
        return () => clearTimeout(t);
    }, [open]);

    // Scroll to bottom on new messages.
    useEffect(() => {
        if (!open) return;
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [open, messages.length]);

    // Esc closes.
    useEffect(() => {
        if (!open) return;
        const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [open, onClose]);

    // AD-186: scroll a specific message into view when scrollToMessageId
    // changes. The DOM element gets `id="chat-msg-${id}"` from the bubble
    // wrapper below. Defer one frame so the panel is mounted + populated.
    useEffect(() => {
        if (!open || !scrollToMessageId) return;
        const t = setTimeout(() => {
            const el = document.getElementById(`chat-msg-${scrollToMessageId}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('ring-2', 'ring-vd-accent-gold');
                setTimeout(() => el.classList.remove('ring-2', 'ring-vd-accent-gold'), 1600);
            }
            onScrollHandled?.();
        }, 100);
        return () => clearTimeout(t);
    }, [open, scrollToMessageId, messages.length, onScrollHandled]);

    const uploadFile = async (file: File): Promise<{ url: string; filename: string } | null> => {
        try {
            const isImage = file.type.startsWith('image/');
            const toUpload = isImage ? await compressImage(file) : file;
            const formData = new FormData();
            formData.append('file', toUpload);
            const res = await fetch('/api/feedback/upload', { method: 'POST', body: formData });
            if (!res.ok) return null;
            const data = await res.json();
            return { url: data.url, filename: data.filename };
        } catch {
            return null;
        }
    };

    // AD-186 reopen: previously this listened on `document`, so a Ctrl+V
    // would fire on BOTH the chat composer AND any open ticket detail at
    // the same time. Now it's a textarea-scoped onPaste handler — only
    // fires when the chat composer is the focused element.
    const ingestFiles = useCallback(async (files: File[]) => {
        if (files.length === 0) return;
        // AD-185(a/b): show an "Uploading <name>" placeholder while the
        // upload is in flight so paste/drop give immediate UI feedback.
        const pendingKeys: string[] = [];
        for (const f of files) {
            const key = `${f.name}-${f.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            pendingKeys.push(key);
            setUploading(prev => [...prev, { key, name: f.name }]);
        }
        for (let i = 0; i < files.length; i++) {
            const up = await uploadFile(files[i]);
            const key = pendingKeys[i];
            setUploading(prev => prev.filter(u => u.key !== key));
            if (up) setPendingImages(prev => [...prev, up]);
        }
    }, []);

    const handleComposerPaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        // AD-246 reopen: detect image-typed items in two passes. First pass
        // checks for *any* `image/*` item — if present, we MUST preventDefault
        // even if file extraction later fails, otherwise the text/HTML
        // fallback (e.g. an `<img>` tag from a Windows screenshot tool) leaks
        // into the textarea. Original handler only preventDefault'd when
        // `files.length > 0`, which left a hole on screenshot paths where the
        // clipboard had an image entry but `getAsFile()` returned null.
        let hasImageItem = false;
        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                hasImageItem = true;
                const f = items[i].getAsFile();
                if (f) files.push(f);
            }
        }
        if (!hasImageItem) return; // text-only paste — let the textarea handle it natively
        e.preventDefault();
        if (files.length > 0) {
            await ingestFiles(files);
        } else {
            onToast?.('Could not read the pasted image — try drag-drop or save the file first.', 3000);
        }
    }, [ingestFiles, onToast]);

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        await ingestFiles(Array.from(e.dataTransfer.files));
    };

    const send = async () => {
        if (submitting) return;
        const text = composer.trim();
        if (!text && pendingImages.length === 0) return;
        setSubmitting(true);
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: text, images: pendingImages }),
            });
            if (res.ok) {
                setComposer('');
                setPendingImages([]);
                await load();
            } else {
                onToast?.('Failed to send. Try again.', 3000);
            }
        } finally {
            setSubmitting(false);
        }
    };

    // AD-194: track the most recent system-message id at run start so we can
    // detect the closing summary arriving from triage. Also a hard 120 s
    // belt-and-braces timeout in case the agent never posts a summary.
    const processingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const baselineSystemIdRef = useRef<string | null>(null);

    const stopProcessing = useCallback(() => {
        setProcessing(false);
        baselineSystemIdRef.current = null;
        if (processingTimeoutRef.current) {
            clearTimeout(processingTimeoutRef.current);
            processingTimeoutRef.current = null;
        }
    }, []);

    const runChat = async () => {
        if (processing) return;
        // Snapshot the latest system-message id at run start. The closing
        // "✅ Triage complete" system message that arrives later (whose id
        // is greater than this) is the canonical end signal.
        const latestSystemId = (() => {
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].authorType === 'system') return messages[i].id;
            }
            return null;
        })();
        baselineSystemIdRef.current = latestSystemId;
        setProcessing(true);
        if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = setTimeout(() => {
            stopProcessing();
        }, 120_000);
        try {
            const res = await fetch('/api/chat/process', { method: 'POST' });
            const data = await res.json();
            onToast?.(data.message || (data.success ? 'Run started.' : 'No unaddressed messages.'), 4000);
            // No unaddressed messages → no triage will run; clear the flag now.
            if (!data.success) stopProcessing();
        } catch {
            onToast?.('Failed to start the chat run.', 3000);
            stopProcessing();
        }
    };

    // AD-194: detect the closing system-summary message arriving on a poll
    // and clear processing. Compares against the baseline id captured at
    // run start.
    useEffect(() => {
        if (!processing) return;
        const baseline = baselineSystemIdRef.current;
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.authorType !== 'system') continue;
            if (m.id !== baseline) {
                stopProcessing();
            }
            break;
        }
    }, [processing, messages, stopProcessing]);

    // AD-194: surface the processing state to the parent (FeedbackBoard) so
    // the topbar Brain Dump button can show a pulse while triage is in flight.
    useEffect(() => {
        onProcessingChange?.(processing);
    }, [processing, onProcessingChange]);

    const updateStatus = async (id: string, status: ChatMessage['status']) => {
        try {
            await fetch('/api/chat', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, updates: { status } }),
            });
            await load();
        } catch { /* swallow */ }
    };

    const deleteMessage = async (id: string) => {
        try {
            await fetch(`/api/chat?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            await load();
        } catch { /* swallow */ }
    };

    const unaddressedCount = messages.filter(m => m.status === 'unaddressed').length;

    // AD-188: render mounted but translated when closed so the slide
    // animation has something to interpolate from. Don't render at all if
    // it's never been opened.
    if (!mounted && !open) return null;

    return (
        <>
            {/* AD-188: backdrop for click-outside dismiss + dim/blur.
                AD-321: bumped opacity from black/40 + blur-sm to black/70 +
                blur-md. The lighter backdrop was leaving the terminal pane's
                Launch button (and the rest of the topbar) visibly bleeding
                through, which the user read as "the terminal Launch button
                shows on the Brain Dump" — a layering artifact, not an actual
                button in this panel. The darker backdrop makes the Brain Dump
                read as the active surface without changing the terminal pane's
                layout. */}
            <div
                onClick={onClose}
                aria-hidden="true"
                className={`fixed inset-0 z-30 bg-black/70 backdrop-blur-md transition-opacity duration-200 ${
                    open ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
            />
            <aside
                className={`fixed top-0 right-0 bottom-0 z-40 w-full sm:w-[420px] bg-vd-bg-secondary border-l border-vd-border shadow-panel flex flex-col transform transition-transform duration-200 ease-out ${
                    open ? 'translate-x-0' : 'translate-x-full'
                }`}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
            >
            <header className="flex items-center justify-between px-4 py-3 border-b border-vd-border shrink-0">
                <div>
                    <h2 className="text-sm font-semibold text-vd-text-primary">🧠 Brain Dump</h2>
                    <p className="text-[11px] text-vd-text-tertiary mt-0.5">
                        Dump thoughts. Run when ready — the AI turns them into tickets.
                    </p>
                </div>
                <button onClick={onClose} className="text-vd-text-tertiary hover:text-vd-text-primary text-lg" title="Close (Esc)">×</button>
            </header>

            <div className="flex items-center justify-between px-4 py-2 border-b border-vd-border bg-vd-bg-tertiary/40 shrink-0">
                <span className="text-[11px] text-vd-text-secondary flex items-center gap-2">
                    {processing ? (
                        <>
                            {/* AD-188: triage in-flight indicator */}
                            <span className="inline-block w-3 h-3 border-2 border-vd-accent-gold/40 border-t-vd-accent-gold rounded-full animate-spin" aria-hidden="true" />
                            <span>Triaging…</span>
                        </>
                    ) : unaddressedCount === 0
                        ? 'All caught up'
                        : `${unaddressedCount} unaddressed`}
                </span>
                <button
                    onClick={runChat}
                    disabled={processing || unaddressedCount === 0}
                    className="px-3 py-1 text-[11px] font-medium rounded border border-vd-accent-gold/40 text-vd-accent-gold hover:bg-vd-accent-gold/10 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={unaddressedCount === 0 ? 'Nothing to process' : 'Send unaddressed messages to the coding agent'}
                >
                    {processing ? '… Processing' : '▶ Process'}
                </button>
            </div>

            {/* AD-190: status filter row. Hide replies + system rows are unaffected (they always render with their parent or as bracket markers). */}
            <div className="flex items-center gap-1 px-4 py-1.5 border-b border-vd-border bg-vd-bg-tertiary/20 shrink-0 text-[10px]">
                {(['all', 'unaddressed', 'addressed', 'noted'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilterStatus(f)}
                        className={`px-2 py-0.5 rounded-full transition-colors uppercase tracking-wider ${
                            filterStatus === f
                                ? 'bg-vd-accent-gold/20 text-vd-accent-gold font-medium'
                                : 'text-vd-text-tertiary hover:text-vd-text-secondary'
                        }`}
                    >
                        {f}
                    </button>
                ))}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {messages.length === 0 && (
                    <p className="text-[11px] text-vd-text-tertiary italic text-center mt-4">
                        Type below to capture a thought. The AI processes them when you click Run.
                    </p>
                )}
                {(() => {
                    // AD-181 reopen #4: facebook-style threading. Group messages
                    // by parentMessageId so each top-level entry shows its replies
                    // collapsed; click "N replies" to expand.
                    const replyMap = new Map<string, ChatMessage[]>();
                    for (const m of messages) {
                        if (m.parentMessageId) {
                            const arr = replyMap.get(m.parentMessageId) || [];
                            arr.push(m);
                            replyMap.set(m.parentMessageId, arr);
                        }
                    }
                    // AD-190: filter top-level by status. System messages always
                    // show through (bracket markers). Replies follow their parent.
                    const topLevel = messages.filter(m => !m.parentMessageId);
                    const visible = filterStatus === 'all'
                        ? topLevel
                        : topLevel.filter(m => m.authorType === 'system' || m.status === filterStatus);
                    return visible.map(m => (
                        <ChatThread
                            key={m.id}
                            message={m}
                            replies={replyMap.get(m.id) || []}
                            onMarkAddressed={() => updateStatus(m.id, 'addressed')}
                            onMarkNoted={() => updateStatus(m.id, 'noted')}
                            onDelete={() => deleteMessage(m.id)}
                            onOpenTicket={onOpenTicket}
                            onImageClick={(url) => setLightboxUrl(url)}
                        />
                    ));
                })()}
            </div>

            {(pendingImages.length > 0 || uploading.length > 0) && (
                <div className="px-4 py-2 border-t border-vd-border bg-vd-bg-tertiary/40 shrink-0">
                    <div className="flex flex-wrap gap-1.5">
                        {pendingImages.map((img, i) => (
                            <div key={i} className="relative group">
                                {isImageAttachment(img) ? (
                                    // AD-192: pending uploads also clickable.
                                    <button
                                        type="button"
                                        onClick={() => setLightboxUrl(img.url)}
                                        className="block p-0 border-0 bg-transparent"
                                        title={img.filename}
                                    >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={img.url} alt={img.filename} className="w-12 h-12 object-cover rounded border border-vd-border hover:border-vd-accent-gold transition-colors cursor-zoom-in" />
                                    </button>
                                ) : (
                                    <FileChip filename={img.filename} className="w-12 h-12" />
                                )}
                                <button
                                    onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100"
                                >×</button>
                            </div>
                        ))}
                        {uploading.map(u => (
                            <div key={u.key} className="w-12 h-12 rounded border border-vd-border bg-vd-bg-secondary flex flex-col items-center justify-center" title={`Uploading ${u.name}`}>
                                <span className="inline-block w-3 h-3 border-2 border-vd-accent-gold/40 border-t-vd-accent-gold rounded-full animate-spin" aria-hidden="true" />
                                <span className="text-[8px] text-vd-text-tertiary mt-0.5">Uploading</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="px-4 py-3 border-t border-vd-border shrink-0">
                <textarea
                    ref={textareaRef}
                    value={composer}
                    onChange={e => setComposer(e.target.value)}
                    onPaste={handleComposerPaste}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            void send();
                        }
                    }}
                    placeholder="Drop, paste, or type a thought…  (Ctrl+Enter to send)"
                    rows={3}
                    className="w-full bg-vd-bg-input border border-vd-border rounded-md px-3 py-2 text-[12px] text-vd-text-primary placeholder-vd-text-tertiary focus:outline-none focus:border-vd-accent-gold resize-none"
                />
                <div className="flex justify-between items-center mt-2">
                    <span className="text-[10px] text-vd-text-tertiary">
                        Ctrl+V to paste images · drag-drop files
                    </span>
                    <button
                        onClick={send}
                        disabled={submitting || (!composer.trim() && pendingImages.length === 0)}
                        className="px-3 py-1 text-[11px] font-medium rounded bg-vd-accent-gold text-vd-text-inverse disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {submitting ? '…' : 'Send'}
                    </button>
                </div>
            </div>
            </aside>
            {/* AD-192: lightbox overlay — Esc and backdrop click both close. */}
            {lightboxUrl && (
                <div
                    className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center cursor-zoom-out"
                    onClick={() => setLightboxUrl(null)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setLightboxUrl(null); }}
                    role="dialog"
                    aria-modal="true"
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={lightboxUrl}
                        alt=""
                        className="max-w-[92vw] max-h-[92vh] rounded shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </>
    );
}

// AD-185(d): non-image attachments (PDF, MD, etc.) used to render as
// broken `<img>` tags. Detect from filename/url extension and route to a
// FileChip instead.
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);

function getExtension(att: { url?: string; filename?: string }): string {
    const src = att.filename || att.url || '';
    const cleaned = src.split('?')[0];
    const dot = cleaned.lastIndexOf('.');
    if (dot < 0) return '';
    return cleaned.slice(dot + 1).toLowerCase();
}

function isImageAttachment(att: { url?: string; filename?: string }): boolean {
    return IMAGE_EXTENSIONS.has(getExtension(att));
}

function FileChip({ filename, className }: { filename: string; className?: string }) {
    const ext = getExtension({ filename }) || 'file';
    return (
        <div className={`flex flex-col items-center justify-center rounded border border-vd-border bg-vd-bg-tertiary text-vd-text-tertiary ${className || 'min-w-[88px] max-w-[140px] h-[60px] px-2'}`}
             title={filename}>
            <span className="text-[10px] font-mono uppercase">{ext}</span>
            <span className="text-[9px] truncate w-full text-center mt-0.5">{filename}</span>
        </div>
    );
}

// AD-181 reopen #3: system messages are styled italic, but it was flagged
// that italicizing the leading emoji looks wrong. Split the leading emoji
// run from the rest and italicize only the text.
const SYSTEM_EMOJI_PREFIX = /^(\s*\p{Extended_Pictographic}[\p{Extended_Pictographic}‍️]*\s*)([\s\S]*)$/u;

function renderSystemContent(content: string): ReactNode {
    const m = content.match(SYSTEM_EMOJI_PREFIX);
    if (m && m[2].trim().length > 0) {
        return (<><span>{m[1]}</span><span className="italic">{m[2]}</span></>);
    }
    return <span className="italic">{content}</span>;
}

// AD-181 reopen #4: hyperlink AD-### tokens in any chat content. Splits the
// string on the regex and wraps each match in a clickable span that calls
// onOpenTicket with the captured id.
const TICKET_TOKEN_RE = /\b(AD-\d+)\b/g;

function renderInlineContent(content: string, onOpenTicket?: (id: string) => void): ReactNode {
    if (!onOpenTicket) return content;
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    TICKET_TOKEN_RE.lastIndex = 0;
    while ((match = TICKET_TOKEN_RE.exec(content)) !== null) {
        if (match.index > lastIndex) parts.push(content.slice(lastIndex, match.index));
        const id = match[1];
        parts.push(
            <button
                key={`${id}-${match.index}`}
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenTicket(id); }}
                className="font-mono text-vd-accent-gold underline-offset-2 hover:underline"
            >
                {id}
            </button>
        );
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) parts.push(content.slice(lastIndex));
    return parts.length > 0 ? <>{parts}</> : content;
}

// AD-191: pick the first AD-### token from the first reply (or actions[]) so
// the toggle hint can read e.g. "1 reply · AD-201".
const TICKET_HINT_RE = /\b(AD-\d+)\b/;
function pickHintTicket(replies: ChatMessage[], actions?: ChatMessage['actions']): string | null {
    if (actions && actions.length > 0) {
        const a = actions.find(x => x.ticketId);
        if (a?.ticketId) return a.ticketId;
    }
    if (replies.length > 0) {
        const m = replies[0].content.match(TICKET_HINT_RE);
        if (m) return m[1];
    }
    return null;
}

function ChatThread({
    message,
    replies,
    onMarkAddressed,
    onMarkNoted,
    onDelete,
    onOpenTicket,
    onImageClick,
}: {
    message: ChatMessage;
    replies: ChatMessage[];
    onMarkAddressed: () => void;
    onMarkNoted: () => void;
    onDelete: () => void;
    onOpenTicket?: (id: string) => void;
    onImageClick?: (url: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const replyCount = replies.length;
    // AD-191: hint id surfaced inline with the toggle so the user can see
    // which ticket the thread spawned without expanding.
    const hintTicket = pickHintTicket(replies, message.actions);
    return (
        <div>
            <ChatMessageBubble
                message={message}
                onMarkAddressed={onMarkAddressed}
                onMarkNoted={onMarkNoted}
                onDelete={onDelete}
                onOpenTicket={onOpenTicket}
                onImageClick={onImageClick}
            />
            {replyCount > 0 && (
                // AD-191: bumped from text-[10px]/tertiary to a full pill
                // button — text-[11px], secondary text, faint background +
                // border, accent on hover. Now reads as clickable.
                <button
                    type="button"
                    onClick={() => setExpanded(v => !v)}
                    className="ml-4 mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] text-vd-text-secondary bg-vd-bg-tertiary/60 border border-vd-border hover:border-vd-accent-gold/60 hover:text-vd-accent-gold transition-colors"
                >
                    <span>{expanded ? '▾' : '▸'}</span>
                    <span>{expanded ? 'Hide' : ''} {replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>
                    {hintTicket && (
                        <>
                            <span className="text-vd-text-tertiary">·</span>
                            <span className="font-mono text-vd-accent-gold">{hintTicket}</span>
                        </>
                    )}
                </button>
            )}
            {expanded && replies.length > 0 && (
                // AD-187: tighten gap (mt-1 instead of mt-2), draw a thin
                // vertical guide on the left so replies are clearly nested.
                // Each reply gets a leading "└" elbow from the guide into
                // its bubble.
                <div className="mt-1 space-y-1.5 ml-4 border-l border-vd-border/60 pl-3 relative">
                    {replies.map(r => (
                        <div key={r.id} className="relative">
                            <span className="absolute -left-3 top-2 text-vd-border" aria-hidden="true">└</span>
                            <ChatMessageBubble
                                message={r}
                                onMarkAddressed={() => { /* replies are not directly statusable */ }}
                                onMarkNoted={() => { /* same */ }}
                                onDelete={() => { /* replies are not directly deletable from UI */ }}
                                onOpenTicket={onOpenTicket}
                                onImageClick={onImageClick}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function ChatMessageBubble({
    message,
    onMarkAddressed,
    onMarkNoted,
    onDelete,
    onOpenTicket,
    onImageClick,
}: {
    message: ChatMessage;
    onMarkAddressed: () => void;
    onMarkNoted: () => void;
    onDelete: () => void;
    onOpenTicket?: (id: string) => void;
    onImageClick?: (url: string) => void;
}) {
    const isAi = message.authorType === 'ai';
    const isSystem = message.authorType === 'system';
    const ts = new Date(message.createdAt);
    const tsLabel = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isReply = !!message.parentMessageId;

    // AD-187: system messages render as a small centered pill, not a full
    // bubble — they're bracket markers, they shouldn't compete with actual
    // conversation visually.
    if (isSystem) {
        return (
            <div className="flex justify-center my-1">
                <div className="text-[10px] text-vd-text-tertiary/70 px-2 py-0.5 rounded-full bg-vd-bg-tertiary/40 max-w-[90%] text-center">
                    {renderSystemContent(message.content)}
                </div>
            </div>
        );
    }

    const statusBadge = !isAi ? (
        <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
            message.status === 'unaddressed' ? 'bg-amber-500/15 text-amber-400' :
            message.status === 'in_progress' ? 'bg-blue-500/15 text-blue-400' :
            message.status === 'addressed' ? 'bg-green-500/15 text-green-400' :
            'bg-vd-bg-tertiary text-vd-text-tertiary'
        }`}>
            {message.status}
        </span>
    ) : null;

    const renderedContent = renderInlineContent(message.content, onOpenTicket);

    return (
        <div id={`chat-msg-${message.id}`} className="group transition-shadow duration-200 rounded">
            <div className="flex items-center gap-2 mb-1">
                <span className={`text-[11px] font-semibold ${isAi ? 'text-vd-accent-gold' : 'text-vd-text-primary'}`}>
                    {isAi ? 'AI' : message.author}
                </span>
                <span className="text-[10px] text-vd-text-tertiary">{tsLabel}</span>
                <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(message.id).catch(() => {})}
                    className="text-[9px] font-mono text-vd-text-tertiary hover:text-vd-accent-gold"
                    title="Copy Brain Dump reference id"
                >
                    {message.id}
                </button>
                {statusBadge}
            </div>
            {/* AD-187: replies (isAi mid-thread) get more prominent text +
                stronger left border so the eye finds them in an expanded
                thread. */}
            <div className={`text-[12px] leading-relaxed whitespace-pre-wrap ${
                isAi
                    ? `text-vd-text-primary border-l-[3px] ${isReply ? 'border-vd-accent-gold' : 'border-vd-accent-gold/60'} pl-3`
                    : 'text-vd-text-primary'
            }`}>
                {renderedContent}
            </div>
            {message.images?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {message.images.map((img, i) => isImageAttachment(img) ? (
                        // AD-192: image opens the lightbox on click. Falls
                        // back to a plain <img> when no opener is wired (so
                        // tests / preview surfaces don't crash).
                        <button
                            key={i}
                            type="button"
                            onClick={() => onImageClick?.(img.url)}
                            disabled={!onImageClick}
                            className="block p-0 border-0 bg-transparent"
                            title={img.filename}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.url} alt={img.filename} className="max-w-[180px] max-h-[120px] rounded border border-vd-border hover:border-vd-accent-gold transition-colors cursor-zoom-in" />
                        </button>
                    ) : (
                        <FileChip key={i} filename={img.filename} />
                    ))}
                </div>
            )}
            {message.actions && message.actions.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                    {message.actions.map((a, i) => (
                        <div key={i} className="text-[10px] text-vd-text-tertiary">
                            <span className="uppercase tracking-wider">{a.kind}</span>
                            {a.ticketId && (
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onOpenTicket?.(a.ticketId!); }}
                                    disabled={!onOpenTicket}
                                    className="font-mono ml-1.5 text-vd-accent-gold hover:underline disabled:no-underline disabled:cursor-default"
                                >
                                    {a.ticketId}
                                </button>
                            )}
                            {a.summary && <span className="ml-1.5">{a.summary}</span>}
                        </div>
                    ))}
                </div>
            )}
            {!isAi && (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity mt-1 flex gap-2 text-[10px]">
                    {message.status !== 'addressed' && (
                        <button onClick={onMarkAddressed} className="text-vd-text-tertiary hover:text-green-400">Mark addressed</button>
                    )}
                    {message.status !== 'noted' && (
                        <button onClick={onMarkNoted} className="text-vd-text-tertiary hover:text-vd-text-secondary">Note for later</button>
                    )}
                    <button onClick={onDelete} className="text-vd-text-tertiary hover:text-red-400 ml-auto">Delete</button>
                </div>
            )}
        </div>
    );
}
