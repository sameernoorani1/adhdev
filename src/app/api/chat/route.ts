// AD-181: chat API — GET/POST/PATCH against the per-project chat trail.
// Storage lives at `.adhdev/chat.json`. Each entry is a ChatMessage with a
// status (`unaddressed` / `in_progress` / `addressed` / `noted`) so the
// /process-chat run can later pick up unaddressed entries and act on them.

import { NextRequest, NextResponse } from 'next/server';
import { checkAdmin } from '@/lib/feedback/core';
import {
    readChat,
    writeChat,
    newChatMessageId,
    type ChatMessage,
    type ChatMessageStatus,
    type ChatActionRecord,
} from '@/lib/feedback/chat';

function getProjectId(request: NextRequest): string | null {
    return request.headers.get('x-adhdev-project');
}

const VALID_STATUSES: ChatMessageStatus[] = ['unaddressed', 'in_progress', 'addressed', 'noted'];

export async function GET(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;
    const store = readChat(getProjectId(request));
    return NextResponse.json(store);
}

export async function POST(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;
    try {
        const body = await request.json();
        const projectId = getProjectId(request);
        const store = readChat(projectId);
        const now = new Date().toISOString();
        const msg: ChatMessage = {
            id: newChatMessageId(),
            author: typeof body.author === 'string' && body.author.trim() ? body.author : 'You',
            authorType: body.authorType === 'ai' || body.authorType === 'system' ? body.authorType : 'human',
            content: typeof body.content === 'string' ? body.content : '',
            images: Array.isArray(body.images) ? body.images : [],
            createdAt: now,
            status: body.parentMessageId ? 'addressed' : 'unaddressed', // AI replies are themselves "addressed"
            parentMessageId: typeof body.parentMessageId === 'string' ? body.parentMessageId : undefined,
            actions: Array.isArray(body.actions) ? (body.actions as ChatActionRecord[]) : undefined,
        };
        if (!msg.content.trim() && msg.images.length === 0) {
            return NextResponse.json({ error: 'Empty message' }, { status: 400 });
        }
        store.messages.push(msg);
        writeChat(store, projectId);
        return NextResponse.json(msg, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Failed to add message' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;
    try {
        const body = await request.json();
        const projectId = getProjectId(request);
        const store = readChat(projectId);
        const id = body.id;
        if (!id) return NextResponse.json({ error: 'Required: { id, updates }' }, { status: 400 });
        const idx = store.messages.findIndex(m => m.id === id);
        if (idx < 0) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
        const updates = body.updates || {};
        const next: ChatMessage = { ...store.messages[idx] };
        if (typeof updates.content === 'string') next.content = updates.content;
        if (typeof updates.status === 'string' && VALID_STATUSES.includes(updates.status as ChatMessageStatus)) {
            next.status = updates.status as ChatMessageStatus;
        }
        if (Array.isArray(updates.images)) next.images = updates.images;
        if (Array.isArray(updates.actions)) next.actions = updates.actions as ChatActionRecord[];
        store.messages[idx] = next;
        writeChat(store, projectId);
        return NextResponse.json(next);
    } catch {
        return NextResponse.json({ error: 'Failed to update message' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;
    try {
        const url = new URL(request.url);
        const id = url.searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'Required: ?id=<messageId>' }, { status: 400 });
        const projectId = getProjectId(request);
        const store = readChat(projectId);
        const before = store.messages.length;
        store.messages = store.messages.filter(m => m.id !== id);
        if (store.messages.length === before) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
        writeChat(store, projectId);
        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
    }
}
