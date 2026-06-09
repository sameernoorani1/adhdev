import { NextRequest, NextResponse } from 'next/server';
import { checkAdmin, readFeedback, writeFeedback, withFeedbackLock, type FeedbackMission, type MissionDecision } from '@/lib/feedback/core';
import { readUserDisplayName, DEFAULT_USER_DISPLAY_NAME } from '@/lib/feedback/protocol';
import { getActiveProject, getProjectById } from '@/lib/feedback/registry';

function getProjectId(request: NextRequest): string | null {
    return request.headers.get('x-adhdev-project');
}

// AD-297: mission writes that omit `x-adhdev-project` silently land on the
// registry's activeProjectId, which can differ from the project the user is
// viewing — Sameer reported "I asked AI to make a mission, it succeeded, but
// it doesn't show in the list." The mission was real but written to a
// different board.json. Surface where the mission actually landed so the
// caller can verify and so a future "mission vanished" complaint can be
// traced from the agent transcript.
function resolveActualProjectId(projectIdHeader: string | null): string | null {
    const project = getProjectById(projectIdHeader) || getActiveProject();
    return project?.id ?? null;
}

// AD-011: resolve user display name from project config, replacing the
// previously hardcoded 'Sameer' literal in mission decision authoring.
function resolveDisplayName(projectId: string | null): string {
    const project = getProjectById(projectId) || getActiveProject();
    if (!project) return DEFAULT_USER_DISPLAY_NAME;
    return readUserDisplayName(project.path);
}

function createMissionId(existing: FeedbackMission[]): string {
    const max = existing.reduce((highest, mission) => {
        const match = mission.id.match(/^MS-(\d+)$/i);
        return match ? Math.max(highest, Number.parseInt(match[1], 10)) : highest;
    }, 0);
    return `MS-${String(max + 1).padStart(3, '0')}`;
}

export async function GET(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    const data = readFeedback(getProjectId(request));
    return NextResponse.json(data.missions || []);
}

export async function POST(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const body = await request.json();
        const projectId = getProjectId(request);
        return await withFeedbackLock(projectId, async () => {
            const data = readFeedback(projectId);
            const now = new Date().toISOString();
            const mission: FeedbackMission = {
                id: createMissionId(data.missions || []),
                title: body.title || 'Untitled Mission',
                status: body.status || 'draft',
                summary: body.summary || '',
                goal: body.goal || '',
                context: body.context || '',
                proposedPlan: body.proposedPlan || '',
                agreedPlan: body.agreedPlan || '',
                successCriteria: body.successCriteria || '',
                notes: body.notes || '',
                createdAt: now,
                updatedAt: now,
                decisionLog: Array.isArray(body.decisionLog) ? body.decisionLog : [],
            };

            if (!Array.isArray(data.missions)) data.missions = [];
            data.missions.push(mission);
            writeFeedback(data, projectId);
            // AD-297: expose where the mission actually landed so agents can
            // verify they routed to the project the user is looking at.
            const resolvedProjectId = resolveActualProjectId(projectId);
            if (!projectId) {
                console.warn('[ADHDev] /api/missions POST omitted x-adhdev-project header — routed to', resolvedProjectId);
            }
            return NextResponse.json({ ...mission, _resolvedProjectId: resolvedProjectId }, { status: 201 });
        });
    } catch (err) {
        console.error('[ADHDev] POST /api/missions error:', err);
        return NextResponse.json({ error: 'Failed to create mission' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const { id, updates, appendDecision } = await request.json();
        if (!id) return NextResponse.json({ error: 'Required: id' }, { status: 400 });

        const projectId = getProjectId(request);
        return await withFeedbackLock(projectId, async () => {
            const data = readFeedback(projectId);
            const missions = data.missions || [];
            const index = missions.findIndex(mission => mission.id === id);
            if (index === -1) return NextResponse.json({ error: 'Mission not found' }, { status: 404 });

            const mission = missions[index];
            const now = new Date().toISOString();
            let decisionLog = mission.decisionLog || [];

            if (appendDecision?.content) {
                const decision: MissionDecision = {
                    id: `md-${Date.now().toString(36)}`,
                    content: appendDecision.content,
                    author: appendDecision.author || resolveDisplayName(projectId),
                    createdAt: now,
                };
                decisionLog = [...decisionLog, decision];
            }

            const updatedMission: FeedbackMission = {
                ...mission,
                ...(updates || {}),
                decisionLog,
                updatedAt: now,
            };

            missions[index] = updatedMission;
            data.missions = missions;
            writeFeedback(data, projectId);

            return NextResponse.json(updatedMission);
        });
    } catch (err) {
        console.error('[ADHDev] PATCH /api/missions error:', err);
        return NextResponse.json({ error: 'Failed to update mission' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const { id } = await request.json();
        if (!id) return NextResponse.json({ error: 'Required: id' }, { status: 400 });

        const projectId = getProjectId(request);
        return await withFeedbackLock(projectId, async () => {
            const data = readFeedback(projectId);
            data.missions = (data.missions || []).filter(mission => mission.id !== id);
            data.tickets = data.tickets.map(ticket => ticket.missionId === id ? { ...ticket, missionId: '' } : ticket);
            writeFeedback(data, projectId);

            return NextResponse.json({ deleted: id });
        });
    } catch (err) {
        console.error('[ADHDev] DELETE /api/missions error:', err);
        return NextResponse.json({ error: 'Failed to delete mission' }, { status: 500 });
    }
}
