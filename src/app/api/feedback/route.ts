import { NextRequest, NextResponse } from 'next/server';
import { allocateTicketId, readFeedback, resolveTicketById, writeFeedback, checkAdmin, getDefaultAgentRules } from '@/lib/feedback/core';
import { normalizeRelations, diffRelations, applyInverse } from '@/lib/feedback/relations';
import { getDefaultExecutionContract, readUserDisplayName, DEFAULT_USER_DISPLAY_NAME } from '@/lib/feedback/protocol';
import { getActiveProject, getProjectById } from '@/lib/feedback/registry';
import { validateAgentTransition } from '@/lib/feedback/transitions';
import { recordOnboardingEvent } from '@/lib/feedback/onboardingEvents';

const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const ALLOWED_TICKET_TYPES = new Set(['normal', 'discussion', 'issue', 'idea', 'onboarding']);
// AD-193: closed tag taxonomy. Validated on POST + PATCH; freeform tags
// rejected so tags stop being treated as descriptive notes.
const ALLOWED_TAGS = new Set(['bug', 'feature', 'polish', 'perf', 'infra', 'ai']);

// Fields that can be updated via PATCH. Unknown keys are stripped before merge.
const ALLOWED_UPDATE_FIELDS = new Set([
    'status', 'priority', 'ticketType', 'title', 'description',
    'missionId', 'wave', 'session', 'aiAddressable', 'reporter',
    'tags', 'images', 'execution', 'reopenCount', 'updatedAt', 'resolvedAt',
    // AD-180: first-class ticket relations.
    'relations',
    // AD-186: source chat-message id when ticket is spawned from Brain Dump.
    'sourceMessageId',
]);

// AI agents may only modify this subset of fields.
const AI_ALLOWED_UPDATE_FIELDS = new Set([
    'status', 'execution', 'tags',
    // AD-180: AI can also wire up relations (e.g. mark sub-tasks during a run).
    'relations',
    // AD-186: AI sets this on tickets spawned from Brain Dump triage; also
    // used to backfill historical chat-spawned tickets.
    'sourceMessageId',
]);

function getProjectId(request: NextRequest): string | null {
    return request.headers.get('x-adhdev-project');
}

// AD-011: resolve the user's configured display name. Replaces the
// previously hardcoded 'Sameer' / 'sameer' literals throughout this route.
// Falls back to DEFAULT_USER_DISPLAY_NAME when no project is registered or
// the config file is missing.
function resolveDisplayName(projectId: string | null): string {
    const project = getProjectById(projectId) || getActiveProject();
    if (!project) return DEFAULT_USER_DISPLAY_NAME;
    return readUserDisplayName(project.path);
}

function normalizeTags(tags: unknown): string[] {
    if (!Array.isArray(tags)) return [];
    return Array.from(new Set(tags.map(tag => String(tag || '').trim().toLowerCase()).filter(Boolean)));
}

// AD-193: shared tag validator — POST and PATCH both call this so the
// rejection message is consistent.
function findInvalidTag(tags: unknown): string | null {
    if (!Array.isArray(tags)) return null;
    for (const raw of tags) {
        const t = String(raw || '').trim().toLowerCase();
        if (!t) continue;
        if (!ALLOWED_TAGS.has(t)) return t;
    }
    return null;
}

