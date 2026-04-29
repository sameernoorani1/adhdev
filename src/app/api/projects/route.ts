import { NextRequest, NextResponse } from 'next/server';
import {
    readRegistry,
    registerProject,
    setActiveProject,
    removeProject,
    getActiveProject,
    getProjectById,
} from '@/lib/feedback/registry';

// GET — list all projects + active project
export async function GET(request: NextRequest) {
    try {
        const registry = readRegistry();
        const active = getProjectById(request.headers.get('x-adhdev-project')) || getActiveProject();
        return NextResponse.json({
            projects: registry.projects,
            activeProjectId: active?.id || null,
        });
    } catch {
        return NextResponse.json({ projects: [], activeProjectId: null });
    }
}

// POST — register a new project or switch active project
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        // Switch active project
        if (body.switchTo) {
            const project = setActiveProject(body.switchTo);
            if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
            return NextResponse.json({ active: project });
        }

        // Register new project
        if (body.path) {
            const project = registerProject(body.path, body.name, body.prefix);
            return NextResponse.json({ project }, { status: 201 });
        }

        return NextResponse.json({ error: 'Required: { path } or { switchTo }' }, { status: 400 });
    } catch {
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

// DELETE — remove a project from registry (does not delete data)
export async function DELETE(request: NextRequest) {
    try {
        const { id } = await request.json();
        if (!id) return NextResponse.json({ error: 'Required: { id }' }, { status: 400 });
        const removed = removeProject(id);
        if (!removed) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        return NextResponse.json({ removed: id });
    } catch {
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
