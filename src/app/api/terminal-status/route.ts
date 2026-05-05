import { NextRequest, NextResponse } from 'next/server';
import { readFeedback, writeFeedback, withFeedbackLock } from '@/lib/feedback/core';
import { applyCaptureHeartbeat } from '@/lib/feedback/captureHeartbeat';

const TERMINAL_URL = 'http://localhost:3112';

// AD-154 / AD-244: Next.js-side heartbeat for live runs. Bumps
// execution.updatedAt for tickets the terminal server reports as capturing,
// so the client's 45 s freshness backstop keeps the indicator visible even
// when an older terminal-server build (without its own heartbeat) is still
// running. Debounced per ticket so we don't write on every 2 s poll.
//
// AD-244: heartbeat-ONLY. This path used to also CREATE a fresh
// `status: in_progress` execution if the ticket had none — which meant any
// ticket the terminal flagged as capturing (whether or not Run had been
// clicked) would flip into a false-running state on the next poll. Mirrors
// the AD-232 heartbeat-only contract from `feedback/[id]/comments/route.ts`:
// running state must come from an explicit Run (UI button → /api/run, or
// terminal-server's own `bumpExecutionForActiveTickets` on /execute with
// ticketIds). Polling never creates execution rows.
const lastBumpMs = new Map<string, number>();
const HEARTBEAT_DEBOUNCE_MS = 5_000;

async function bumpCaptureTickets(projectId: string | null, ticketIds: string[]): Promise<void> {
    if (!Array.isArray(ticketIds) || ticketIds.length === 0) return;
    const now = Date.now();
    const toBump = ticketIds.filter(id => {
        const key = `${projectId || 'default'}:${id}`;
        const prev = lastBumpMs.get(key) || 0;
        if (now - prev < HEARTBEAT_DEBOUNCE_MS) return false;
        lastBumpMs.set(key, now);
        return true;
    });
    if (toBump.length === 0) return;

    try {
        await withFeedbackLock(projectId, () => {
            const data = readFeedback(projectId);
            const nowIso = new Date(now).toISOString();
            const changed = applyCaptureHeartbeat(data, toBump, nowIso);
            if (changed) writeFeedback(data, projectId);
        });
    } catch {
        // Heartbeat is best-effort — never throw into the status response.
    }
}

/**
 * GET /api/terminal-status
 * Check terminal server status including active capture state.
 *
 * AD-141: forwards ?project=<id> to the terminal server so each board gets
 * its own run/agent state. Without a project param the terminal server falls
 * back to its most-recent session — legacy behaviour preserved.
 */
export async function GET(request: NextRequest) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const projectId = request.nextUrl.searchParams.get('project');
        const statusUrl = projectId
            ? `${TERMINAL_URL}/status?project=${encodeURIComponent(projectId)}`
            : `${TERMINAL_URL}/status`;
        const res = await fetch(statusUrl, { signal: controller.signal }).catch(() => null);
        clearTimeout(timeout);

        if (res && res.ok) {
            const data = await res.json();
            // AD-154: Next.js-side heartbeat. Bump execution.updatedAt for any
            // ticket the terminal server reports as capturing, so the client's
            // freshness backstop keeps showing the indicator even when the
            // old terminal-server code (pre-heartbeat) is still running.
            await bumpCaptureTickets(projectId, Array.isArray(data.captureTicketIds) ? data.captureTicketIds : []);
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
