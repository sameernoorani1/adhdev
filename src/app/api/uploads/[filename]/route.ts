import { NextRequest, NextResponse } from 'next/server';
import { getActiveProject, getProjectById, getProjectUploadsDir, readRegistry } from '@/lib/feedback/registry';
import fs from 'fs';
import path from 'path';

// AD-226: MIME map covers three response shapes — see serve() below.
//   1. Inline-rendered (images/PDF/markdown/text) → MIME goes through as-is.
//   2. Code/structured text → falls into TEXT_PLAIN_EXTENSIONS and is served
//      as text/plain so a same-origin <script src=…> can't execute it
//      (the browser refuses non-JS MIME for scripts when nosniff is set).
//   3. Office docs and archives → served with their proper MIME plus
//      Content-Disposition: attachment so browsers force-download instead
//      of trying to render.
const MIME: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
    md: 'text/plain; charset=utf-8', txt: 'text/plain; charset=utf-8',
    // Office docs (force-download)
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Archives (force-download)
    zip: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    tgz: 'application/gzip',
    '7z': 'application/x-7z-compressed',
    rar: 'application/vnd.rar',
};

const TEXT_PLAIN_EXTENSIONS = new Set([
    'js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs',
    'py', 'go', 'rb', 'rs', 'java', 'c', 'h', 'cpp', 'hpp',
    'sh', 'bash', 'ps1', 'sql',
    'css', 'scss', 'less', 'xml',
    'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini',
    'csv', 'tsv', 'log',
]);

const ATTACHMENT_EXTENSIONS = new Set([
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'zip', 'tar', 'gz', 'tgz', '7z', 'rar',
]);

function serve(filePath: string, filename: string): NextResponse {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const buffer = fs.readFileSync(filePath);

    let contentType: string;
    if (TEXT_PLAIN_EXTENSIONS.has(ext)) {
        contentType = 'text/plain; charset=utf-8';
    } else {
        contentType = MIME[ext] || 'application/octet-stream';
    }

    const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
        'X-Content-Type-Options': 'nosniff',
    };
    if (ATTACHMENT_EXTENSIONS.has(ext)) {
        headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    }

    return new NextResponse(buffer as BodyInit, { headers });
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    const { filename } = await params;
    // AD-205: path-traversal hard gate. Reject anything where the URL-decoded
    // filename does not equal its own basename — that catches `../../etc/passwd`,
    // `..%2F..%2Fetc%2Fpasswd`, absolute paths like `/etc/passwd`, and any
    // backslash-bearing payloads. Returns 404 (not 400) so we don't leak the
    // existence of the gate to a probing attacker.
    const safeFilename = path.basename(filename);
    if (safeFilename !== filename || safeFilename.includes('\\') || safeFilename.startsWith('.')) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
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
