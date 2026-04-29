// AD-181: chat-trail storage. A simple notepad with persistence — every
// message is a timestamped entry in `.adhdev/chat.json`. The Run Chat flow
// later drives the AI agent to process `unaddressed` messages and reply.
//
// Single source of truth for the JSON shape + atomic write helper. Mirrors
// the boardStore pattern from AD-175.

import fs from 'fs';
import path from 'path';
import { getActiveProject, getProjectById, initProjectDir } from './registry';

export type ChatMessageStatus = 'unaddressed' | 'in_progress' | 'addressed' | 'noted';

export interface ChatMessageImage {
    url: string;
    filename: string;
}

export interface ChatMessage {
    id: string;
    author: string;
    authorType: 'human' | 'ai' | 'system';
    content: string;
    images: ChatMessageImage[];
    createdAt: string;
    status: ChatMessageStatus;
    // For AI replies: which user message this reply is responding to.
    parentMessageId?: string;
    // What the AI did when processing this message — populated by the
    // /process-chat run so the human can see the trail.
    actions?: ChatActionRecord[];
}

export interface ChatActionRecord {
    kind: 'create' | 'edit' | 'comment' | 'subtask' | 'noted' | 'skipped';
    ticketId?: string;
    summary: string;
    at: string;
}

export interface ChatStore {
    version: 1;
    messages: ChatMessage[];
}

function getChatPath(projectId?: string | null): string {
    const project = getProjectById(projectId) || getActiveProject();
    if (project) return path.join(project.path, '.adhdev', 'chat.json');
    // Fallback: CWD (consistent with getFeedbackPath in core.ts).
    const fallback = path.join(process.cwd(), '.adhdev', 'chat.json');
    if (!fs.existsSync(path.dirname(fallback))) {
        initProjectDir(process.cwd());
    }
    return fallback;
}

export function readChat(projectId?: string | null): ChatStore {
    const file = getChatPath(projectId);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) return { version: 1, messages: [] };
    try {
        const raw = fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<ChatStore>;
        return {
            version: 1,
            messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        };
    } catch {
        return { version: 1, messages: [] };
    }
}

// Atomic write — same pattern as writeFeedback (AD-175). Mid-flush kill
// leaves the previous chat.json intact instead of a truncated file.
export function writeChat(store: ChatStore, projectId?: string | null): void {
    const file = getChatPath(projectId);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload = JSON.stringify(store, null, 2) + '\n';
    const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
    try {
        fs.writeFileSync(tmp, payload, 'utf-8');
        fs.renameSync(tmp, file);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch {}
        throw err;
    }
}

export function newChatMessageId(): string {
    return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
