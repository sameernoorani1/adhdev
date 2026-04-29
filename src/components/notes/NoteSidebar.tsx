'use client';

import { useState, useMemo } from 'react';
import { Note, Folder } from './types';

interface NoteSidebarProps {
    notes: Note[];
    folders: Folder[];
    selectedNote: Note | null;
    selectedFolder: string | null;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    onSelectNote: (note: Note) => void;
    onSelectFolder: (folderId: string | null) => void;
    onCreateNote: (folderId?: string) => void;
    onDeleteNote: (noteId: string) => void;
    onCreateFolder: (name: string) => void;
    onDeleteFolder: (folderId: string) => void;
}

export function NoteSidebar({
    notes,
    folders,
    selectedNote,
    selectedFolder,
    searchQuery,
    onSearchChange,
    onSelectNote,
    onSelectFolder,
    onCreateNote,
    onDeleteNote,
    onCreateFolder,
    onDeleteFolder
}: NoteSidebarProps) {
    const [showNewFolderInput, setShowNewFolderInput] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');

    // Filter notes based on search and selected folder
    const filteredNotes = useMemo(() => {
        let filtered = notes;

        // Filter by folder
        if (selectedFolder) {
            filtered = filtered.filter(note => note.folderId === selectedFolder);
        } else if (selectedFolder === null) {
            // Show all notes when no folder is selected
            // filtered = filtered;
        }

        // Filter by search query
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(note =>
                note.title.toLowerCase().includes(query) ||
                note.content.toLowerCase().includes(query)
            );
        }

        // Sort by updated date (most recent first)
        return filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }, [notes, selectedFolder, searchQuery]);

    // Calculate note count for each folder
    const foldersWithCount = useMemo(() => {
        return folders.map(folder => ({
            ...folder,
            noteCount: notes.filter(note => note.folderId === folder.id).length
        }));
    }, [folders, notes]);

    const handleCreateFolder = () => {
        if (newFolderName.trim()) {
            onCreateFolder(newFolderName.trim());
            setNewFolderName('');
            setShowNewFolderInput(false);
        }
    };

    const formatDate = (date: Date) => {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        if (diffHours < 1) {
            return 'Just now';
        } else if (diffHours < 24) {
            return `${Math.floor(diffHours)}h ago`;
        } else if (diffDays < 7) {
            return `${Math.floor(diffDays)}d ago`;
        } else {
            return date.toLocaleDateString();
        }
    };

    const truncateContent = (content: string, maxLength: number = 50) => {
        if (content.length <= maxLength) return content;
        return content.substring(0, maxLength) + '...';
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header with search */}
            <div className="p-4 border-b border-vd-border">
                <div className="flex items-center gap-2 mb-3">
                    <svg className="w-5 h-5 text-vd-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                    </svg>
                    <h1 className="text-lg font-semibold text-vd-text-primary">Notes</h1>
                </div>

                {/* Search input */}
                <div className="relative">
                    <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-vd-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search notes..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        data-search-input
                        className="w-full pl-9 pr-3 py-2 text-sm bg-vd-bg-tertiary border border-vd-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vd-accent-gold/50 focus:border-vd-accent-gold text-vd-text-primary placeholder-vd-text-tertiary"
                    />
                </div>
            </div>

            {/* Folders section */}
            <div className="flex-shrink-0 p-4 border-b border-vd-border">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-medium text-vd-text-secondary">Folders</h2>
                    <button
                        onClick={() => setShowNewFolderInput(true)}
                        className="p-1 text-vd-text-tertiary hover:text-vd-text-secondary transition-colors"
                        title="New folder"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                    </button>
                </div>

                <div className="space-y-1">
                    {/* All Notes */}
                    <button
                        onClick={() => onSelectFolder(null)}
                        className={`w-full flex items-center justify-between px-2 py-1.5 text-sm rounded transition-colors ${
                            selectedFolder === null
                                ? 'bg-vd-accent-gold/20 text-vd-accent-gold'
                                : 'text-vd-text-secondary hover:bg-vd-bg-tertiary'
                        }`}
                    >
                        <div className="flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 7a2 2 0 012-2h5.586a1 1 0 01.707.293L15 7H5z" />
                            </svg>
                            <span>All Notes</span>
                        </div>
                        <span className="text-xs text-vd-text-tertiary">{notes.length}</span>
                    </button>

                    {/* Folder list */}
                    {foldersWithCount.map(folder => (
                        <div key={folder.id} className="group">
                            <button
                                onClick={() => onSelectFolder(folder.id)}
                                className={`w-full flex items-center justify-between px-2 py-1.5 text-sm rounded transition-colors ${
                                    selectedFolder === folder.id
                                        ? 'bg-vd-accent-gold/20 text-vd-accent-gold'
                                        : 'text-vd-text-secondary hover:bg-vd-bg-tertiary'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                    </svg>
                                    <span>{folder.name}</span>
                                </div>
                                <span className="text-xs text-vd-text-tertiary">{folder.noteCount}</span>
                            </button>
                        </div>
                    ))}

                    {/* New folder input */}
                    {showNewFolderInput && (
                        <div className="px-2 py-1">
                            <input
                                type="text"
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCreateFolder();
                                    if (e.key === 'Escape') {
                                        setShowNewFolderInput(false);
                                        setNewFolderName('');
                                    }
                                }}
                                onBlur={() => {
                                    if (!newFolderName.trim()) {
                                        setShowNewFolderInput(false);
                                    }
                                }}
                                placeholder="Folder name..."
                                autoFocus
                                className="w-full px-2 py-1 text-sm bg-vd-bg-primary border border-vd-border rounded focus:outline-none focus:ring-1 focus:ring-vd-accent-gold/50 text-vd-text-primary placeholder-vd-text-tertiary"
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Notes list */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-medium text-vd-text-secondary">
                            {selectedFolder ? folders.find(f => f.id === selectedFolder)?.name : 'All Notes'}
                        </h2>
                        <button
                            onClick={() => onCreateNote(selectedFolder || undefined)}
                            className="p-1 text-vd-text-tertiary hover:text-vd-text-secondary transition-colors"
                            title="New note (⌘N)"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                        </button>
                    </div>

                    <div className="space-y-2">
                        {filteredNotes.length === 0 ? (
                            <div className="text-center py-8">
                                <svg className="w-12 h-12 text-vd-text-tertiary mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                                </svg>
                                <p className="text-sm text-vd-text-tertiary">No notes yet</p>
                                <button
                                    onClick={() => onCreateNote(selectedFolder || undefined)}
                                    className="mt-2 text-sm text-vd-accent-gold hover:text-vd-accent-gold/80 transition-colors"
                                >
                                    Create your first note
                                </button>
                            </div>
                        ) : (
                            filteredNotes.map(note => (
                                <div
                                    key={note.id}
                                    onClick={() => onSelectNote(note)}
                                    className={`p-3 rounded-lg border cursor-pointer transition-all group ${
                                        selectedNote?.id === note.id
                                            ? 'bg-vd-accent-gold/10 border-vd-accent-gold/30'
                                            : 'bg-vd-bg-tertiary border-vd-border hover:border-vd-accent-gold/50'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-2 mb-1">
                                        <h3 className={`text-sm font-medium truncate ${
                                            selectedNote?.id === note.id ? 'text-vd-accent-gold' : 'text-vd-text-primary'
                                        }`}>
                                            {note.title || 'Untitled'}
                                        </h3>
                                        {note.isLocked && (
                                            <svg className="w-3 h-3 text-vd-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                            </svg>
                                        )}
                                    </div>
                                    {note.content && (
                                        <p className="text-xs text-vd-text-tertiary mb-2 leading-relaxed">
                                            {truncateContent(note.content)}
                                        </p>
                                    )}
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-vd-text-tertiary">
                                            {formatDate(new Date(note.updatedAt))}
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (confirm('Delete this note?')) {
                                                    onDeleteNote(note.id);
                                                }
                                            }}
                                            className="opacity-0 group-hover:opacity-100 p-1 text-vd-text-tertiary hover:text-red-500 transition-all"
                                            title="Delete note"
                                        >
                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}