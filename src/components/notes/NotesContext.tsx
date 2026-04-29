'use client';

import { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { Note, Folder, NotesState, NotesAction } from './types';

const STORAGE_KEYS = {
    NOTES: 'adhdev-notes',
    FOLDERS: 'adhdev-folders',
    SELECTED_NOTE: 'adhdev-selected-note',
    SELECTED_FOLDER: 'adhdev-selected-folder'
};

const initialState: NotesState = {
    notes: [],
    folders: [],
    selectedNote: null,
    selectedFolder: null,
    searchQuery: ''
};

function notesReducer(state: NotesState, action: NotesAction): NotesState {
    switch (action.type) {
        case 'SET_NOTES':
            return { ...state, notes: action.notes };
        case 'SET_FOLDERS':
            return { ...state, folders: action.folders };
        case 'SET_SELECTED_NOTE':
            return { ...state, selectedNote: action.note };
        case 'SET_SELECTED_FOLDER':
            return { ...state, selectedFolder: action.folderId };
        case 'SET_SEARCH_QUERY':
            return { ...state, searchQuery: action.query };
        case 'CREATE_NOTE':
            return { ...state, notes: [...state.notes, action.note], selectedNote: action.note };
        case 'UPDATE_NOTE':
            return {
                ...state,
                notes: state.notes.map(note => note.id === action.note.id ? action.note : note),
                selectedNote: state.selectedNote?.id === action.note.id ? action.note : state.selectedNote
            };
        case 'DELETE_NOTE':
            const filteredNotes = state.notes.filter(note => note.id !== action.noteId);
            return {
                ...state,
                notes: filteredNotes,
                selectedNote: state.selectedNote?.id === action.noteId
                    ? (filteredNotes.length > 0 ? filteredNotes[0] : null)
                    : state.selectedNote
            };
        case 'CREATE_FOLDER':
            return { ...state, folders: [...state.folders, action.folder] };
        case 'DELETE_FOLDER':
            return {
                ...state,
                folders: state.folders.filter(folder => folder.id !== action.folderId),
                notes: state.notes.map(note =>
                    note.folderId === action.folderId
                        ? { ...note, folderId: null }
                        : note
                ),
                selectedFolder: state.selectedFolder === action.folderId ? null : state.selectedFolder
            };
        default:
            return state;
    }
}

interface NotesContextType {
    notes: Note[];
    folders: Folder[];
    selectedNote: Note | null;
    selectedFolder: string | null;
    searchQuery: string;
    setSelectedNote: (note: Note | null) => void;
    setSelectedFolder: (folderId: string | null) => void;
    setSearchQuery: (query: string) => void;
    createNote: (folderId?: string) => void;
    updateNote: (note: Note) => void;
    deleteNote: (noteId: string) => void;
    createFolder: (name: string) => void;
    deleteFolder: (folderId: string) => void;
}

const NotesContext = createContext<NotesContextType | null>(null);

export function NotesProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(notesReducer, initialState);

    // Load data from localStorage on mount
    useEffect(() => {
        try {
            const savedNotes = localStorage.getItem(STORAGE_KEYS.NOTES);
            const savedFolders = localStorage.getItem(STORAGE_KEYS.FOLDERS);
            const savedSelectedNoteId = localStorage.getItem(STORAGE_KEYS.SELECTED_NOTE);
            const savedSelectedFolder = localStorage.getItem(STORAGE_KEYS.SELECTED_FOLDER);

            if (savedNotes) {
                const notes: Note[] = JSON.parse(savedNotes).map((note: any) => ({
                    ...note,
                    createdAt: new Date(note.createdAt),
                    updatedAt: new Date(note.updatedAt)
                }));
                dispatch({ type: 'SET_NOTES', notes });

                // Restore selected note
                if (savedSelectedNoteId) {
                    const selectedNote = notes.find(note => note.id === savedSelectedNoteId);
                    if (selectedNote) {
                        dispatch({ type: 'SET_SELECTED_NOTE', note: selectedNote });
                    }
                } else if (notes.length > 0) {
                    dispatch({ type: 'SET_SELECTED_NOTE', note: notes[0] });
                }
            }

            if (savedFolders) {
                const folders: Folder[] = JSON.parse(savedFolders).map((folder: any) => ({
                    ...folder,
                    createdAt: new Date(folder.createdAt)
                }));
                dispatch({ type: 'SET_FOLDERS', folders });
            } else {
                // Create default folders
                const defaultFolders: Folder[] = [
                    {
                        id: 'default-notes',
                        name: 'Notes',
                        createdAt: new Date(),
                        noteCount: 0
                    },
                    {
                        id: 'default-ideas',
                        name: 'Ideas',
                        createdAt: new Date(),
                        noteCount: 0
                    }
                ];
                dispatch({ type: 'SET_FOLDERS', folders: defaultFolders });
            }

            if (savedSelectedFolder) {
                dispatch({ type: 'SET_SELECTED_FOLDER', folderId: savedSelectedFolder });
            }
        } catch (error) {
            console.error('Failed to load notes data:', error);
        }
    }, []);

    // Save data to localStorage when state changes
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(state.notes));
        } catch (error) {
            console.error('Failed to save notes:', error);
        }
    }, [state.notes]);

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEYS.FOLDERS, JSON.stringify(state.folders));
        } catch (error) {
            console.error('Failed to save folders:', error);
        }
    }, [state.folders]);

    useEffect(() => {
        try {
            if (state.selectedNote) {
                localStorage.setItem(STORAGE_KEYS.SELECTED_NOTE, state.selectedNote.id);
            } else {
                localStorage.removeItem(STORAGE_KEYS.SELECTED_NOTE);
            }
        } catch (error) {
            console.error('Failed to save selected note:', error);
        }
    }, [state.selectedNote]);

    useEffect(() => {
        try {
            if (state.selectedFolder) {
                localStorage.setItem(STORAGE_KEYS.SELECTED_FOLDER, state.selectedFolder);
            } else {
                localStorage.removeItem(STORAGE_KEYS.SELECTED_FOLDER);
            }
        } catch (error) {
            console.error('Failed to save selected folder:', error);
        }
    }, [state.selectedFolder]);

    const createNote = (folderId?: string) => {
        const now = new Date();
        const note: Note = {
            id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: 'Untitled',
            content: '',
            folderId: folderId || state.selectedFolder || null,
            createdAt: now,
            updatedAt: now,
            isLocked: false
        };
        dispatch({ type: 'CREATE_NOTE', note });
    };

    const updateNote = (note: Note) => {
        const updatedNote = { ...note, updatedAt: new Date() };
        dispatch({ type: 'UPDATE_NOTE', note: updatedNote });
    };

    const deleteNote = (noteId: string) => {
        dispatch({ type: 'DELETE_NOTE', noteId });
    };

    const createFolder = (name: string) => {
        const folder: Folder = {
            id: `folder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name,
            createdAt: new Date(),
            noteCount: 0
        };
        dispatch({ type: 'CREATE_FOLDER', folder });
    };

    const deleteFolder = (folderId: string) => {
        dispatch({ type: 'DELETE_FOLDER', folderId });
    };

    const setSelectedNote = (note: Note | null) => {
        dispatch({ type: 'SET_SELECTED_NOTE', note });
    };

    const setSelectedFolder = (folderId: string | null) => {
        dispatch({ type: 'SET_SELECTED_FOLDER', folderId });
    };

    const setSearchQuery = (query: string) => {
        dispatch({ type: 'SET_SEARCH_QUERY', query });
    };

    return (
        <NotesContext.Provider
            value={{
                notes: state.notes,
                folders: state.folders,
                selectedNote: state.selectedNote,
                selectedFolder: state.selectedFolder,
                searchQuery: state.searchQuery,
                setSelectedNote,
                setSelectedFolder,
                setSearchQuery,
                createNote,
                updateNote,
                deleteNote,
                createFolder,
                deleteFolder
            }}
        >
            {children}
        </NotesContext.Provider>
    );
}

export function useNotes() {
    const context = useContext(NotesContext);
    if (!context) {
        throw new Error('useNotes must be used within a NotesProvider');
    }
    return context;
}