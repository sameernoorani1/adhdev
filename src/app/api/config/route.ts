import { NextRequest, NextResponse } from 'next/server';
import { getActiveProject, getProjectById } from '@/lib/feedback/registry';
import { DEFAULT_USER_DISPLAY_NAME } from '@/lib/feedback/protocol';
import fs from 'fs';
import path from 'path';

// AD-011: read/write the small set of project-level config fields that the
// UI can edit safely. Today that's just `userDisplayName`. Everything else
// in `.adhdev/config.json` (onboarding state/events, prefix, agents) is
// owned by other routes or by `adhdev init`, so this route deliberately
// only touches the whitelisted fields.

const WRITABLE_FIELDS = new Set(['userDisplayName']);

function configPath(projectId?: string | null): string | null {
    const project = getProjectById(projectId) || getActiveProject();
    if (!project) return null;
    return path.join(project.path, '.adhdev', 'config.json');
}

function readConfig(p: string): Record<string, unknown> {
    if (!fs.existsSync(p)) return {};
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
}

export async function GET(request: NextRequest) {
    const p = configPath(request.headers.get('x-adhdev-project'));
    if (!p) {
        return NextResponse.json({ userDisplayName: DEFAULT_USER_DISPLAY_NAME, prefix: 'AD' });
    }
    const cfg = readConfig(p);
    const name = typeof cfg.userDisplayName === 'string' && cfg.userDisplayName.trim()
        ? cfg.userDisplayName.trim()
        : DEFAULT_USER_DISPLAY_NAME;
    return NextResponse.json({
        userDisplayName: name,
        prefix: typeof cfg.prefix === 'string' ? cfg.prefix : 'AD',
    }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest) {
    const p = configPath(request.headers.get('x-adhdev-project'));
    if (!p) return NextResponse.json({ error: 'No active project' }, { status: 404 });
    if (!fs.existsSync(path.dirname(p))) {
        return NextResponse.json({ error: '.adhdev/ not found — run `adhdev init`' }, { status: 404 });
    }
    try {
        const body = await request.json();
        const cfg = readConfig(p);

        for (const key of Object.keys(body)) {
            if (!WRITABLE_FIELDS.has(key)) continue;
            const value = body[key];
            if (key === 'userDisplayName') {
                const trimmed = typeof value === 'string' ? value.trim() : '';
                if (!trimmed) {
                    return NextResponse.json({ error: 'userDisplayName cannot be empty' }, { status: 400 });
                }
                cfg.userDisplayName = trimmed;
            }
        }

        fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
        return NextResponse.json({
            userDisplayName: cfg.userDisplayName || DEFAULT_USER_DISPLAY_NAME,
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
