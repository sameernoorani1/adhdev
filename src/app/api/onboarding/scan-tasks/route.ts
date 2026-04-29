import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// AD-166: scan a project folder for existing task lists so the onboarding
// wizard can offer to seed the board.
//
// Conservative starter heuristics (intentional — broader scans can come later
// once the conservative pass has been validated):
//   - Files at the root or one level deep named (case-insensitive):
//     TODO.md, TASKS.md, BACKLOG.md, ROADMAP.md
//   - Inside those files, parse markdown checklist items: `- [ ] some text`
//     (also `* [ ]` and `+ [ ]`). One ticket per checklist item.
//   - Cap at 50 candidates total to avoid drowning a fresh board.
//
// Body: { folderPath: absolute path }
// Returns: { candidates: Array<{ title: string, source: string }>, scanned: number, files: string[] }

const TASK_FILE_BASENAMES = new Set(['todo.md', 'tasks.md', 'backlog.md', 'roadmap.md']);
const CHECKLIST_RE = /^\s*[-*+]\s\[\s\]\s+(.+?)\s*$/;
const MAX_CANDIDATES = 50;
// AD-166: walk the folder root and its immediate subfolders. Anything deeper
// is almost always vendored noise (node_modules, .git, dist) and a deep scan
// pretty much guarantees blow-past on the 50-ticket cap.
const SCAN_DEPTH = 1;

function shouldDescend(name: string): boolean {
    if (name.startsWith('.')) return false;
    if (name === 'node_modules') return false;
    if (name === 'dist' || name === 'build' || name === 'out') return false;
    if (name === 'vendor') return false;
    return true;
}

function findTaskFiles(folderPath: string): string[] {
    const found: string[] = [];

    function walk(dir: string, depth: number) {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (depth < SCAN_DEPTH && shouldDescend(entry.name)) {
                    walk(full, depth + 1);
                }
            } else if (entry.isFile() && TASK_FILE_BASENAMES.has(entry.name.toLowerCase())) {
                found.push(full);
            }
        }
    }

    walk(folderPath, 0);
    return found;
}

interface Candidate { title: string; source: string }

function extractCandidates(filePath: string, folderPath: string): Candidate[] {
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return [];
    }
    const out: Candidate[] = [];
    const relSource = path.relative(folderPath, filePath).replace(/\\/g, '/');
    for (const line of raw.split(/\r?\n/)) {
        const m = line.match(CHECKLIST_RE);
        if (m) {
            const title = m[1].trim();
            if (title.length > 0 && title.length <= 200) {
                out.push({ title, source: relSource });
            }
        }
    }
    return out;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const folderPath = String(body.folderPath || '').trim();

        if (!folderPath || !path.isAbsolute(folderPath)) {
            return NextResponse.json({ error: 'folderPath must be an absolute path' }, { status: 400 });
        }
        if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
            return NextResponse.json({ error: `folder not found or not a directory: ${folderPath}` }, { status: 404 });
        }

        const taskFiles = findTaskFiles(folderPath);
        const candidates: Candidate[] = [];
        for (const file of taskFiles) {
            for (const c of extractCandidates(file, folderPath)) {
                if (candidates.length >= MAX_CANDIDATES) break;
                candidates.push(c);
            }
            if (candidates.length >= MAX_CANDIDATES) break;
        }

        return NextResponse.json({
            candidates,
            scanned: taskFiles.length,
            files: taskFiles.map(f => path.relative(folderPath, f).replace(/\\/g, '/')),
            cappedAt: MAX_CANDIDATES,
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
