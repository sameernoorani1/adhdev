import { NextRequest, NextResponse } from 'next/server';
import { terminalAuthHeaders } from '@/lib/feedback/sessionToken';
import { checkAdmin } from '@/lib/feedback/core';
import { existsSync } from 'node:fs';

// §5.4 follow-up: generic agent-install endpoint. Same shape as AD-228's
// /api/install-claude but takes an agentId and ships the matching install
// command into the embedded terminal session. Used by Wizard Step 2 + the
// board's agent panel so the user can one-click any of the recognised CLIs
// without leaving ADHDev.
//
// The mapping is hard-coded server-side so a malicious client can't smuggle
// arbitrary commands through the endpoint — only the six known CLIs are
// installable via this route. Anything else returns 400.

function npmGlobalInstallCommand(packageName: string): string {
    if (process.platform !== 'win32') return `npm i -g ${packageName}`;

    // AD-268: terminal sessions can be cmd.exe or PowerShell, and PowerShell
    // may reject npm.ps1. Run npm through cmd.exe; prefer Node's default short
    // path so the command also survives shells that mishandle quoted paths.
    const nodeNpm = 'C:\\Progra~1\\nodejs\\npm.cmd';
    const npm = existsSync(nodeNpm) ? nodeNpm : 'npm';
    return `cmd.exe /d /c ${npm} i -g ${packageName}`;
}

const INSTALL_COMMANDS: Record<string, string> = {
    'Claude Code':  npmGlobalInstallCommand('@anthropic-ai/claude-code@latest'),
    'Codex':        npmGlobalInstallCommand('@openai/codex@latest'),
    'Gemini CLI':   npmGlobalInstallCommand('@google/gemini-cli'),
    'Aider':        'pip install -U aider-chat',
    // Cursor Agent ships with the Cursor IDE — there's no CLI install command.
    // Surface a guidance message instead of a no-op shell command.
    'Cursor Agent': '',
    'Continue':     '',
};

const GUIDANCE_ONLY: Record<string, string> = {
    'Cursor Agent': 'Cursor Agent ships inside the Cursor IDE. Install Cursor from cursor.sh — `cursor-agent` becomes available on PATH after first launch.',
    'Continue':     'Continue is an editor extension, not a global CLI. Install from continue.dev/install for VS Code or JetBrains; the CLI surface depends on the host editor.',
};

export async function POST(request: NextRequest) {
    const auth = await checkAdmin(request);
    if (!auth.authorized) return auth.error!;
    let body: { agentId?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const agentId = body.agentId || '';
    if (!(agentId in INSTALL_COMMANDS)) {
        return NextResponse.json({ error: 'unknown_agent', allowed: Object.keys(INSTALL_COMMANDS) }, { status: 400 });
    }

    if (GUIDANCE_ONLY[agentId]) {
        return NextResponse.json({ guidanceOnly: true, message: GUIDANCE_ONLY[agentId] });
    }

    const command = INSTALL_COMMANDS[agentId];
    const projectId = request.headers.get('x-adhdev-project');

    try {
        const r = await fetch('http://localhost:3112/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...terminalAuthHeaders() },
            body: JSON.stringify({ command, projectId: projectId ?? undefined, submitMode: 'shell' }),
        });

        if (!r.ok) {
            const text = await r.text().catch(() => '');
            return NextResponse.json(
                { error: `Terminal server returned ${r.status}`, detail: text || undefined, command },
                { status: 502 },
            );
        }

        return NextResponse.json({ success: true, command, agentId });
    } catch (err) {
        console.error('[ADHDev] POST /api/install-agent error:', err);
        return NextResponse.json(
            { error: 'Terminal server unreachable. Open the terminal pane and run the command manually.', command },
            { status: 502 },
        );
    }
}
