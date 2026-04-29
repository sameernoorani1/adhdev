import { NextRequest, NextResponse } from 'next/server';
import { getActiveProject, getProjectById, getProjectUploadsDir, readRegistry } from '@/lib/feedback/registry';
import fs from 'fs';
import path from 'path';

const MIME: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
};

function serve(filePath: string, filename: string): NextResponse {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const buffer = fs.readFileSync(filePath);
    return new NextResponse(buffer as BodyInit, {
        headers: {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000',
        },
    });
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    const { filename } = await params;
    // AD-124: prefer header, then ?project= query (for <img> tags that can't
    // send headers), then active project.
    const headerProjectId = request.headers.get('x-adhdev-project');
    const queryProjectId = request.nextUrl.searchParams.get('project');
    const project = getProjectById(headerProjectId) || getProjectById(queryProjectId) || getActiveProject();

    if (project) {
        const filePath = path.join(getProjectUploadsDir(project), filename);
        if (fs.existsSync(filePath)) return serve(filePath, filename);
    }

    // AD-124: fallback for legacy comment images stored without a project hint —
    // scan every registered project's uploads dir. Filenames are Date.now()-based
    // + random so collisions are effectively impossible.
    const registry = readRegistry();
    for (const candidate of registry.projects) {
        if (project && candidate.id === project.id) continue;
        const p = path.join(getProjectUploadsDir(candidate), filename);
        if (fs.existsSync(p)) return serve(p, filename);
    }

    // Legacy public/feedback-images fallback (pre-registry uploads).
    const legacyPath = path.join(process.cwd(), 'public', 'feedback-images', filename);
    if (fs.existsSync(legacyPath)) return serve(legacyPath, filename);

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
