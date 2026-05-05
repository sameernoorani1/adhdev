import { NextRequest, NextResponse } from 'next/server';
import { terminalAuthHeaders } from '@/lib/feedback/sessionToken';

// AD-228: one-shot trigger that runs `npm i -g @anthropic-ai/claude-code@latest`
// in the embedded terminal session. Used by the friendly first-run install card
// shown when /api/claude-version returns { ok: false, error: 'not_found' }.
//
// Auto-execute is safe in the not_found case: there's no live Claude Code REPL
// to corrupt — the user's session.shell is just bash / PowerShell. For the
// outdated case we deliberately keep the existing copy-to-clipboard flow,
// because a live (crashing) REPL may swallow the npm command as a prompt.
const INSTALL_COMMAND = 'npm i -g @anthropic-ai/claude-code@latest';

export async function POST(request: NextRequest) {
    const projectId = request.headers.get('x-adhdev-project');

    try {
        const r = await fetch('http://localhost:3112/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...terminalAuthHeaders() },
            body: JSON.stringify({ command: INSTALL_COMMAND, projectId: projectId ?? undefined }),
        });

        if (!r.ok) {
            const text = await r.text().catch(() => '');
            return NextResponse.json(
                { error: `Terminal server returned ${r.status}`, detail: text || undefined },
                { status: 502 },
            );
        }

        return NextResponse.json({ success: true, command: INSTALL_COMMAND });
    } catch (err) {
        console.error('[ADHDev] POST /api/install-claude error:', err);
        return NextResponse.json(
            { error: 'Terminal server unreachable. Open the terminal pane and run the command manually.', command: INSTALL_COMMAND },
            { status: 502 },
        );
    }
}
