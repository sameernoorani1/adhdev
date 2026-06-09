// AD-181: /process-chat sends a short prompt to the connected coding agent
// telling it to triage unaddressed Inbox messages. The full per-message
// contract lives in ADHDEV.md (Chat Run Protocol section), so this prompt only
// needs to point at it.

import { NextRequest, NextResponse } from 'next/server';
import { checkAdmin } from '@/lib/feedback/core';
import { readChat, writeChat, newChatMessageId, type ChatMessage } from '@/lib/feedback/chat';
import { executeAgentPrompt } from '@/lib/feedback/runExecution';

function getProjectId(request: NextRequest): string | null {
    return request.headers.get('x-adhdev-project');
}

function buildProcessPrompt(unaddressedCount: number): string {
    return [
        `Run chat triage. ${unaddressedCount} unaddressed message(s) in the Brain Dump.`,
        'Read ADHDEV.md (Chat Run Protocol section) for the per-message contract, then process all unaddressed entries from `.adhdev/chat.json`. Filter programmatically by `status === "unaddressed"` via `GET /api/chat` - do not blindly read the whole file if it is large.',
        'Add this acknowledgement to the chat system summary and terminal summary both: ✅ ACK: Prompt ADHDev Guidance.',
    ].join('\n');
}

function appendSystemMessage(content: string, projectId: string | null): void {
    const store = readChat(projectId);
    const msg: ChatMessage = {
        id: newChatMessageId(),
        author: 'system',
        authorType: 'system',
        content,
        images: [],
        createdAt: new Date().toISOString(),
        status: 'addressed',
    };
    store.messages.push(msg);
    writeChat(store, projectId);
}

export async function POST(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const projectId = getProjectId(request);
        const store = readChat(projectId);
        const unaddressed = store.messages.filter(m => m.status === 'unaddressed');
        if (unaddressed.length === 0) {
            return NextResponse.json({
                success: false,
                message: 'No unaddressed chat messages to process.',
                unaddressedCount: 0,
            });
        }

        const prompt = buildProcessPrompt(unaddressed.length);
        const execution = await executeAgentPrompt(prompt, projectId, [], null, {
            agentRequirement: 'required',
            taskLabel: 'Brain Dump triage',
        });
        if (!execution.success) {
            return NextResponse.json({
                ...execution,
                unaddressedCount: unaddressed.length,
            }, { status: execution.pendingLaunch ? 409 : 503 });
        }

        try {
            appendSystemMessage(`Processing ${unaddressed.length} message(s) - your connected agent is on it.`, projectId);
        } catch (err) {
            console.error('[ADHDev] POST /api/chat/process system-row error:', err);
        }

        return NextResponse.json({
            success: true,
            unaddressedCount: unaddressed.length,
            message: `Sent ${unaddressed.length} unaddressed message(s) to the coding agent.`,
        });
    } catch (err) {
        console.error('[ADHDev] POST /api/chat/process error:', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
