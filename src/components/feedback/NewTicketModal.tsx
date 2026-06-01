'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ImageDropZone } from './ImageDropZone';
import { TagInput } from './TagInput';
import { compressImage } from '@/lib/feedback/imageCompress';

interface UploadedImage {
    url: string;
    filename: string;
    uploadedAt?: string;
}

interface NewTicketModalProps {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
    defaultStatus?: string;
    allTags?: string[];
    missionOptions?: Array<{ id: string; title: string }>;
    waveOptions?: string[];
    sessionOptions?: string[];
    droppedFiles?: File[];
    onDroppedFilesConsumed?: () => void;
    // AD-180 follow-up: pre-fill the new ticket's `relations` array (e.g.
    // `[{kind:'parent', ticketId:'AD-152'}]` when the modal is opened from
    // the Linked panel's "+ Create new sub-task" shortcut). Bidirectional
    // bookkeeping in the API write path then mirrors the inverse subtask
    // edge back onto the parent.
    defaultRelations?: { kind: string; ticketId: string }[];
    parentLabel?: string | null;
}

export function NewTicketModal({
    open,
    onClose,
    onCreated,
    defaultStatus,
    allTags = [],
    missionOptions = [],
    waveOptions = [],
    sessionOptions = [],
    droppedFiles,
    onDroppedFilesConsumed,
    defaultRelations,
    parentLabel,
}: NewTicketModalProps) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
    const [missionId, setMissionId] = useState('');
    const [wave, setWave] = useState('');
    const [session, setSession] = useState('');
    const [ticketType, setTicketType] = useState<'normal' | 'discussion'>('normal');
    const [aiAddressable, setAiAddressable] = useState(true);
    const [images, setImages] = useState<UploadedImage[]>([]);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [tags, setTags] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const dragLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 2000);
    };

    // Reset on open
    useEffect(() => {
        if (open) {
            setTitle('');
            setDescription('');
            setPriority('medium');
            setMissionId('');
            setWave('');
            setSession('');
            setTicketType('normal');
            setAiAddressable(true);
            setImages([]);
            setTags([]);
        }
    }, [open]);

    // Auto-upload dropped files when modal opens with them
    useEffect(() => {
        if (!open || !droppedFiles || droppedFiles.length === 0) return;
        const uploadDropped = async () => {
            const results: UploadedImage[] = [];
            for (const file of droppedFiles) {
                try {
                    const isImage = file.type.startsWith('image/');
                    const toUpload = isImage ? await compressImage(file) : file;
                    const formData = new FormData();
                    formData.append('file', toUpload);
                    const res = await fetch('/api/feedback/upload', { method: 'POST', body: formData });
                    if (res.ok) {
                        const data = await res.json();
                        results.push({ url: data.url, filename: data.filename, uploadedAt: new Date().toISOString() });
                    }
                } catch { /* skip */ }
            }
            if (results.length > 0) setImages(prev => [...prev, ...results]);
            onDroppedFilesConsumed?.();
        };
        uploadDropped();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, droppedFiles]);

    // AD-317: a closed modal nukes everything the user has typed in. Guard the
    // four close paths (Escape, backdrop click, header ×, footer Cancel) with a
    // confirm prompt whenever the form has unsaved content. `submitting` is the
    // only path that bypasses the prompt — handleSubmit calls onClose itself
    // after a successful POST, at which point there is nothing left to lose.
    const isDirty = useCallback(() => {
        return (
            title.trim().length > 0 ||
            description.trim().length > 0 ||
            images.length > 0 ||
            tags.length > 0 ||
            missionId !== '' ||
            wave !== '' ||
            session !== ''
        );
    }, [title, description, images.length, tags.length, missionId, wave, session]);

    const attemptClose = useCallback(() => {
        if (submitting) { onClose(); return; }
        if (!isDirty()) { onClose(); return; }
        const ok = typeof window !== 'undefined'
            ? window.confirm('Discard this ticket? Anything you have entered will be lost.')
            : true;
        if (ok) onClose();
    }, [submitting, isDirty, onClose]);

    // Escape to close
    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') attemptClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, attemptClose]);

    // Global paste handler — catches Ctrl+V regardless of focus
    const handleGlobalPaste = useCallback(async (e: ClipboardEvent) => {
        if (!open) return;
        const items = e.clipboardData?.items;
        if (!items) return;

        const imageFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                const file = items[i].getAsFile();
                if (file) imageFiles.push(file);
            }
        }

        if (imageFiles.length === 0) return;
        e.preventDefault();
        showToast(`Pasting ${imageFiles.length} image${imageFiles.length > 1 ? 's' : ''}...`);

        // Upload each image
        const uploaded: UploadedImage[] = [];
        for (const file of imageFiles) {
            try {
                const compressed = await compressImage(file);
                const formData = new FormData();
                formData.append('file', compressed);
                const res = await fetch('/api/feedback/upload', { method: 'POST', body: formData });
                if (res.ok) {
                    const data = await res.json();
                    uploaded.push({ url: data.url, filename: data.filename, uploadedAt: new Date().toISOString() });
                }
            } catch { /* skip failed uploads */ }
        }

        if (uploaded.length > 0) {
            setImages((prev) => [...prev, ...uploaded]);
            showToast(`${uploaded.length} image${uploaded.length > 1 ? 's' : ''} attached`);
        } else {
            showToast('Upload failed — try again');
        }
    }, [open]);

    useEffect(() => {
        window.addEventListener('paste', handleGlobalPaste);
        return () => window.removeEventListener('paste', handleGlobalPaste);
    }, [handleGlobalPaste]);

    // Full-screen drag-drop on new ticket modal
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragLeaveTimer.current) { clearTimeout(dragLeaveTimer.current); dragLeaveTimer.current = null; }
        setIsDraggingOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.stopPropagation();
        // Use a short timer to avoid flicker — if dragover fires again within 150ms, we cancel
        if (dragLeaveTimer.current) clearTimeout(dragLeaveTimer.current);
        dragLeaveTimer.current = setTimeout(() => setIsDraggingOver(false), 150);
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
        if (dragLeaveTimer.current) { clearTimeout(dragLeaveTimer.current); dragLeaveTimer.current = null; }
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;
        showToast(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);
        const results: UploadedImage[] = [];
        for (const file of files) {
            try {
                const isImage = file.type.startsWith('image/');
                const toUpload = isImage ? await compressImage(file) : file;
                const formData = new FormData();
                formData.append('file', toUpload);
                const res = await fetch('/api/feedback/upload', { method: 'POST', body: formData });
                if (res.ok) {
                    const data = await res.json();
                    results.push({ url: data.url, filename: data.filename, uploadedAt: new Date().toISOString() });
                }
            } catch { /* skip */ }
        }
        if (results.length > 0) {
            setImages(prev => [...prev, ...results]);
            showToast(`${results.length} file${results.length > 1 ? 's' : ''} attached`);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!open) return null;

    const handleAddTag = (tag: string) => {
        const trimmed = tag.trim().toLowerCase();
        if (!trimmed || tags.includes(trimmed)) return;
        setTags([...tags, trimmed]);
    };

    const handleRemoveTag = (tagToRemove: string) => {
        setTags(tags.filter(t => t !== tagToRemove));
    };

    const handleSubmit = async () => {
        if (!title.trim()) return;
        if (submitting) return; // Prevent double-submit
        setSubmitting(true);

        try {
            const res = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    description,
                    priority,
                    missionId,
                    wave: wave.trim(),
                    session: session.trim(),
                    ticketType,
                    aiAddressable,
                    images,
                    tags,
                    status: defaultStatus,
                    // AD-180 follow-up: pre-filled relations carry over to
                    // the new ticket (e.g. `parent` when this modal was
                    // opened as "+ Create new sub-task" of an existing
                    // ticket). Server mirrors the inverse on the parent.
                    relations: defaultRelations,
                }),
            });

            if (res.ok) {
                onCreated();
                onClose();
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Backdrop */}
            {/* AD-317: route the click through attemptClose so a stray backdrop tap doesn't silently throw away a half-written ticket. */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={attemptClose} />

            {/* Full-screen drag overlay */}
            {isDraggingOver && (
                <div className="absolute inset-0 z-[65] bg-vd-accent-gold/10 border-4 border-dashed border-vd-accent-gold/50 flex items-center justify-center pointer-events-none">
                    <div className="bg-vd-bg-secondary/90 rounded-xl px-8 py-6 text-center shadow-xl">
                        <div className="text-3xl mb-2">📎</div>
                        <p className="text-sm font-medium text-vd-text-primary">Drop files to attach</p>
                        <p className="text-xs text-vd-text-tertiary mt-1">Images, PDFs, documents</p>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-lg bg-vd-accent-gold/90 text-vd-bg-primary text-xs font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
                    {toast}
                </div>
            )}

            {/* Modal */}
            <div className="relative bg-vd-bg-secondary border border-vd-border rounded-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto shadow-panel">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-vd-border">
                    <div>
                        <h2 className="text-lg font-semibold text-vd-text-primary">
                            {parentLabel ? 'New Sub-task' : 'New Ticket'}
                        </h2>
                        {parentLabel && (
                            <p className="text-[11px] text-vd-text-tertiary mt-0.5">
                                Will be linked as a sub-task of <span className="font-mono text-vd-accent-gold">{parentLabel}</span>
                            </p>
                        )}
                    </div>
                    <button onClick={attemptClose} className="text-vd-text-tertiary hover:text-vd-text-primary text-xl">×</button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                    {/* Ticket mode toggle — Normal vs Discussion (safety lock) */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => setTicketType('normal')}
                            className={`flex-1 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                                ticketType === 'normal'
                                    ? 'border-vd-accent-gold bg-vd-accent-gold/10 text-vd-accent-gold'
                                    : 'border-vd-border text-vd-text-tertiary hover:text-vd-text-secondary'
                            }`}
                        >
                            Normal
                        </button>
                        <button
                            onClick={() => setTicketType('discussion')}
                            className={`flex-1 py-1.5 text-sm font-medium rounded-lg border transition-colors flex items-center justify-center gap-1.5 ${
                                ticketType === 'discussion'
                                    ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400'
                                    : 'border-vd-border text-vd-text-tertiary hover:text-vd-text-secondary'
                            }`}
                            title="Discussion only — AI will not make code changes for this ticket"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                            Discussion
                        </button>
                    </div>

                    {/* Title */}
                    <div>
                        <label className="text-xs text-vd-text-tertiary uppercase tracking-wider">Title</label>
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey && title.trim()) {
                                    e.preventDefault();
                                    showToast('Creating ticket...');
                                    handleSubmit();
                                }
                            }}
                            placeholder={ticketType === 'discussion' ? "What do you want to discuss? (Enter to create)" : "Brief description of the issue... (Enter to create)"}
                            className="w-full mt-1 bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary placeholder-vd-text-tertiary focus:border-vd-accent-gold focus:outline-none"
                            autoFocus
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className="text-xs text-vd-text-tertiary uppercase tracking-wider">Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            onKeyDown={(e) => {
                                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && title.trim()) {
                                    e.preventDefault();
                                    showToast('Creating ticket...');
                                    handleSubmit();
                                }
                            }}
                            placeholder={ticketType === 'discussion' ? "Context, questions, planning notes..." : "Detailed description, steps to reproduce, expected behavior..."}
                            rows={4}
                            className="w-full mt-1 bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary placeholder-vd-text-tertiary focus:border-vd-accent-gold focus:outline-none resize-none"
                        />
                    </div>

                    {/* Tags */}
                    <div>
                        <label className="text-xs text-vd-text-tertiary uppercase tracking-wider">Tags</label>
                        <div className="mt-1">
                            <TagInput
                                tags={tags}
                                allTags={allTags}
                                onAddTag={handleAddTag}
                                onRemoveTag={handleRemoveTag}
                                placeholder="frontend, agent, UX..."
                                wrapped
                            />
                        </div>
                    </div>

                    {/* Priority + planning fields */}
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <div>
                            <label className="text-xs text-vd-text-tertiary uppercase tracking-wider">Priority</label>
                            <select
                                value={priority}
                                onChange={(e) => setPriority(e.target.value as typeof priority)}
                                className="w-full mt-1 bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary focus:border-vd-accent-gold focus:outline-none"
                            >
                                <option value="critical">Critical</option>
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                            </select>
                        </div>
                        {/* AI Addressable checkbox removed — batch selection replaced it */}
                        <div>
                            <label className="text-xs text-vd-text-tertiary uppercase tracking-wider">Mission</label>
                            <select
                                value={missionId}
                                onChange={(e) => setMissionId(e.target.value)}
                                className="w-full mt-1 bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary focus:border-vd-accent-gold focus:outline-none"
                            >
                                <option value="">No Mission</option>
                                {missionOptions.map((mission) => (
                                    <option key={mission.id} value={mission.id}>{mission.id} • {mission.title}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-vd-text-tertiary uppercase tracking-wider">Wave</label>
                            <input
                                value={wave}
                                onChange={(e) => setWave(e.target.value)}
                                list="ticket-wave-options"
                                placeholder={missionId ? 'W1' : 'Select a mission first'}
                                disabled={!missionId}
                                className="w-full mt-1 bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary placeholder-vd-text-tertiary focus:border-vd-accent-gold focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-vd-text-tertiary uppercase tracking-wider">Session</label>
                            <input
                                value={session}
                                onChange={(e) => setSession(e.target.value)}
                                list="ticket-session-options"
                                placeholder="Session 1"
                                className="w-full mt-1 bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary placeholder-vd-text-tertiary focus:border-vd-accent-gold focus:outline-none"
                            />
                        </div>
                    </div>
                    <datalist id="ticket-wave-options">
                        {waveOptions.map((option) => (
                            <option key={option} value={option} />
                        ))}
                    </datalist>
                    <datalist id="ticket-session-options">
                        {sessionOptions.map((option) => (
                            <option key={option} value={option} />
                        ))}
                    </datalist>

                    {/* Images */}
                    <div>
                        <label className="text-xs text-vd-text-tertiary uppercase tracking-wider">Screenshots</label>
                        <p className="text-[10px] text-vd-text-tertiary mt-0.5 mb-1">Ctrl+V anywhere to paste screenshots</p>
                        <ImageDropZone images={images} onImagesChange={setImages} onImageClick={(url) => setLightboxUrl(url)} />
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-vd-border">
                    <span className="text-[10px] text-vd-text-tertiary">Enter or Ctrl+Enter to create · Escape to close</span>
                    <div className="flex gap-3">
                        <button
                            onClick={attemptClose}
                            className="px-4 py-2 text-sm text-vd-text-secondary hover:text-vd-text-primary rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!title.trim() || submitting}
                            className="px-4 py-2 text-sm font-medium bg-vd-accent-gold text-vd-bg-primary rounded-lg hover:bg-vd-accent-gold-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {submitting ? 'Creating...' : 'Create Ticket'}
                        </button>
                    </div>
                </div>
            </div>
            {/* Lightbox */}
            {lightboxUrl && (
                <div
                    className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center cursor-pointer"
                    onClick={() => setLightboxUrl(null)}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lightboxUrl} alt="Screenshot" className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl" />
                </div>
            )}
        </div>
    );
}