function validateTicketFields(data: ReturnType<typeof readFeedback>, payload: Record<string, unknown>, currentTicket?: { missionId?: string; wave?: string }) {
    const status = payload.status;
    if (status !== undefined && (typeof status !== 'string' || !data.columns[status])) {
        return `Invalid status "${String(status)}".`;
    }

    const priority = payload.priority;
    if (priority !== undefined && (typeof priority !== 'string' || !ALLOWED_PRIORITIES.has(priority))) {
        return `Invalid priority "${String(priority)}".`;
    }

    const ticketType = payload.ticketType;
    if (ticketType !== undefined && (typeof ticketType !== 'string' || !ALLOWED_TICKET_TYPES.has(ticketType))) {
        return `Invalid ticket type "${String(ticketType)}".`;
    }

    // AD-193: tag taxonomy is closed. Reject any unknown tag with a clear
    // message listing the allowed values, so callers know what to use.
    if (payload.tags !== undefined) {
        const bad = findInvalidTag(payload.tags);
        if (bad !== null) {
            return `Invalid tag "${bad}". Allowed: ${Array.from(ALLOWED_TAGS).sort().join(', ')}.`;
        }
    }

    const missionId = payload.missionId;
    if (missionId !== undefined && missionId !== '' && !(data.missions || []).some(mission => mission.id === missionId)) {
        return `Mission ${String(missionId)} not found.`;
    }

    const effectiveMissionId = missionId !== undefined ? String(missionId || '') : String(currentTicket?.missionId || '');
    const wave = payload.wave;
    if (wave !== undefined && String(wave).trim() && !effectiveMissionId) {
        return 'Wave requires a mission.';
    }

    // Type checks for other fields
    if (payload.aiAddressable !== undefined && typeof payload.aiAddressable !== 'boolean') {
        return `aiAddressable must be a boolean.`;
    }
    if (payload.title !== undefined && (typeof payload.title !== 'string' || !payload.title.trim())) {
        return `Title must be a non-empty string.`;
    }
    if (payload.description !== undefined && typeof payload.description !== 'string') {
        return `Description must be a string.`;
    }
    if (payload.reporter !== undefined && typeof payload.reporter !== 'string') {
        return `Reporter must be a string.`;
    }
    if (payload.session !== undefined && typeof payload.session !== 'string') {
        return `Session must be a string.`;
    }
    if (payload.wave !== undefined && typeof payload.wave !== 'string') {
        return `Wave must be a string.`;
    }
    if (payload.tags !== undefined && !Array.isArray(payload.tags)) {
        return `Tags must be an array.`;
    }

    return null;
}

function buildAiPlanComment(actor: string, plan?: string) {
    return {
        id: `c-${Date.now().toString(36)}`,
        author: actor,
        authorType: 'ai' as const,
        content: plan?.trim()
            ? `**Claiming ticket.** ${plan.trim()}`
            : '**Claiming ticket.** Will analyze and implement the requested change.',
        images: [] as { url: string; filename: string }[],
        createdAt: new Date().toISOString(),
    };
}

function buildAiCompletionComment(
    actor: string,
    execution: { summary?: string; filesTouched?: string[]; verification?: string[] },
) {
    const filesTouched = Array.isArray(execution.filesTouched) && execution.filesTouched.length > 0
        ? execution.filesTouched.map(file => `- ${file}`).join('\n')
        : '- No files recorded';
    const verification = Array.isArray(execution.verification) && execution.verification.length > 0
        ? execution.verification.map(item => `- ${item}`).join('\n')
        : '- No verification recorded';

    return {
        id: `c-${Date.now().toString(36)}`,
        author: actor,
        authorType: 'ai' as const,
        content: [
            '**Implementation complete.**',
            execution.summary?.trim() || 'Implemented the requested change.',
            '',
            '**Files touched**',
            filesTouched,
            '',
            '**Verification**',
            verification,
        ].join('\n'),
        images: [] as { url: string; filename: string }[],
        createdAt: new Date().toISOString(),
    };
}

// GET — return full feedback data
export async function GET(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const projectId = getProjectId(request);
        const data = readFeedback(projectId);
        // AD-138: first board view after init — write-once.
        recordOnboardingEvent('firstBoardViewAt', projectId);
        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache',
            },
        });
    } catch (err) {
        console.error('[ADHDev] GET /api/feedback error:', err);
        return NextResponse.json({ nextId: 1, columns: {}, tickets: [], error: String(err) });
    }
}

