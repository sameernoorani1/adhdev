import { NextRequest, NextResponse } from 'next/server';

const TERMINAL_URL = 'http://localhost:3112';

/**
 * GET /api/terminal-status
 * Check terminal server status including active capture state.
 *
 * AD-141: forwards ?project=<id> to the terminal server so each board gets
 * its own run/agent state. Without a project param the terminal server falls
 * back to its most-recent session, preserving legacy behaviour.
 */
export async function GET(request: NextRequest) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const projectId = request.nextUrl.searchParams.get('project');
        const statusUrl = projectId
            ? `${TERMINAL_URL}/status?project=${encodeURIComponent(projectId)}`
            : `${TERMINAL_URL}/status`;
        const res = await fetch(statusUrl, { signal: controller.signal }).catch(() => null);
        clearTimeout(timeout);

        if (res && res.ok) {
            const data = await res.json();
            // AD-307/AD-221: terminal-status is volatile liveness data. The
            // client consumes captureTicketIds directly for the running UI, so
            // this status poll must not write board.json. Persist only lifecycle
            // edges: run start, completion, interruption, and stale recovery.
            return NextResponse.json({
                connected: true,
                capturing: data.capturing || false,
                captureTicketId: data.captureTicketId || null,
                captureTicketIds: data.captureTicketIds || [],
                captureElapsed: data.captureElapsed || 0,
                agentActive: data.agentActive || false,
                agentName: data.agentName || null,
                agentStatus: data.agentStatus || (data.agentActive ? 'running' : 'inactive'),
                requestStatus: data.requestStatus || (data.capturing ? 'running' : 'idle'),
                requestStartedAt: data.requestStartedAt || null,
                requestUpdatedAt: data.requestUpdatedAt || null,
                lastEvent: data.lastEvent || null,
            });
        }

        return NextResponse.json({
            connected: false,
            capturing: false,
            agentActive: false,
            agentName: null,
            agentStatus: 'inactive',
            requestStatus: 'idle',
            requestStartedAt: null,
            requestUpdatedAt: null,
            lastEvent: null,
        });
    } catch (err) {
        console.error('[ADHDev] GET /api/terminal-status error:', err);
        return NextResponse.json({
            connected: false,
            capturing: false,
            agentActive: false,
            agentName: null,
            agentStatus: 'inactive',
            requestStatus: 'idle',
            requestStartedAt: null,
            requestUpdatedAt: null,
            lastEvent: null,
        });
    }
}
