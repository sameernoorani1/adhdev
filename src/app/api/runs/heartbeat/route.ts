import { NextRequest, NextResponse } from 'next/server';
import { readFeedbackAsync, writeFeedbackAsync, withFeedbackLock } from '@/lib/feedback/core';
import {
    autoCompleteTerminalTickets,
    markTerminalActiveRunsCleared,
    markTerminalTicketsInterrupted,
    recoverTerminalRestartState,
} from '@/lib/feedback/terminalRunState';

type TerminalRunAction =
    | 'heartbeat'
    | 'clear-active-runs'
    | 'interrupt-tickets'
    | 'auto-complete-tickets'
    | 'recover-stale';

function getProjectId(request: NextRequest, bodyProjectId: unknown): string | null {
    return typeof bodyProjectId === 'string' && bodyProjectId.trim()
        ? bodyProjectId.trim()
        : request.headers.get('x-adhdev-project');
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const action = body.action as TerminalRunAction | undefined;
        if (!action) {
            return NextResponse.json({ error: 'Required: action' }, { status: 400 });
        }

        const projectId = getProjectId(request, body.projectId);
        const ticketIds = Array.isArray(body.ticketIds)
            ? body.ticketIds.map((id: unknown) => String(id || '')).filter(Boolean)
            : [];
        const reason = typeof body.reason === 'string' ? body.reason : 'cleared';
        const nowIso = new Date().toISOString();

        if (action === 'heartbeat') {
            // AD-307/AD-221: a heartbeat tick is volatile liveness data, not a
            // durable board mutation. Persisting it wrote the full board every
            // 10s while animation was active, which jammed project switching
            // and ticket creation behind the feedback lock. The terminal
            // server's /status endpoint now supplies live captureTicketIds for
            // the UI; this endpoint remains for lifecycle edges below.
            return NextResponse.json({ ok: true, changed: false });
        }

        // Lifecycle edges still persist through async board I/O under the
        // per-project lock. High-frequency heartbeat ticks returned above.
        const changed = await withFeedbackLock(projectId, async () => {
            const data = await readFeedbackAsync(projectId);
            let didChange = false;

            if (action === 'clear-active-runs') {
                didChange = markTerminalActiveRunsCleared(data, ticketIds, reason, nowIso);
            } else if (action === 'interrupt-tickets') {
                didChange = markTerminalTicketsInterrupted(data, ticketIds, nowIso);
            } else if (action === 'auto-complete-tickets') {
                didChange = autoCompleteTerminalTickets(data, ticketIds, reason, nowIso);
            } else if (action === 'recover-stale') {
                didChange = recoverTerminalRestartState(data, nowIso);
            } else {
                return false;
            }

            if (didChange) await writeFeedbackAsync(data, projectId);
            return didChange;
        });

        return NextResponse.json({ ok: true, changed });
    } catch (err) {
        console.error('[ADHDev] POST /api/runs/heartbeat error:', err);
        return NextResponse.json({ error: 'Failed to update terminal run state' }, { status: 500 });
    }
}
