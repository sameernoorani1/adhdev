'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Note } from './types';

interface NoteEditorProps {
    note: Note | null;
    onUpdateNote: (note: Note) => void;
}

export function NoteEditor({ note, onUpdateNote }: NoteEditorProps) {
    const [isMarkdownMode, setIsMarkdownMode] = useState(true);
    const [showPreview, setShowPreview] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const [password, setPassword] = useState('');
    const [unlockPassword, setUnlockPassword] = useState('');
    const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);

    const titleRef = useRef<HTMLInputElement>(null);
    const contentRef = useRef<HTMLTextAreaElement>(null);
    const debounceRef = useRef<NodeJS.Timeout>(undefined);

    // Reset state when note changes
    useEffect(() => {
        if (note) {
            setIsLocked(note.isLocked);
            setShowPasswordPrompt(note.isLocked);
            setPassword('');
            setUnlockPassword('');
            setShowPreview(false);
        }
    }, [note?.id]);

    // Auto-save with debouncing
    const debouncedSave = useCallback((updatedNote: Note) => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
            onUpdateNote(updatedNote);
        }, 300);
    }, [onUpdateNote]);

    const handleTitleChange = (newTitle: string) => {
        if (!note || (note.isLocked && !isUnlocked())) return;

        const updatedNote = { ...note, title: newTitle };
        debouncedSave(updatedNote);
    };

    const handleContentChange = (newContent: string) => {
        if (!note || (note.isLocked && !isUnlocked())) return;

        const updatedNote = { ...note, content: newContent };
        debouncedSave(updatedNote);
    };

    const handleLockToggle = () => {
        if (!note) return;

        if (!note.isLocked) {
            // Locking the note
            if (password.trim()) {
                const updatedNote = { ...note, isLocked: true, password };
                onUpdateNote(updatedNote);
                setIsLocked(true);
                setShowPasswordPrompt(true);
            }
        } else {
            // Unlocking permanently (removing password)
            if (isUnlocked()) {
                const updatedNote = { ...note, isLocked: false, password: undefined };
                onUpdateNote(updatedNote);
                setIsLocked(false);
                setShowPasswordPrompt(false);
                setPassword('');
                setUnlockPassword('');
            }
        }
    };

    const isUnlocked = () => {
        return !note?.isLocked || (note.isLocked && unlockPassword === note.password);
    };

    const handleUnlock = () => {
        if (note && unlockPassword === note.password) {
            setShowPasswordPrompt(false);
        }
    };

    // Simple markdown to HTML converter
    const markdownToHtml = useCallback((md: string) => {
        return md
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/\*\*(.*)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*)\*/g, '<em>$1</em>')
            .replace(/```([^`]*)```/g, '<pre><code>$1</code></pre>')
            .replace(/`([^`]*)`/g, '<code>$1</code>')
            .replace(/^\- (.*$)/gim, '<li>$1</li>')
            .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
            .replace(/\n/g, '<br>');
    }, []);

    if (!note) {
        return (
            <div className="flex items-center justify-center h-full bg-vd-bg-primary">
                <div className="text-center">
                    <svg className="w-16 h-16 text-vd-text-tertiary mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                    </svg>
                    <h2 className="text-xl font-semibold text-vd-text-primary mb-2">Select a note</h2>
                    <p className="text-vd-text-tertiary">Choose a note from the sidebar or create a new one</p>
                </div>
            </div>
        );
    }

    if (showPasswordPrompt && note.isLocked) {
        return (
            <div className="flex items-center justify-center h-full bg-vd-bg-primary">
                <div className="text-center max-w-sm">
                    <div className="w-16 h-16 bg-vd-bg-tertiary rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-vd-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-semibold text-vd-text-primary mb-2">This note is locked</h2>
                    <p className="text-vd-text-tertiary mb-6">Enter the password to view this note</p>
                    <div className="space-y-3">
                        <input
                            type="password"
                            value={unlockPassword}
                            onChange={(e) => setUnlockPassword(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                            placeholder="Enter password"
                            className="w-full px-4 py-2 text-sm bg-vd-bg-secondary border border-vd-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vd-accent-gold/50 focus:border-vd-accent-gold text-vd-text-primary placeholder-vd-text-tertiary text-center"
                            autoFocus
                        />
                        <button
                            onClick={handleUnlock}
                            disabled={!unlockPassword.trim()}
                            className="w-full px-4 py-2 bg-vd-accent-gold text-black rounded-lg hover:bg-vd-accent-gold/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Unlock
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const canEdit = !note.isLocked || isUnlocked();

    return (
        <div className="flex flex-col h-full bg-vd-bg-primary">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-vd-border">
                <div className="flex items-center gap-3">
                    {note.isLocked && (
                        <svg className="w-4 h-4 text-vd-accent-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                    )}
                    <span className="text-sm text-vd-text-tertiary">
                        {new Date(note.updatedAt).toLocaleString()}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    {/* Mode toggle */}
                    <div className="flex items-center border border-vd-border rounded-lg overflow-hidden">
                        <button
                            onClick={() => {
                                setIsMarkdownMode(false);
                                setShowPreview(false);
                            }}
                            className={`px-3 py-1 text-xs transition-colors ${
                                !isMarkdownMode
                                    ? 'bg-vd-accent-gold/20 text-vd-accent-gold'
                                    : 'text-vd-text-tertiary hover:text-vd-text-secondary'
                            }`}
                        >
                            Text
                        </button>
                        <button
                            onClick={() => setIsMarkdownMode(true)}
                            className={`px-3 py-1 text-xs transition-colors ${
                                isMarkdownMode
                                    ? 'bg-vd-accent-gold/20 text-vd-accent-gold'
                                    : 'text-vd-text-tertiary hover:text-vd-text-secondary'
                            }`}
                        >
                            Markdown
                        </button>
                    </div>

                    {/* Preview toggle (only for markdown) */}
                    {isMarkdownMode && canEdit && (
                        <button
                            onClick={() => setShowPreview(!showPreview)}
                            className={`px-3 py-1 text-xs rounded transition-colors ${
                                showPreview
                                    ? 'bg-vd-accent-gold/20 text-vd-accent-gold'
                                    : 'text-vd-text-tertiary hover:text-vd-text-secondary border border-vd-border'
                            }`}
                        >
                            {showPreview ? 'Edit' : 'Preview'}
                        </button>
                    )}

                    {/* Lock toggle */}
                    <div className="flex items-center gap-2">
                        {!note.isLocked && canEdit && (
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Set password..."
                                className="px-2 py-1 text-xs bg-vd-bg-secondary border border-vd-border rounded focus:outline-none focus:ring-1 focus:ring-vd-accent-gold/50 text-vd-text-primary placeholder-vd-text-tertiary w-32"
                            />
                        )}
                        <button
                            onClick={handleLockToggle}
                            disabled={!note.isLocked && !password.trim()}
                            className={`px-3 py-1 text-xs rounded transition-colors ${
                                note.isLocked
                                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                    : 'bg-vd-accent-gold/20 text-vd-accent-gold hover:bg-vd-accent-gold/30'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            {note.isLocked ? 'Remove Lock' : 'Lock Note'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Title */}
            <div className="px-6 py-4 border-b border-vd-border">
                <input
                    ref={titleRef}
                    type="text"
                    defaultValue={note.title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="Note title..."
                    disabled={!canEdit}
                    className="w-full text-2xl font-semibold bg-transparent border-none focus:outline-none text-vd-text-primary placeholder-vd-text-tertiary disabled:cursor-default"
                />
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0">
                {showPreview && isMarkdownMode ? (
                    <div className="h-full p-6 overflow-y-auto">
                        <div
                            className="prose prose-invert prose-headings:text-vd-text-primary prose-p:text-vd-text-secondary prose-strong:text-vd-text-primary prose-code:text-vd-accent-gold prose-code:bg-vd-bg-tertiary prose-code:px-1 prose-code:rounded prose-pre:bg-vd-bg-tertiary prose-pre:border prose-pre:border-vd-border max-w-none leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: markdownToHtml(note.content) }}
                        />
                    </div>
                ) : (
                    <textarea
                        ref={contentRef}
                        defaultValue={note.content}
                        onChange={(e) => handleContentChange(e.target.value)}
                        placeholder={
                            isMarkdownMode
                                ? "# Start writing in Markdown...\n\n- Use **bold** and *italic* text\n- Add `inline code` or:\n\n```\ncode blocks\n```\n\n## Lists and headers work too!"
                                : "Start writing your note here...\n\nYour changes will be auto-saved."
                        }
                        disabled={!canEdit}
                        className="w-full h-full p-6 bg-transparent border-none resize-none focus:outline-none text-vd-text-primary placeholder-vd-text-tertiary leading-relaxed disabled:cursor-default"
                        style={{
                            fontFamily: isMarkdownMode
                                ? 'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Inconsolata, "Roboto Mono", "Noto Mono", "Courier New", monospace'
                                : 'inherit'
                        }}
                        spellCheck={!isMarkdownMode}
                    />
                )}
            </div>
        </div>
    );
}