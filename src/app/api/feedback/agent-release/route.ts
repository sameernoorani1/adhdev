import { NextRequest, NextResponse } from 'next/server';
import { readFeedback, resolveTicketById, writeFeedback, withFeedbackLock, checkAdmin } from '@/lib/feedback/core';
import { closeRunsForTicket } from '@/lib/feedback/runs';

function getProjectId(request: NextRequest): string | null {
    return request.headers.get('x-adhdev-project');
}

/**
 * POST /api/feedback/agent-release
 *
 * The explicit "I'm done working this ticket" callback — the PRIMARY, instant
 * close signal for the running indicator (AD-341). Mirrors agent-claim.
 *
 * Closes any open run lease covering the ticket and drops the in-progress
 * execution pill, REGARDLESS of whether the ticket reached `done`. That is the
 * whole point: a no-code / handshake ticket the agent leaves in `todo` still
 * stops animating the moment the agent says it's finished, instead of haunting
 * the board until the slow stale sweep.
 *
 * This is layer 1 of a defense-in-depth close (Sameer's design):
 *   1. explicit agent-release callback (instant, here)
 *   2. terminal turn-end detection (output quiet + no tool running) — fallback
 *   3. activity-timeout stale sweep — final backstop
 * We never DEPEND on the agent calling this; we use it when it does and degrade
 * gracefully when it doesn't.
 */
export async function POST(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const body = await request.json().catch(() => ({}));
        const ticketId = body.ticketId;
        const result: 'done' | 'blocked' = body.result === 'blocked' ? 'blocked' : 'done';

        if (!ticketId) {
            return NextResponse.json(
                { error: 'Required: { ticketId: string, result?: "done" | "blocked" }' },
                { status: 400 },
            );
        }

        const projectId = getProjectId(request);
        return await withFeedbackLock(projectId, async () => {
            const data = readFeedback(projectId);
            const resolved = resolveTicketById(data, ticketId);
            if (!resolved.ok) {
                return NextResponse.json({ error: resolved.error }, { status: resolved.status });
            }

            const index = resolved.index!;
            const ticket = resolved.ticket!;
            const now = new Date().toISOString();

            // Close the run lease(s) covering this ticket.
            let changed = closeRunsForTicket(data, ticket.id, result, now,
                result === 'blocked' ? 'Released by agent (blocked).' : null);

            // Drop the in-progress execution pill so the fallback execution-based
            // animation also clears. Ticket STATUS is left untouched — releasing a
            // run is not the same as marking the ticket done; the agent may leave
            // it in todo for review.
            const exec = ticket.execution;
            if (exec && exec.status === 'in_progress') {
                ticket.execution = {
                    ...exec,
                    status: result === 'blocked' ? 'blocked' : 'done',
                    completedAt: now,
                    updatedAt: now,
                };
                changed = true;
            }

            if (changed) {
                ticket.updatedAt = now;
                data.tickets[index] = ticket;
                writeFeedback(data, projectId);
            }

            return NextResponse.json({ released: true, ticketId: ticket.id, result, changed });
        });
    } catch (err) {
        console.error('[ADHDev] POST /api/feedback/agent-release error:', err);
        return NextResponse.json({ error: 'Failed to release ticket' }, { status: 500 });
    }
}
