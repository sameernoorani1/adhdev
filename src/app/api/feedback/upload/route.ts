import { NextRequest, NextResponse } from 'next/server';
import { checkAdmin } from '@/lib/feedback/core';
import { getActiveProject, getProjectById, getProjectUploadsDir } from '@/lib/feedback/registry';
import fs from 'fs';
import path from 'path';

function getUploadsDir(projectId?: string | null): string {
    const project = getProjectById(projectId) || getActiveProject();
    if (project) return getProjectUploadsDir(project);
    return path.join(process.cwd(), 'public', 'feedback-images');
}

// POST — upload file to local public/feedback-images/
export async function POST(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        if (file.size > 20 * 1024 * 1024) {
            return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 });
        }

        // Ensure directory exists
        const projectId = request.headers.get('x-adhdev-project');
        const uploadsDir = getUploadsDir(projectId);
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const ext = file.name.split('.').pop() || 'bin';
        const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const filePath = path.join(uploadsDir, filename);

        const buffer = Buffer.from(await file.arrayBuffer());
        fs.writeFileSync(filePath, buffer);

        const isImage = file.type.startsWith('image/');

        // AD-124: include the project id as a query param so <img src> tags
        // (which can't send custom headers) can still resolve the right uploads
        // dir when the active project differs from the board being viewed.
        const project = getProjectById(projectId) || getActiveProject();
        const url = project
            ? `/api/uploads/${filename}?project=${encodeURIComponent(project.id)}`
            : `/api/uploads/${filename}`;

        return NextResponse.json({
            url,
            filename: file.name,
            isImage,
            size: file.size,
            type: file.type,
        });
    } catch {
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
