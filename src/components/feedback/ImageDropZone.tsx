'use client';

import { useState, useRef, useCallback, DragEvent, ClipboardEvent } from 'react';
import { compressImage } from '@/lib/feedback/imageCompress';

export interface UploadedFile {
    url: string;
    filename: string;
    isImage?: boolean;
    size?: number;
    caption?: string;
    uploadedAt?: string;
}

interface ImageDropZoneProps {
    images: UploadedFile[];
    onImagesChange: (images: UploadedFile[]) => void;
    onImageClick?: (url: string) => void;
    maxImages?: number;
}

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
    if (['zip', 'rar', '7z'].includes(ext)) return '📦';
    if (['mp4', 'mov', 'webm'].includes(ext)) return '🎬';
    if (['json', 'js', 'ts', 'tsx', 'py'].includes(ext)) return '💻';
    if (['txt', 'md', 'log'].includes(ext)) return '📃';
    return '📎';
}

// AD-374: caption UX. The old caption field was a permanent 64px-wide, 9px-font
// input glued under every thumbnail — too small to read what you typed and
// visually noisy across a strip of screenshots. This replaces it with a
// click-to-edit affordance: collapsed it shows the caption (or a muted
// "+ caption" prompt) sized to the thumbnail; clicking expands a readable,
// properly-sized input that commits on blur / Enter / Escape. Same `caption`
// data model — purely a presentation change, shared by every ImageDropZone
// caller (New Ticket modal, comments, etc.).
function CaptionEditor({ caption, editing, onStartEdit, onChange, onFinish, collapsedClassName }: {
    caption: string;
    editing: boolean;
    onStartEdit: () => void;
    onChange: (value: string) => void;
    onFinish: () => void;
    collapsedClassName: string;
}) {
    if (editing) {
        return (
            <input
                autoFocus
                value={caption}
                onChange={(e) => onChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={onFinish}
                onKeyDown={(e) => {
                    // Enter / Escape commit and close — the value is already
                    // live via onChange, so blur is all that's needed.
                    if (e.key === 'Enter' || e.key === 'Escape') {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                    }
                }}
                placeholder="Describe this screenshot…"
                className="w-44 max-w-[60vw] text-[11px] bg-vd-bg-input border border-vd-border rounded px-2 py-1 text-vd-text-primary placeholder-vd-text-tertiary/60 outline-none focus:border-vd-accent-gold"
            />
        );
    }
    return (
        <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
            title={caption || 'Add a caption'}
            className={`block text-left text-[10px] truncate transition-colors ${collapsedClassName} ${caption ? 'text-vd-text-secondary hover:text-vd-text-primary' : 'text-vd-text-tertiary/70 hover:text-vd-accent-gold'}`}
        >
            {caption || '+ caption'}
        </button>
    );
}

// AD-314: per-file placeholder shown in the thumbnail strip while an upload
// is in flight. `previewUrl` is an object URL we synthesize from the source
// File so the user sees the picture immediately on paste/drop, with a spinner
// overlaid until /api/feedback/upload returns the real URL. Falls back to a
// generic file chip when the source is not an image.
interface PendingUpload {
    key: string;
    name: string;
    previewUrl: string | null;
    isImage: boolean;
}

export function ImageDropZone({ images, onImagesChange, onImageClick, maxImages = 10 }: ImageDropZoneProps) {
    const [isDragOver, setIsDragOver] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [pending, setPending] = useState<PendingUpload[]>([]);
    // AD-374: which attachment's caption is currently being edited (index), or
    // null. Click-to-edit so the strip stays compact until you choose to caption.
    const [editingCaption, setEditingCaption] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const uploadFile = useCallback(async (file: File): Promise<UploadedFile | null> => {
        try {
            // Only compress images
            const isImage = file.type.startsWith('image/');
            const toUpload = isImage ? await compressImage(file) : file;

            const formData = new FormData();
            formData.append('file', toUpload);

            const res = await fetch('/api/feedback/upload', { method: 'POST', body: formData });
            if (!res.ok) return null;

            const data = await res.json();
            return {
                url: data.url,
                filename: data.filename,
                isImage: data.isImage ?? isImage,
                size: data.size ?? file.size,
                uploadedAt: new Date().toISOString(),
            };
        } catch {
            return null;
        }
    }, []);

    const handleFiles = useCallback(async (files: FileList | File[]) => {
        const fileArray = Array.from(files);
        if (fileArray.length === 0) return;

        const remaining = maxImages - images.length;
        const toUpload = fileArray.slice(0, remaining);
        if (toUpload.length === 0) return;

        // AD-314: register each file as a pending placeholder before kicking
        // off the upload so the user gets immediate visual feedback (thumbnail
        // with spinner overlay) instead of an empty gap until the network call
        // returns. Object URLs are revoked on settle to avoid leaks.
        const pendingForUpload: PendingUpload[] = toUpload.map(file => {
            const isImage = file.type.startsWith('image/');
            const previewUrl = isImage ? URL.createObjectURL(file) : null;
            return {
                key: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: file.name,
                previewUrl,
                isImage,
            };
        });
        setPending(prev => [...prev, ...pendingForUpload]);
        setUploading(true);
        try {
            const results = await Promise.all(toUpload.map(uploadFile));
            const uploaded = results.filter((r): r is UploadedFile => r !== null);
            if (uploaded.length > 0) {
                onImagesChange([...images, ...uploaded]);
            }
        } finally {
            setPending(prev => {
                const removedKeys = new Set(pendingForUpload.map(p => p.key));
                // Revoke object URLs whose pending entries we are dropping.
                for (const p of pendingForUpload) {
                    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
                }
                return prev.filter(p => !removedKeys.has(p.key));
            });
            setUploading(false);
        }
    }, [images, maxImages, onImagesChange, uploadFile]);

    const handleDrop = useCallback((e: DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    }, [handleFiles]);

    const handlePaste = useCallback((e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const pastedFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                const file = items[i].getAsFile();
                if (file) pastedFiles.push(file);
            }
        }
        if (pastedFiles.length > 0) {
            e.preventDefault();
            handleFiles(pastedFiles);
        }
    }, [handleFiles]);

    const removeFile = useCallback((index: number) => {
        onImagesChange(images.filter((_, i) => i !== index));
        // AD-374: dropping a file invalidates the editing index — close the editor.
        setEditingCaption(null);
    }, [images, onImagesChange]);

    // AD-374: commit a caption edit for attachment `index`.
    const setCaption = useCallback((index: number, value: string) => {
        const updated = [...images];
        updated[index] = { ...updated[index], caption: value };
        onImagesChange(updated);
    }, [images, onImagesChange]);

    return (
        <div onPaste={handlePaste}>
            {/* Thumbnails / file list — ABOVE drop zone */}
            {(images.length > 0 || pending.length > 0) && (
                <div className="flex flex-wrap gap-3 mb-2">
                    {images.map((file, i) => {
                        const isImg = file.isImage !== false && !!file.filename.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|avif|tiff?)$/i);
                        return isImg ? (
                            /* Image thumbnail with caption */
                            <div key={i} className="space-y-1">
                                <div
                                    className="relative group w-16 h-16 rounded-md overflow-hidden border border-vd-border cursor-pointer bg-vd-bg-secondary"
                                    onClick={() => onImageClick?.(file.url)}
                                >
                                    {/* AD-314: bg-vd-bg-secondary on the wrapper so an empty <img> tag (before the network image decodes) shows a neutral panel color instead of a black box. */}
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={file.url} alt={file.filename} className="w-full h-full object-cover" />
                                    <button
                                        onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                                        className="absolute top-0 right-0 w-5 h-5 bg-red-600 text-white text-xs rounded-bl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        ×
                                    </button>
                                </div>
                                <CaptionEditor
                                    caption={file.caption || ''}
                                    editing={editingCaption === i}
                                    onStartEdit={() => setEditingCaption(i)}
                                    onChange={(v) => setCaption(i, v)}
                                    onFinish={() => setEditingCaption(null)}
                                    collapsedClassName="w-16"
                                />
                            </div>
                        ) : (
                            /* File attachment chip */
                            <div key={i} className="space-y-1">
                                <div className="relative group flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-vd-border bg-vd-bg-tertiary max-w-[180px]">
                                    <span className="text-sm">{getFileIcon(file.filename)}</span>
                                    <span className="text-[10px] text-vd-text-secondary truncate">{file.filename}</span>
                                    {file.size && <span className="text-[9px] text-vd-text-tertiary flex-shrink-0">{formatSize(file.size)}</span>}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                                        className="w-4 h-4 bg-red-600 text-white text-[10px] rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                    >
                                        ×
                                    </button>
                                </div>
                                <CaptionEditor
                                    caption={file.caption || ''}
                                    editing={editingCaption === i}
                                    onStartEdit={() => setEditingCaption(i)}
                                    onChange={(v) => setCaption(i, v)}
                                    onFinish={() => setEditingCaption(null)}
                                    collapsedClassName="w-full max-w-[180px]"
                                />
                            </div>
                        );
                    })}
                    {/* AD-314: per-file upload placeholders. Each shows the local
                        object-URL preview (or a generic file icon for non-images)
                        with a spinner overlay until the server upload returns. */}
                    {pending.map(p => (
                        <div key={p.key} className="space-y-1">
                            <div
                                className="relative w-16 h-16 rounded-md overflow-hidden border border-vd-border bg-vd-bg-secondary"
                                title={`Uploading ${p.name}`}
                            >
                                {p.isImage && p.previewUrl ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img src={p.previewUrl} alt={p.name} className="w-full h-full object-cover opacity-60" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-2xl text-vd-text-tertiary">
                                        {getFileIcon(p.name)}
                                    </div>
                                )}
                                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                    <span className="inline-block w-4 h-4 border-2 border-vd-accent-gold/40 border-t-vd-accent-gold rounded-full animate-spin" aria-hidden="true" />
                                </div>
                            </div>
                            <p className="w-16 text-[9px] text-vd-text-tertiary truncate">Uploading…</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Drop zone */}
            <div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                    border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
                    ${isDragOver
                        ? 'border-vd-accent-gold bg-vd-accent-gold/5'
                        : 'border-vd-border hover:border-vd-text-tertiary'
                    }
                `}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => e.target.files && handleFiles(e.target.files)}
                />
                {uploading ? (
                    <p className="text-sm text-vd-text-secondary">Uploading...</p>
                ) : (
                    <p className="text-sm text-vd-text-tertiary">
                        Drop files, paste (Ctrl+V), or click to upload
                    </p>
                )}
            </div>
        </div>
    );
}