// POST — create a new ticket
export async function POST(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const body = await request.json();
        const data = readFeedback(getProjectId(request));
        const validationError = validateTicketFields(data, body);
        if (validationError) {
            return NextResponse.json({ error: validationError }, { status: 400 });
        }

        const id = allocateTicketId(data);

        const now = new Date().toISOString();
        const title = body.title || 'Untitled';
        const description = body.description || '';
        const reporter = body.reporter || resolveDisplayName(getProjectId(request)).toLowerCase();
        const createdByType = body.reporterType || body.createdByType || body.authorType || (reporter === 'system' ? 'system' : 'human');
        const tags = normalizeTags(body.tags);
        if ((createdByType === 'ai' || createdByType === 'system' || reporter === 'system') && !tags.includes('ai')) {
            tags.unshift('ai');
        }
        // AD-180 follow-up: pre-filled relations on create (e.g. spawning a
        // sub-task with `parent` set). Inverse edge gets mirrored on the
        // target ticket(s) below, same as the PATCH path.
        const newRelations = normalizeRelations(body.relations);

        const ticket = {
            id,
            title,
            contractVersion: getDefaultExecutionContract().version,
            description,
            status: body.status || 'backlog',
            priority: body.priority || 'medium',
            missionId: body.missionId || '',
            wave: body.wave || '',
            session: body.session || '',
            ticketType: body.ticketType || 'normal',
            aiAddressable: body.aiAddressable !== false,
            reporter,
            // AD-186: chat-spawned tickets carry the source message id back.
            sourceMessageId: typeof body.sourceMessageId === 'string' && body.sourceMessageId.trim()
                ? body.sourceMessageId.trim()
                : undefined,
            images: body.images || [],
            tags,
            reopenCount: 0,
            comments: [],
            activity: [
                { action: 'created', by: reporter, byType: createdByType, at: now, snapshot: { title, description } },
            ],
            createdAt: now,
            updatedAt: now,
            resolvedAt: null,
            relations: newRelations,
        };

        data.tickets.push(ticket);

        // AD-180 follow-up: mirror inverse edges on target tickets so a new
        // sub-task created with `parent: AD-152` immediately appears in
        // AD-152's children list.
        if (newRelations.length > 0) {
            const sourceId = String(ticket.id || '').toUpperCase();
            for (const rel of newRelations) {
                const targetIdx = data.tickets.findIndex(t => String(t.id || '').toUpperCase() === rel.ticketId);
                if (targetIdx < 0) continue;
                const target = data.tickets[targetIdx];
                target.relations = applyInverse(target.relations, 'add', sourceId, rel.kind);
                target.updatedAt = now;
                data.tickets[targetIdx] = target;
            }
        }

        // AD-138: first non-onboarding ticket the human actually authored.
        if (ticket.ticketType !== 'onboarding' && createdByType !== 'system' && createdByType !== 'ai') {
            recordOnboardingEvent('firstUserTicketAt', getProjectId(request));
        }

        // AD-135: onboarding ticket AD-2 ("Create your first real ticket") auto-resolves
        // when the user creates any non-onboarding, non-system ticket. Silent system
        // transition — no UI nag, just a checklist tick.
        if (ticket.ticketType !== 'onboarding' && createdByType !== 'system') {
            const seedTwo = data.tickets.find(t =>
                t.ticketType === 'onboarding' &&
                /create.*(your )?first.*real.*ticket/i.test(t.title || '') &&
                (t.status === 'todo' || t.status === 'backlog')
            );
            if (seedTwo) {
                const prev = seedTwo.status;
                seedTwo.status = 'done';
                seedTwo.updatedAt = now;
                seedTwo.resolvedAt = now;
                seedTwo.activity = [
                    ...(seedTwo.activity || []),
                    { action: 'status_changed', by: 'system', byType: 'system', at: now, from: prev, to: 'done' },
                ];
            }
        }

        writeFeedback(data, getProjectId(request));

        return NextResponse.json(ticket, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
    }
}

