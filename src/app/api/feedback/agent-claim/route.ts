import { NextRequest, NextResponse } from 'next/server';
import { readFeedback, resolveTicketById, writeFeedback, withFeedbackLock, checkAdmin, getDefaultAgentRules } from '@/lib/feedback/core';

function getProjectId(request: NextRequest): string | null {
    return request.headers.get('x-adhdev-project');
}

/**
 * POST /api/feedback/agent-claim
 *
 * Hard gate: AI agents MUST call this before working on a ticket.
 * This endpoint:
 *   1. Validates the ticket exists and is workable
 *   2. Auto-creates an AI comment ("Claiming ticket — [plan]")
 *   3. Logs activity
 *   4. Returns the full ticket data
 *
 * If an agent tries to PATCH a ticket to "done" without having an AI comment,
 * the transition validator will return 403. This endpoint is the blessed way
 * to satisfy that requirement in one call.
 *
 * Request body:
 *   { ticketId: string, agent: string, plan: string }
 *
 * Response:
 *   200 — { ticket, rules, statusInstruction }
 *   400 — missing fields
 *   403 — ticket not workable (wrong status, not AI-addressable)
 *   404 — ticket not found
 */
export async function POST(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const body = await request.json();
        const { ticketId, agent, plan } = body;

        if (!ticketId || !agent) {
            return NextResponse.json(
                { error: 'Required: { ticketId: string, agent: string, plan?: string }' },
                { status: 400 },
            );
        }

        const projectId = getProjectId(request);
        return await withFeedbackLock(projectId, async () => {
        const data = readFeedback(projectId);
        const rules = data.agentRules || getDefaultAgentRules();
        const resolved = resolveTicketById(data, ticketId);
        if (!resolved.ok) {
            return NextResponse.json(
                { error: resolved.error },
                { status: resolved.status },
            );
        }

        const index = resolved.index!;
        const ticket = resolved.ticket!;

        // Validate ticket is workable
        if (!ticket.aiAddressable) {
            return NextResponse.json(
                { error: `Ticket ${ticketId} is not AI-addressable. Set aiAddressable=true first.` },
                { status: 403 },
            );
        }

        const workableStatuses = ['backlog', 'todo', 'reopen'];
        if (!workableStatuses.includes(ticket.status)) {
            return NextResponse.json(
                { error: `Ticket ${ticketId} has status "${ticket.status}" — only ${workableStatuses.join(', ')} tickets can be claimed.` },
                { status: 403 },
            );
        }

        // Check for stale re-claim: if this agent already has the most recent comment, warn
        const lastComment = ticket.comments.length > 0 ? ticket.comments[ticket.comments.length - 1] : null;
        if (lastComment && lastComment.authorType === 'ai' && lastComment.author === agent) {
            return NextResponse.json(
                {
                    error: `Your last comment on ${ticketId} is still the most recent. Wait for human response before re-claiming. If you need to update your comment, use POST /api/feedback/${ticketId}/comments.`,
                    stale: true,
                },
                { status: 409 },
            );
        }

        // Auto-create claim comment
        const now = new Date().toISOString();
        const commentContent = plan
            ? `**Claiming ticket.** ${plan}`
            : `**Claiming ticket.** Will analyze and fix.`;

        const comment = {
            id: `c-${Date.now().toString(36)}`,
            author: agent,
            authorType: 'ai' as const,
            content: commentContent,
            images: [] as { url: string; filename: string }[],
            createdAt: now,
        };

        ticket.comments.push(comment);

        // AD-247: heartbeat-ONLY. agent-claim was the third remaining creator
        // of in_progress executions after the AD-232 / AD-244 fixes. It used
        // to flip the ticket to running on every claim — but Sameer's spec
        // is that Running comes from the UI Run button alone. If the ticket
        // already has an in_progress execution, refresh the heartbeat (and
        // capture the agent's plan if provided) so the indicator stays alive
        // while the agent works. Otherwise leave execution untouched —
        // claim is just a comment + activity entry.
        const priorExec = ticket.execution;
        if (priorExec?.status === 'in_progress') {
            ticket.execution = {
                ...priorExec,
                updatedAt: now,
                plan: plan || priorExec.plan || '',
            };
        }

        // Log activity
        if (!ticket.activity) ticket.activity = [];
        ticket.activity.push({
            action: 'claimed',
            by: agent,
            byType: 'ai',
            at: now,
        });

        ticket.updatedAt = now;
        data.tickets[index] = ticket;
        writeFeedback(data, projectId);

        // Build status instruction for the agent
        const statusInstruction = rules.statusInstructions[ticket.status] || '';
        const workflowKey = ticket.ticketType || 'issue';
        const workflow = rules.workflows[workflowKey] || rules.workflows['issue'];
        const workflowInstruction = workflow?.instructions || '';

        return NextResponse.json({
            ticket,
            rules: {
                statusInstruction,
                workflowInstruction,
                commentRules: rules.global.commentRules,
            },
            claimed: true,
        });
        });
    } catch (err) {
        console.error('[ADHDev] POST /api/feedback/agent-claim error:', err);
        return NextResponse.json({ error: 'Failed to claim ticket' }, { status: 500 });
    }
}
