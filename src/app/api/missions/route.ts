import { NextRequest, NextResponse } from 'next/server';
import { checkAdmin, readFeedback, writeFeedback, type FeedbackMission, type MissionDecision } from '@/lib/feedback/core';
import { readUserDisplayName, DEFAULT_USER_DISPLAY_NAME } from '@/lib/feedback/protocol';
import { getActiveProject, getProjectById } from '@/lib/feedback/registry';

function getProjectId(request: NextRequest): string | null {
    return request.headers.get('x-adhdev-project');
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
        return NextResponse.json(mission, { status: 201 });
    } catch {
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
    } catch {
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
        const data = readFeedback(projectId);
        data.missions = (data.missions || []).filter(mission => mission.id !== id);
        data.tickets = data.tickets.map(ticket => ticket.missionId === id ? { ...ticket, missionId: '' } : ticket);
        writeFeedback(data, projectId);

        return NextResponse.json({ deleted: id });
    } catch {
        return NextResponse.json({ error: 'Failed to delete mission' }, { status: 500 });
    }
}