// PATCH — update ticket fields OR column config
export async function PATCH(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const body = await request.json();
        const projectId = getProjectId(request);
        const data = readFeedback(projectId);

        // Update batches array
        if (body.updateBatches) {
            data.batches = body.updateBatches;
            writeFeedback(data, projectId);
            return NextResponse.json({ batches: data.batches });
        }

        // Update column config
        if (body.updateColumns) {
            const { columnId, updates } = body.updateColumns;
            if (columnId && data.columns[columnId]) {
                data.columns[columnId] = { ...data.columns[columnId], ...updates };
                writeFeedback(data, projectId);
                return NextResponse.json({ columns: data.columns });
            }
            return NextResponse.json({ error: 'Column not found' }, { status: 404 });
        }

        // Update ticket
        const { id, updates } = body;
        if (!id || !updates) {
            return NextResponse.json({ error: 'Required: { id, updates }' }, { status: 400 });
        }

        const resolved = resolveTicketById(data, id);
        if (!resolved.ok) {
            return NextResponse.json({ error: resolved.error }, { status: resolved.status });
        }

        const index = resolved.index!;
        const ticket = resolved.ticket!;
        const actorType = body.actorType || 'human';

        // Strip unknown fields to prevent arbitrary field injection
        const allowedSet = actorType === 'ai' ? AI_ALLOWED_UPDATE_FIELDS : ALLOWED_UPDATE_FIELDS;
        const strippedKeys: string[] = [];
        for (const key of Object.keys(updates)) {
            if (!allowedSet.has(key)) {
                strippedKeys.push(key);
                delete updates[key];
            }
        }

        const fieldValidationError = validateTicketFields(data, updates, ticket);
        if (fieldValidationError) {
            return NextResponse.json({ error: fieldValidationError }, { status: 400 });
        }
        const actor = body.actor || updates.execution?.actor || ticket.execution?.actor || resolveDisplayName(projectId);
        const now = new Date().toISOString();
        const mergedExecution = updates.execution
            ? {
                ...(ticket.execution || {
                    runId: `exec-${Date.now().toString(36)}`,
                    actor,
                    actorType,
                    status: 'in_progress' as const,
                    startedAt: now,
                    updatedAt: now,
                    filesTouched: [],
                    verification: [],
                }),
                ...updates.execution,
                filesTouched: Array.isArray(updates.execution.filesTouched)
                    ? updates.execution.filesTouched
                    : (ticket.execution?.filesTouched || []),
                verification: Array.isArray(updates.execution.verification)
                    ? updates.execution.verification
                    : (ticket.execution?.verification || []),
                updatedAt: now,
            }
            : ticket.execution;
        const syntheticComments: typeof ticket.comments = [];
        const nextComments = [...(ticket.comments || [])];

        if (actorType === 'ai' && mergedExecution?.plan?.trim() && !ticket.comments.some(comment => comment.authorType === 'ai')) {
            const planComment = buildAiPlanComment(actor, mergedExecution.plan);
            nextComments.push(planComment);
            syntheticComments.push(planComment);
        }

        if (
            actorType === 'ai' &&
            updates.status === 'done' &&
            mergedExecution?.summary?.trim() &&
            !ticket.comments.some(comment => comment.authorType === 'ai' && comment.content.includes('**Implementation complete.**'))
        ) {
            const completionComment = buildAiCompletionComment(actor, mergedExecution);
            nextComments.push(completionComment);
            syntheticComments.push(completionComment);
        }

        // ── Agent transition enforcement ────────────────────────
        if (actorType === 'ai' && updates.status && updates.status !== ticket.status) {
            const rules = data.agentRules || getDefaultAgentRules();
            const result = validateAgentTransition(ticket, updates.status, rules, {
                ...ticket,
                ...updates,
                comments: nextComments,
                execution: mergedExecution,
            });
            if (!result.allowed) {
                return NextResponse.json(
                    { error: result.error },
                    { status: 403 },
                );
            }
        }

        // Never let updates.comments overwrite the managed comments array —
        // comments must go through POST /api/feedback/{id}/comments or synthetic generation
        delete updates.comments;

        // Auto-set timestamps
        updates.updatedAt = now;
        if (updates.status === 'done' && !ticket.resolvedAt) {
            updates.resolvedAt = now;
            // AD-138: first ticket to reach done. Skip onboarding tickets —
            // the funnel is about user-authored work, not the guided loop.
            if (ticket.ticketType !== 'onboarding') {
                recordOnboardingEvent('firstDoneAt', getProjectId(request));
            }
        }
        if (mergedExecution) {
            updates.execution = mergedExecution;
        }
        if (updates.status === 'done' && updates.execution) {
            updates.execution = {
                ...updates.execution,
                status: 'done',
                completedAt: updates.execution.completedAt || now,
                result: updates.execution.result || 'success',
                updatedAt: now,
            };
        }

        // Activity trail — log meaningful changes
        const activityEntries: { action: string; by: string; byType: string; at: string; from?: string; to?: string; snapshot?: Record<string, string> }[] = [];

        if (updates.status && updates.status !== ticket.status) {
            activityEntries.push({ action: 'status_changed', by: actor, byType: actorType, at: now, from: ticket.status, to: updates.status });
            // Increment reopenCount when moving TO reopen
            if (updates.status === 'reopen') {
                updates.reopenCount = (ticket.reopenCount ?? 0) + 1;
            }
        }
        if (updates.priority && updates.priority !== ticket.priority) {
            activityEntries.push({ action: 'priority_changed', by: actor, byType: actorType, at: now, from: ticket.priority, to: updates.priority });
        }
        if (updates.aiAddressable !== undefined && updates.aiAddressable !== ticket.aiAddressable) {
            activityEntries.push({ action: updates.aiAddressable ? 'ai_enabled' : 'ai_disabled', by: actor, byType: actorType, at: now });
        }
        // Track title/description edits with before/after snapshot
        if (updates.title && updates.title !== ticket.title) {
            activityEntries.push({ action: 'title_edited', by: actor, byType: actorType, at: now, from: ticket.title, to: updates.title });
        }
        if (updates.description !== undefined && updates.description !== ticket.description) {
            activityEntries.push({ action: 'description_edited', by: actor, byType: actorType, at: now, from: ticket.description || '(empty)', to: updates.description || '(empty)' });
        }
        if (ticket.execution?.status !== mergedExecution?.status && mergedExecution?.status) {
            const action = mergedExecution.status === 'done'
                ? 'execution_completed'
                : mergedExecution.status === 'in_progress'
                    ? 'execution_started'
                    : mergedExecution.status === 'interrupted'
                        ? 'execution_interrupted'
                        : 'execution_updated';
            activityEntries.push({ action, by: actor, byType: actorType, at: now });
        }
        // Append activity
        if (!ticket.activity) ticket.activity = [];
        ticket.activity.push(...activityEntries);
        if (syntheticComments.length > 0) {
            ticket.comments = nextComments;
        }

        data.tickets[index] = { ...ticket, ...updates };

        // AD-180: bidirectional relations bookkeeping. If `relations` was in
        // updates, mirror added/removed entries onto the inverse side of
        // each target ticket (parent↔subtask, blocks↔blocked-by, relates is
        // symmetric). `duplicate-of` has no inverse stored — readers query
        // reverse via scan. Keeps the graph consistent without forcing the
        // UI to write to both sides.
        if (Object.prototype.hasOwnProperty.call(updates, 'relations')) {
            const nextRelations = normalizeRelations(updates.relations);
            data.tickets[index].relations = nextRelations;
            const { added, removed } = diffRelations(ticket.relations, nextRelations);
            const sourceId = String(data.tickets[index].id || '').toUpperCase();
            const touchInverse = (rel: { kind: typeof added[number]['kind']; ticketId: string }, op: 'add' | 'remove') => {
                const targetIdx = data.tickets.findIndex(t => String(t.id || '').toUpperCase() === rel.ticketId);
                if (targetIdx < 0) return;
                const target = data.tickets[targetIdx];
                target.relations = applyInverse(target.relations, op, sourceId, rel.kind);
                target.updatedAt = now;
                data.tickets[targetIdx] = target;
            };
            for (const r of added) touchInverse(r, 'add');
            for (const r of removed) touchInverse(r, 'remove');
        }

        writeFeedback(data, projectId);

        return NextResponse.json(data.tickets[index]);
    } catch {
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }
}

// DELETE — remove a ticket by id
export async function DELETE(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const { id } = await request.json();
        if (!id) {
            return NextResponse.json({ error: 'Required: { id }' }, { status: 400 });
        }

        const projectId = getProjectId(request);
        const data = readFeedback(projectId);
        const resolved = resolveTicketById(data, id);
        if (!resolved.ok) {
            return NextResponse.json({ error: resolved.error }, { status: resolved.status });
        }

        data.tickets.splice(resolved.index!, 1);
        writeFeedback(data, projectId);

        return NextResponse.json({ deleted: id });
    } catch {
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
}
