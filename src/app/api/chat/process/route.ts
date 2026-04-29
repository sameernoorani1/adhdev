// AD-181: /process-chat — sends a short prompt to the connected coding
// agent telling it to triage unaddressed Inbox messages. The full per-
// message contract lives in ADHDEV.md (Chat Run Protocol section), so this
// prompt only needs to point at it — same shape as the ticket-run prompt
// in src/lib/feedback/runPrompt.ts.

import { NextRequest, NextResponse } from 'next/server';
import { checkAdmin } from '@/lib/feedback/core';
import { readChat, writeChat, newChatMessageId, type ChatMessage } from '@/lib/feedback/chat';

const TERMINAL_URL = 'http://localhost:3112';

function getProjectId(request: NextRequest): string | null {
    return request.headers.get('x-adhdev-project');
}

function buildProcessPrompt(unaddressedCount: number): string {
    // AD-181 reopen #3 — diagnosis: ticket-runs work because their
    // prompt is 3 sentences pointing at the contract; my old chat-run prompt
    // was a 50-line wall of meta-framing and curl shapes, which itself
    // signals "discuss me" to the agent. Mirror the ticket-run shape.
    return [
        `Run chat triage. ${unaddressedCount} unaddressed message(s) in the Brain Dump.`,
        'Read ADHDEV.md (Chat Run Protocol section) for the per-message contract, then process all unaddressed entries from `.adhdev/chat.json`. Filter programmatically by `status === "unaddressed"` via `GET /api/chat` — do not blindly read the whole file if it is large.',
        'Add this acknowledgement to the chat system summary and terminal summary both: ✅ ACK: Prompt ADHDev Guidance.',
    ].join('\n');
}

// AD-181 reopen #2: post a `system` row into the chat panel at run start so
// the user sees the run happened, even if the agent botches everything else.
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
        // Visible-progress breadcrumb in the chat panel itself — appears
        // before the agent does anything, so the user sees the run fired even
        // if the agent silently fails.
        try {
            appendSystemMessage(`🤖 Processing ${unaddressed.length} message(s) — your connected agent is on it.`, projectId);
        } catch {
            // Non-fatal: continue even if the system row can't be written.
        }
        // Send the prompt to the connected agent via the terminal server's
        // /execute endpoint — same channel /api/run uses.
        try {
            const executeRes = await fetch(`${TERMINAL_URL}/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    command: prompt,
                    projectId: projectId ?? undefined,
                }),
            });
            if (!executeRes.ok) throw new Error(`terminal server ${executeRes.status}`);
        } catch (err) {
            return NextResponse.json({
                success: false,
                message: 'Failed to send prompt to the coding agent. Is your agent running?',
                error: String(err),
            }, { status: 503 });
        }
        return NextResponse.json({
            success: true,
            unaddressedCount: unaddressed.length,
            message: `Sent ${unaddressed.length} unaddressed message(s) to the coding agent.`,
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
