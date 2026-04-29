import { NextRequest, NextResponse } from 'next/server';
import { readFeedback, writeFeedback } from '@/lib/feedback/core';

const TERMINAL_URL = 'http://localhost:3112';

// AD-154: Next.js-side heartbeat. The terminal server on local dev machines
// hasn't been restarted with the heartbeat code, so live runs have nothing
// bumping execution.updatedAt and the 45 s client freshness backstop hides
// the indicator after a minute. This route runs INSIDE Next.js (hot-reloaded
// on every file change), so we can piggy-back on the 2 s poll the client
// already makes and bump updatedAt for any ticket the terminal server is
// actively capturing. Debounced by ticket so we don't write on every poll.
const lastBumpMs = new Map<string, number>();
const HEARTBEAT_DEBOUNCE_MS = 5_000;

function bumpCaptureTickets(projectId: string | null, ticketIds: string[]): void {
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
        const data = readFeedback(projectId);
        const nowIso = new Date(now).toISOString();
        const idSet = new Set(toBump.map(id => String(id).toUpperCase()));
        let changed = false;
        for (const ticket of data.tickets) {
            if (!idSet.has(String(ticket.id || '').toUpperCase())) continue;
            const prior = ticket.execution;
            // Respect explicit agent completion — heartbeat doesn't resurrect.
            if (prior?.status === 'done' || prior?.status === 'blocked') continue;
            ticket.execution = {
                runId: (prior?.runId) || `exec-${Date.now().toString(36)}`,
                actor: (prior?.actor) || 'Coding Agent',
                actorType: 'ai',
                status: 'in_progress',
                startedAt: prior?.startedAt || nowIso,
                updatedAt: nowIso,
                completedAt: null,
                plan: (prior?.plan) || '',
                summary: (prior?.summary) || '',
                filesTouched: Array.isArray(prior?.filesTouched) ? prior!.filesTouched : [],
                verification: Array.isArray(prior?.verification) ? prior!.verification : [],
                blocker: null,
            };
            ticket.updatedAt = nowIso;
            changed = true;
        }
        if (changed) writeFeedback(data, projectId);
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
            bumpCaptureTickets(projectId, Array.isArray(data.captureTicketIds) ? data.captureTicketIds : []);
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
    } catch {
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
