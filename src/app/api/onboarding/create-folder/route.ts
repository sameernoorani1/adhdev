import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// AD-166: spin up a fresh project folder for the onboarding wizard.
// Body: { parent: absolute path, name: folder name }
// Side effects (in order):
//   1. mkdir -p parent/name
//   2. git init (best-effort — we swallow the error if git isn't installed,
//      because the wizard's git step can run later)
//   3. write a starter README.md so the folder isn't empty
// Returns: { folderPath: absolute path, gitInitialized: boolean }

const DISALLOWED_NAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;

function isSafeFolderName(name: string): boolean {
    if (!name || name.trim().length === 0) return false;
    if (name === '.' || name === '..') return false;
    if (DISALLOWED_NAME_CHARS.test(name)) return false;
    return true;
}

function tryGitInit(folderPath: string): boolean {
    try {
        execSync('git init', { cwd: folderPath, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const parent = String(body.parent || '').trim();
        const name = String(body.name || '').trim();

        if (!parent || !path.isAbsolute(parent)) {
            return NextResponse.json({ error: 'parent must be an absolute path' }, { status: 400 });
        }
        if (!isSafeFolderName(name)) {
            return NextResponse.json({ error: 'invalid folder name' }, { status: 400 });
        }
        if (!fs.existsSync(parent)) {
            return NextResponse.json({ error: `parent folder does not exist: ${parent}` }, { status: 404 });
        }
        const stat = fs.statSync(parent);
        if (!stat.isDirectory()) {
            return NextResponse.json({ error: `parent is not a directory: ${parent}` }, { status: 400 });
        }

        const folderPath = path.join(parent, name);
        if (fs.existsSync(folderPath)) {
            return NextResponse.json({ error: `folder already exists: ${folderPath}` }, { status: 409 });
        }

        fs.mkdirSync(folderPath, { recursive: true });

        const gitInitialized = tryGitInit(folderPath);

        const readme = [
            `# ${name}`,
            '',
            'Created by the ADHDev onboarding wizard.',
            '',
            'Add a TODO.md, TASKS.md or BACKLOG.md file to seed your board with existing work,',
            'or just start typing tickets directly into ADHDev.',
            '',
        ].join('\n');
        fs.writeFileSync(path.join(folderPath, 'README.md'), readme, 'utf-8');

        return NextResponse.json({ folderPath, gitInitialized });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
