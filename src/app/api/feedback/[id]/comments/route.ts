import { NextRequest, NextResponse } from 'next/server';
import { readFeedback, resolveTicketById, writeFeedback, withFeedbackLock, checkAdmin } from '@/lib/feedback/core';
import { addPendingMention, clearPendingMention } from '@/lib/feedback/pendingMentions';
import { readUserDisplayName, DEFAULT_USER_DISPLAY_NAME } from '@/lib/feedback/protocol';
import { getActiveProject, getProjectById } from '@/lib/feedback/registry';

// AD-011: resolve user display name from project config, replacing the
// previously hardcoded 'Sameer' literal in author/activity defaults.
function resolveDisplayName(projectId: string | null): string {
    const project = getProjectById(projectId) || getActiveProject();
    if (!project) return DEFAULT_USER_DISPLAY_NAME;
    return readUserDisplayName(project.path);
}

const AI_MENTION_REGEX = /@(?:ai|claude|codex|chatgpt)\b/g;

function normalizeMentionTarget(raw: string): string {
    const normalized = raw.replace('@', '').toLowerCase();
    if (normalized === 'ai') return 'ai';
    if (normalized === 'chatgpt') return 'chatgpt';
    if (normalized === 'codex') return 'codex';
    return 'claude';
}

function inferAgentKey(author?: string): string | null {
    const lower = (author || '').toLowerCase();
    if (lower.includes('codex') || lower.includes('openai')) return 'codex';
    if (lower.includes('chatgpt')) return 'chatgpt';
    if (lower.includes('claude') || lower.includes('anthropic')) return 'claude';
    return null;
}

function getProjectId(request: NextRequest): string | null {
    return request.headers.get('x-adhdev-project');
}

// POST — add a comment to a ticket
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const { id: ticketId } = await params;
        const body = await request.json();
        const projectId = getProjectId(request);
        return await withFeedbackLock(projectId, async () => {
            const data = readFeedback(projectId);

            const resolved = resolveTicketById(data, ticketId);
            if (!resolved.ok) {
                return NextResponse.json({ error: resolved.error }, { status: resolved.status });
            }

            const index = resolved.index!;
            const content = String(body.content || '');
            const images = Array.isArray(body.images) ? body.images : [];
            if (!content.trim() && images.length === 0) {
                return NextResponse.json({ error: 'Comment content or attachments are required.' }, { status: 400 });
            }

            const now = new Date().toISOString();
            const displayName = resolveDisplayName(projectId);
            const comment = {
                id: `c-${Date.now().toString(36)}`,
                author: body.author || displayName,
                authorType: body.authorType || 'human',
                content,
                images,
                createdAt: now,
            };

            data.tickets[index].comments.push(comment);
            data.tickets[index].updatedAt = now;
            if (!data.tickets[index].activity) data.tickets[index].activity = [];

            // AD-232: AI comments only HEARTBEAT an already-running execution
            // ON A TICKET WHOSE STATUS INDICATES ACTIVE WORK. They no longer
            // START executions, and they no longer keep stale ones alive.
            // The double guard (execution=in_progress AND ticket.status active)
            // closes the regression where an auto-claim comment landing on an
            // already-done ticket bumped updatedAt and resurrected the
            // running indicator. Sameer's call: running state must be linked
            // to UI triggers alone (Run button → /api/run / /api/run-terminal),
            // not to the existence of any AI comment.
            if (body.authorType === 'ai') {
                const t = data.tickets[index];
                const prior = t.execution as Record<string, unknown> | undefined;
                const priorStatus = prior?.status as string | undefined;
                const ticketActive = t.status === 'todo' || t.status === 'in_progress' || t.status === 'reopen';
                if (priorStatus === 'in_progress' && prior && ticketActive) {
                    // Heartbeat keep-alive — keeps the running indicator from
                    // decaying while the agent is mid-run posting comments.
                    t.execution = { ...prior, updatedAt: now } as typeof t.execution;
                }
                // Otherwise: leave execution untouched. Tickets worked via
                // direct terminal chat without first clicking Run won't show
                // running state, and stale executions on done/backlog/reopen
                // tickets won't be resurrected by an AI comment.
            }

            // Targeted AI mention detection — supports @claude, @codex, @chatgpt, and @ai
            const normalizedContent = content.toLowerCase();
            const mentionTargets: string[] = Array.from(
                new Set((normalizedContent.match(AI_MENTION_REGEX) || []).map(normalizeMentionTarget))
            );
            if (body.authorType !== 'ai' && mentionTargets.length > 0) {
                for (const targetAgent of mentionTargets) {
                    data.tickets[index].activity.push({
                        action: 'ai_mentioned',
                        by: body.author || displayName,
                        byType: 'human',
                        at: now,
                        targetAgent,
                    });
                    addPendingMention(ticketId, data.tickets[index].title, targetAgent, content, data.tickets[index].comments);
                }
                // Ensure AI addressable is on
                data.tickets[index].aiAddressable = true;
            }

            // If AI is responding to this ticket, clear any pending mention for it
            if (body.authorType === 'ai') {
                clearPendingMention(ticketId, inferAgentKey(body.author) || undefined);
            }

            writeFeedback(data, projectId);

            return NextResponse.json(comment, { status: 201 });
        });
    } catch (err) {
        console.error('[ADHDev] POST /api/feedback/[id]/comments error:', err);
        return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
    }
}

// DELETE — remove a comment from a ticket
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const { id: ticketId } = await params;
        const { commentId } = await request.json();
        if (!commentId) {
            return NextResponse.json({ error: 'Required: { commentId }' }, { status: 400 });
        }

        const projectId = getProjectId(request);
        return await withFeedbackLock(projectId, async () => {
            const data = readFeedback(projectId);
            const resolved = resolveTicketById(data, ticketId);
            if (!resolved.ok) {
                return NextResponse.json({ error: resolved.error }, { status: resolved.status });
            }

            const index = resolved.index!;

            const commentIndex = data.tickets[index].comments.findIndex((c: { id: string }) => c.id === commentId);
            if (commentIndex === -1) {
                return NextResponse.json({ error: `Comment ${commentId} not found` }, { status: 404 });
            }

            data.tickets[index].comments.splice(commentIndex, 1);
            data.tickets[index].updatedAt = new Date().toISOString();
            writeFeedback(data, projectId);

            return NextResponse.json({ deleted: commentId });
        });
    } catch (err) {
        console.error('[ADHDev] DELETE /api/feedback/[id]/comments error:', err);
        return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 });
    }
}
