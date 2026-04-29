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

export function ImageDropZone({ images, onImagesChange, onImageClick, maxImages = 10 }: ImageDropZoneProps) {
    const [isDragOver, setIsDragOver] = useState(false);
    const [uploading, setUploading] = useState(false);
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

        setUploading(true);
        const results = await Promise.all(toUpload.map(uploadFile));
        const uploaded = results.filter((r): r is UploadedFile => r !== null);
        if (uploaded.length > 0) {
            onImagesChange([...images, ...uploaded]);
        }
        setUploading(false);
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
    }, [images, onImagesChange]);

    return (
        <div onPaste={handlePaste}>
            {/* Thumbnails / file list — ABOVE drop zone (VD-023) */}
            {images.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-2">
                    {images.map((file, i) => {
                        const isImg = file.isImage !== false && !!file.filename.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|avif|tiff?)$/i);
                        return isImg ? (
                            /* Image thumbnail with caption */
                            <div key={i} className="space-y-1">
                                <div
                                    className="relative group w-16 h-16 rounded-md overflow-hidden border border-vd-border cursor-pointer"
                                    onClick={() => onImageClick?.(file.url)}
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={file.url} alt={file.filename} className="w-full h-full object-cover" />
                                    <button
                                        onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                                        className="absolute top-0 right-0 w-5 h-5 bg-red-600 text-white text-xs rounded-bl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        ×
                                    </button>
                                </div>
                                <input
                                    value={file.caption || ''}
                                    onChange={(e) => {
                                        const updated = [...images];
                                        updated[i] = { ...updated[i], caption: e.target.value };
                                        onImagesChange(updated);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    placeholder="Caption..."
                                    className="w-16 text-[9px] bg-transparent border-b border-vd-border text-vd-text-tertiary placeholder-vd-text-tertiary/50 outline-none focus:border-vd-accent-gold"
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
                                <input
                                    value={file.caption || ''}
                                    onChange={(e) => {
                                        const updated = [...images];
                                        updated[i] = { ...updated[i], caption: e.target.value };
                                        onImagesChange(updated);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    placeholder="Caption..."
                                    className="w-full max-w-[180px] text-[9px] bg-transparent border-b border-vd-border text-vd-text-tertiary placeholder-vd-text-tertiary/50 outline-none focus:border-vd-accent-gold"
                                />
                            </div>
                        );
                    })}
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
