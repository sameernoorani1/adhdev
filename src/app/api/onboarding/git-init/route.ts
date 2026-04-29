import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// AD-166: git posture executor for the onboarding wizard. Three modes:
//   - "experiment": run `git init` if not already initialised, write a sane
//     .gitignore (.adhdev/uploads, node_modules, .next, .DS_Store, dist).
//   - "github": persist intent only — actual `gh repo create` is deferred
//     until we test-drive the wizard end-to-end.
//   - "remote": persist intent only — `git remote add` is deferred too.
//
// Body: { folderPath, posture: 'experiment'|'github'|'remote', remoteUrl?: string }
// Returns: { gitInitialized, wroteGitignore, posture, remoteUrl, deferred }

const GITIGNORE_TEMPLATE = [
    '# ADHDev — auto-generated during onboarding wizard.',
    '# Edit freely; we will not overwrite this on subsequent runs.',
    '',
    'node_modules/',
    '.next/',
    'dist/',
    'build/',
    'out/',
    '',
    '# ADHDev workspace files — keep board.json tracked, ignore the rest.',
    '.adhdev/uploads/',
    '.adhdev/terminal-history/',
    '.adhdev/.tmp/',
    '',
    '# OS noise',
    '.DS_Store',
    'Thumbs.db',
    '',
    '# Editor noise',
    '.idea/',
    '.vscode/',
    '*.swp',
    '',
].join('\n');

function isGitInitialized(folderPath: string): boolean {
    return fs.existsSync(path.join(folderPath, '.git'));
}

function tryGitInit(folderPath: string): boolean {
    try {
        execSync('git init', { cwd: folderPath, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function ensureGitignore(folderPath: string): boolean {
    const target = path.join(folderPath, '.gitignore');
    if (fs.existsSync(target)) return false;
    fs.writeFileSync(target, GITIGNORE_TEMPLATE, 'utf-8');
    return true;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const folderPath = String(body.folderPath || '').trim();
        const posture = String(body.posture || '').trim() as 'experiment' | 'github' | 'remote';
        const remoteUrl = body.remoteUrl ? String(body.remoteUrl).trim() : undefined;

        if (!folderPath || !path.isAbsolute(folderPath)) {
            return NextResponse.json({ error: 'folderPath must be an absolute path' }, { status: 400 });
        }
        if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
            return NextResponse.json({ error: `folder not found: ${folderPath}` }, { status: 404 });
        }
        if (posture !== 'experiment' && posture !== 'github' && posture !== 'remote') {
            return NextResponse.json({ error: 'posture must be one of: experiment, github, remote' }, { status: 400 });
        }

        let gitInitialized = isGitInitialized(folderPath);
        let wroteGitignore = false;
        let deferred = false;

        if (posture === 'experiment') {
            if (!gitInitialized) {
                gitInitialized = tryGitInit(folderPath);
            }
            if (gitInitialized) {
                wroteGitignore = ensureGitignore(folderPath);
            }
        } else {
            // github / remote — record intent only this run; the wizard's
            // completion writes the posture to .adhdev/config.json. The user can
            // re-run the wizard later to actually wire `gh repo create` /
            // `git remote add`.
            deferred = true;
        }

        return NextResponse.json({
            gitInitialized,
            wroteGitignore,
            posture,
            remoteUrl: remoteUrl || null,
            deferred,
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
