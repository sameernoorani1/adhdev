'use client';

import { useState, useEffect, useCallback } from 'react';
import { NoteSidebar } from './NoteSidebar';
import { NoteEditor } from './NoteEditor';
import { NotesProvider, useNotes } from './NotesContext';
import { Note, Folder } from './types';

function NotesAppContent() {
    const {
        notes,
        folders,
        selectedNote,
        selectedFolder,
        searchQuery,
        setSelectedNote,
        setSelectedFolder,
        setSearchQuery,
        createNote,
        updateNote,
        deleteNote,
        createFolder,
        deleteFolder
    } = useNotes();

    const [sidebarWidth, setSidebarWidth] = useState(280);

    // Handle keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Cmd/Ctrl + N for new note
            if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
                e.preventDefault();
                createNote();
            }
            // Cmd/Ctrl + F for search
            if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                e.preventDefault();
                const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement;
                if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [createNote]);

    return (
        <div className="flex h-screen bg-vd-bg-primary">
            {/* Sidebar */}
            <div
                style={{ width: sidebarWidth }}
                className="flex-shrink-0 bg-vd-bg-secondary border-r border-vd-border"
            >
                <NoteSidebar
                    notes={notes}
                    folders={folders}
                    selectedNote={selectedNote}
                    selectedFolder={selectedFolder}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onSelectNote={setSelectedNote}
                    onSelectFolder={setSelectedFolder}
                    onCreateNote={createNote}
                    onDeleteNote={deleteNote}
                    onCreateFolder={createFolder}
                    onDeleteFolder={deleteFolder}
                />
            </div>

            {/* Resize handle */}
            <div
                className="w-1 bg-vd-border hover:bg-vd-accent-gold/30 cursor-col-resize flex-shrink-0 transition-colors"
                onMouseDown={(e) => {
                    const startX = e.pageX;
                    const startWidth = sidebarWidth;

                    const handleMouseMove = (e: MouseEvent) => {
                        const newWidth = Math.max(220, Math.min(400, startWidth + e.pageX - startX));
                        setSidebarWidth(newWidth);
                    };

                    const handleMouseUp = () => {
                        document.removeEventListener('mousemove', handleMouseMove);
                        document.removeEventListener('mouseup', handleMouseUp);
                    };

                    document.addEventListener('mousemove', handleMouseMove);
                    document.addEventListener('mouseup', handleMouseUp);
                }}
            />

            {/* Main editor area */}
            <div className="flex-1 min-w-0">
                <NoteEditor
                    note={selectedNote}
                    onUpdateNote={updateNote}
                />
            </div>
        </div>
    );
}

export function NotesApp() {
    return (
        <NotesProvider>
            <NotesAppContent />
        </NotesProvider>
    );
}