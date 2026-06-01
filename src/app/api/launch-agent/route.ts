import { NextRequest, NextResponse } from 'next/server';
import { buildLaunchCommand } from '@/lib/feedback/agentCatalog';
import { terminalAuthHeaders } from '@/lib/feedback/sessionToken';

export async function POST(request: NextRequest) {
    let body: { agentId?: string; variantId?: string; customFlags?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const command = buildLaunchCommand(body.agentId || '', body.variantId || '', body.customFlags);
    if (!command) {
        return NextResponse.json({ error: 'unknown_agent_or_variant' }, { status: 400 });
    }

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
                { error: `Terminal server returned ${r.status}`, detail: text || undefined },
                { status: 502 },
            );
        }

        return NextResponse.json({ success: true, command });
    } catch (err) {
        console.error('[ADHDev] POST /api/launch-agent error:', err);
        return NextResponse.json(
            { error: 'Terminal server unreachable. Open the terminal pane and run the agent command manually.' },
            { status: 502 },
        );
    }
}
