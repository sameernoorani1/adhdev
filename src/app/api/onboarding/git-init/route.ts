import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkAdmin } from '@/lib/feedback/core';

// AD-166 / AD-231: git posture executor for the onboarding wizard.
//
// Three modes:
//   - "experiment": run `git init` if not already initialised, write a sane
//     .gitignore (.adhdev/uploads, node_modules, .next, .DS_Store, dist).
//   - "remote": same as experiment, plus `git remote add origin <url>` (or
//     `git remote set-url origin <url>` if origin already exists). URL is
//     loosely validated; reachability is left to the user's first push.
//   - "github": deferred. The full GitHub OAuth + create-repo flow is a
//     multi-day build out of scope for this launch — the wizard surfaces a
//     "set up GitHub later" affordance (will land as a Settings panel
//     post-launch; tracked under AD-227 §6.1 in the backlog).
//
// All git invocations use array-form `spawnSync` (no `shell: true`) per
// AD-238 to dodge DEP0190 and avoid the underlying command-injection surface.
//
// Body: { folderPath, posture, remoteUrl? }
// Returns: { gitInitialized, wroteGitignore, remoteConfigured, posture, remoteUrl, deferred, error? }

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
    const r = spawnSync('git', ['init'], { cwd: folderPath, stdio: ['ignore', 'ignore', 'ignore'] });
    return r.status === 0;
}

function ensureGitignore(folderPath: string): boolean {
    const target = path.join(folderPath, '.gitignore');
    if (fs.existsSync(target)) return false;
    fs.writeFileSync(target, GITIGNORE_TEMPLATE, 'utf-8');
    return true;
}

function getOriginUrl(folderPath: string): string | null {
    const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: folderPath, stdio: ['ignore', 'pipe', 'ignore'] });
    if (r.status !== 0) return null;
    return (r.stdout || '').toString().trim() || null;
}

function setOriginUrl(folderPath: string, url: string, alreadyExists: boolean): { ok: boolean; error?: string } {
    const args = alreadyExists ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url];
    const r = spawnSync('git', args, { cwd: folderPath, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status === 0) return { ok: true };
    const stderr = (r.stderr || '').toString().trim();
    return { ok: false, error: stderr.slice(0, 250) || `git remote ${alreadyExists ? 'set-url' : 'add'} exited ${r.status}` };
}

// Loose validation — accept the common shapes (https URL, ssh, scp-style git@host:user/repo.git).
// Reject empty / obviously bogus strings; leave reachability to the user's first push.
function validateRemoteUrl(raw: string): { ok: true } | { ok: false; error: string } {
    const url = raw.trim();
    if (!url) return { ok: false, error: 'remote URL is required' };
    if (url.length > 500) return { ok: false, error: 'remote URL is too long' };
    const looksLikeUrl =
        /^https?:\/\/[^\s]+$/i.test(url) ||
        /^ssh:\/\/[^\s]+$/i.test(url) ||
        /^git@[^:\s]+:[^\s]+$/i.test(url) ||
        /^git:\/\/[^\s]+$/i.test(url);
    if (!looksLikeUrl) return { ok: false, error: 'doesn\'t look like a git URL (try https://, git@, or ssh://)' };
    return { ok: true };
}

export async function POST(request: NextRequest) {
    // AD-346: this route spawns `git` and writes files in a body-supplied folder
    // — same RCE/file-write class as install-claude / launch-agent, so it gets
    // the same gate. The edge middleware already blocks the browser CSRF vector;
    // this adds the no-Origin token check for parity with the other 3 routes.
    const auth = await checkAdmin(request);
    if (!auth.authorized) return auth.error!;
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
        let remoteConfigured = false;
        let deferred = false;

        if (posture === 'experiment' || posture === 'remote') {
            if (!gitInitialized) {
                gitInitialized = tryGitInit(folderPath);
                if (!gitInitialized) {
                    return NextResponse.json({ error: 'git init failed — is git installed?' }, { status: 500 });
                }
            }
            wroteGitignore = ensureGitignore(folderPath);
        }

        if (posture === 'remote') {
            // AD-231: actually wire the remote, instead of just recording intent.
            const validation = validateRemoteUrl(remoteUrl || '');
            if (!validation.ok) {
                return NextResponse.json({ error: validation.error }, { status: 400 });
            }
            const existing = getOriginUrl(folderPath);
            const result = setOriginUrl(folderPath, remoteUrl!, existing !== null);
            if (!result.ok) {
                return NextResponse.json({ error: result.error || 'failed to configure git remote' }, { status: 500 });
            }
            remoteConfigured = true;
        }

        if (posture === 'github') {
            // AD-231: GitHub OAuth + repo create is a multi-day build deferred
            // to a post-launch Settings panel. The wizard records the intent;
            // the user gets a clear "set this up later" affordance instead of
            // a half-implemented action that does nothing.
            deferred = true;
        }

        return NextResponse.json({
            gitInitialized,
            wroteGitignore,
            remoteConfigured,
            posture,
            remoteUrl: remoteUrl || null,
            deferred,
        });
    } catch (err) {
        console.error('[ADHDev] POST /api/onboarding/git-init error:', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
