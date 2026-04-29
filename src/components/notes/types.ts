export interface Note {
    id: string;
    title: string;
    content: string;
    folderId: string | null;
    createdAt: Date;
    updatedAt: Date;
    isLocked: boolean;
    password?: string;
}

export interface Folder {
    id: string;
    name: string;
    color?: string;
    createdAt: Date;
    noteCount: number;
}

export interface NotesState {
    notes: Note[];
    folders: Folder[];
    selectedNote: Note | null;
    selectedFolder: string | null;
    searchQuery: string;
}

export type NotesAction =
    | { type: 'SET_NOTES'; notes: Note[] }
    | { type: 'SET_FOLDERS'; folders: Folder[] }
    | { type: 'SET_SELECTED_NOTE'; note: Note | null }
    | { type: 'SET_SELECTED_FOLDER'; folderId: string | null }
    | { type: 'SET_SEARCH_QUERY'; query: string }
    | { type: 'CREATE_NOTE'; note: Note }
    | { type: 'UPDATE_NOTE'; note: Note }
    | { type: 'DELETE_NOTE'; noteId: string }
    | { type: 'CREATE_FOLDER'; folder: Folder }
    | { type: 'DELETE_FOLDER'; folderId: string };