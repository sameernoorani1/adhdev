import { NextRequest, NextResponse } from 'next/server';
import { readFeedback, resolveTicketById, writeFeedback, withFeedbackLock, checkAdmin, getDefaultAgentRules } from '@/lib/feedback/core';
import { getCurrentGitSha } from '@/lib/feedback/gitDiff';
import { getActiveProject, getProjectById } from '@/lib/feedback/registry';
import { createRunRecord, upsertRun } from '@/lib/feedback/runs';

function getProjectId(request: NextRequest): string | null {
    return request.headers.get('x-adhdev-project');
}

/**
 * POST /api/feedback/agent-claim
 *
 * Hard gate: AI agents MUST call this before working on a ticket.
 * This endpoint:
 *   1. Validates the ticket exists and is workable
 *   2. Auto-creates an AI plan/claim comment
 *   3. Opens a live running-state lease for direct CLI work
 *   4. Logs activity
 *   5. Returns the full ticket data
 *
 * Passive signals like ordinary AI comments, file hooks, and terminal-status
 * polls only renew existing runs. This endpoint is the explicit direct-agent
 * start signal.
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

            if (!ticket.aiAddressable) {
                return NextResponse.json(
                    { error: `Ticket ${ticketId} is not AI-addressable. Set aiAddressable=true first.` },
                    { status: 403 },
                );
            }

            const workableStatuses = ['backlog', 'todo', 'reopen'];
            if (!workableStatuses.includes(ticket.status)) {
                return NextResponse.json(
                    { error: `Ticket ${ticketId} has status "${ticket.status}" - only ${workableStatuses.join(', ')} tickets can be claimed.` },
                    { status: 403 },
                );
            }

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

            const now = new Date().toISOString();
            const commentContent = plan
                ? `**Claiming ticket.** ${plan}`
                : '**Claiming ticket.** Will analyze and fix.';

            ticket.comments.push({
                id: `c-${Date.now().toString(36)}`,
                author: agent,
                authorType: 'ai' as const,
                content: commentContent,
                images: [] as { url: string; filename: string }[],
                createdAt: now,
            });

            const priorExec = ticket.execution;
            const runId = priorExec?.status === 'in_progress' && priorExec.runId
                ? priorExec.runId
                : `run-${Date.now().toString(36)}-${String(ticket.id).toLowerCase()}-claim`;
            const project = getProjectById(projectId) || getActiveProject();
            const startedRef = project ? (getCurrentGitSha(project.path) ?? undefined) : undefined;
            const activeRun = createRunRecord({
                runId,
                projectId,
                ticketIds: [ticket.id],
                agent,
                nowIso: now,
                startedRef: priorExec?.startedRef || startedRef,
                source: 'agent-claim',
            });
            activeRun.status = 'running';
            activeRun.dispatchResult = 'agent-claim';
            activeRun.lastHeartbeatAt = now;
            upsertRun(data, activeRun);

            if (priorExec?.status === 'in_progress') {
                ticket.execution = {
                    ...priorExec,
                    updatedAt: now,
                    plan: plan || priorExec.plan || '',
                };
            } else {
                ticket.execution = {
                    runId,
                    actor: agent,
                    actorType: 'ai',
                    status: 'in_progress',
                    startedAt: now,
                    updatedAt: now,
                    plan: plan || '',
                    filesTouched: [],
                    verification: [],
                    startedRef,
                };
            }

            if (!ticket.activity) ticket.activity = [];
            ticket.activity.push({
                action: 'claimed',
                by: agent,
                byType: 'ai',
                at: now,
            });
            ticket.activity.push({
                action: 'execution_started',
                by: agent,
                byType: 'ai',
                at: now,
            });

            ticket.updatedAt = now;
            data.tickets[index] = ticket;
            writeFeedback(data, projectId);

            const statusInstruction = rules.statusInstructions[ticket.status] || '';
            const workflowKey = ticket.ticketType || 'issue';
            const workflow = rules.workflows[workflowKey] || rules.workflows.issue;
            const workflowInstruction = workflow?.instructions || '';

            return NextResponse.json({
                ticket,
                rules: {
                    statusInstruction,
                    workflowInstruction,
                    commentRules: rules.global.commentRules,
                },
                claimed: true,
                activeRun,
            });
        });
    } catch (err) {
        console.error('[ADHDev] POST /api/feedback/agent-claim error:', err);
        return NextResponse.json({ error: 'Failed to claim ticket' }, { status: 500 });
    }
}
