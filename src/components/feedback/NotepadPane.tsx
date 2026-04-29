'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface NotepadPaneProps {
    onClose: () => void;
}

const STORAGE_KEY = 'adhdev-notepad-content';
const DEBOUNCE_MS = 300;

export function NotepadPane({ onClose }: NotepadPaneProps) {
    const [content, setContent] = useState('');
    const [showPreview, setShowPreview] = useState(false);
    const [isMarkdown, setIsMarkdown] = useState(true);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    // Load content from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                setContent(saved);
            }
        } catch (error) {
            console.error('Failed to load notepad content:', error);
        }
    }, []);

    // Auto-save with debouncing
    const saveContent = useCallback((text: string) => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
            try {
                localStorage.setItem(STORAGE_KEY, text);
            } catch (error) {
                console.error('Failed to save notepad content:', error);
            }
        }, DEBOUNCE_MS);
    }, []);

    // Handle content change
    const handleContentChange = useCallback((newContent: string) => {
        setContent(newContent);
        saveContent(newContent);
    }, [saveContent]);

    // Simple markdown to HTML converter for basic preview
    const markdownToHtml = useCallback((md: string) => {
        return md
            // Headers
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            // Bold and italic
            .replace(/\*\*(.*)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*)\*/g, '<em>$1</em>')
            // Code blocks (basic)
            .replace(/```([^`]*)```/g, '<pre><code>$1</code></pre>')
            .replace(/`([^`]*)`/g, '<code>$1</code>')
            // Lists (basic)
            .replace(/^\- (.*$)/gim, '<li>$1</li>')
            .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
            // Line breaks
            .replace(/\n/g, '<br>');
    }, []);

    // Handle Escape key to close
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // Focus textarea on mount
    useEffect(() => {
        if (textareaRef.current && !showPreview) {
            textareaRef.current.focus();
        }
    }, [showPreview]);

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
            />
            <div
                className="fixed z-50 bg-vd-bg-secondary border-l border-vd-border shadow-panel flex flex-col vd-animate-slide-right top-0 right-0 bottom-0 w-[480px]"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-vd-border flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-vd-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                        </svg>
                        <h2 className="text-sm font-semibold text-vd-text-primary">Notepad</h2>
                        <span className="text-xs text-vd-text-tertiary bg-vd-bg-tertiary px-2 py-0.5 rounded">
                            Auto-save
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Format toggle */}
                        <div className="flex items-center border border-vd-border rounded-lg overflow-hidden">
                            <button
                                onClick={() => setIsMarkdown(false)}
                                className={`px-2 py-1 text-xs transition-colors ${
                                    !isMarkdown
                                        ? 'bg-vd-accent-gold/20 text-vd-accent-gold'
                                        : 'text-vd-text-tertiary hover:text-vd-text-secondary'
                                }`}
                                title="Plain text"
                            >
                                TXT
                            </button>
                            <button
                                onClick={() => setIsMarkdown(true)}
                                className={`px-2 py-1 text-xs transition-colors ${
                                    isMarkdown
                                        ? 'bg-vd-accent-gold/20 text-vd-accent-gold'
                                        : 'text-vd-text-tertiary hover:text-vd-text-secondary'
                                }`}
                                title="Markdown"
                            >
                                MD
                            </button>
                        </div>
                        {/* Preview toggle (only for markdown) */}
                        {isMarkdown && (
                            <button
                                onClick={() => setShowPreview(!showPreview)}
                                className={`px-2 py-1 text-xs rounded transition-colors ${
                                    showPreview
                                        ? 'bg-vd-accent-gold/20 text-vd-accent-gold'
                                        : 'text-vd-text-tertiary hover:text-vd-text-secondary border border-vd-border'
                                }`}
                                title="Toggle preview"
                            >
                                {showPreview ? 'Edit' : 'Preview'}
                            </button>
                        )}
                        {/* Close button */}
                        <button
                            onClick={onClose}
                            className="p-1 text-vd-text-tertiary hover:text-vd-text-primary transition-colors"
                            title="Close (Esc)"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-h-0 relative">
                    {showPreview && isMarkdown ? (
                        /* Markdown Preview */
                        <div className="absolute inset-0 p-4 overflow-y-auto">
                            <div
                                className="prose prose-sm prose-invert prose-headings:text-vd-text-primary prose-p:text-vd-text-secondary prose-strong:text-vd-text-primary prose-code:text-vd-accent-gold prose-code:bg-vd-bg-tertiary prose-code:px-1 prose-code:rounded prose-pre:bg-vd-bg-tertiary prose-pre:border prose-pre:border-vd-border max-w-none"
                                dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
                            />
                        </div>
                    ) : (
                        /* Text Editor */
                        <textarea
                            ref={textareaRef}
                            value={content}
                            onChange={(e) => handleContentChange(e.target.value)}
                            placeholder={
                                isMarkdown
                                    ? "# Start writing in Markdown...\n\n- Use **bold** and *italic* text\n- Add `inline code` or:\n\n```\ncode blocks\n```\n\n## Lists and headers work too!"
                                    : "Start writing your notes here...\n\nText will be auto-saved as you type."
                            }
                            className="absolute inset-0 w-full h-full p-4 bg-transparent border-none resize-none focus:outline-none text-sm text-vd-text-primary placeholder-vd-text-tertiary leading-relaxed"
                            style={{
                                fontFamily: isMarkdown ? 'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Inconsolata, "Roboto Mono", "Noto Mono", "Courier New", monospace' : 'inherit'
                            }}
                            spellCheck={!isMarkdown}
                        />
                    )}
                </div>

                {/* Footer with helpful shortcuts */}
                <div className="px-4 py-2 border-t border-vd-border flex items-center justify-between text-xs text-vd-text-tertiary">
                    <div className="flex items-center gap-3">
                        <span>Auto-saves every change</span>
                        {content.length > 0 && (
                            <span>{content.length} chars</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <kbd className="px-1 py-0.5 rounded bg-vd-bg-tertiary/50 text-[9px]">Esc</kbd>
                        <span>Close</span>
                    </div>
                </div>
            </div>
        </>
    );
}