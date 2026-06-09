import { NextRequest, NextResponse } from 'next/server';
import { getActiveProject, getProjectById } from '@/lib/feedback/registry';
import fs from 'fs';
import path from 'path';

// AD-136/137: UI-accessible read/write for the project's .adhdev/config.json
// onboarding state + events. Scoped strictly to onboarding fields so the rest
// of the config file stays untouched on write.

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
    if (!p) return NextResponse.json({ onboardingState: {}, onboardingEvents: {}, seeded: false });
    const cfg = readConfig(p);
    return NextResponse.json({
        onboardingState: cfg.onboardingState || {},
        onboardingEvents: cfg.onboardingEvents || {},
        seeded: cfg.seeded ?? false,
        projectId: cfg.projectId || null,
        prefix: cfg.prefix || null,
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
        const currentState = (cfg.onboardingState as Record<string, unknown>) || {};
        const incoming = (body.onboardingState as Record<string, unknown>) || {};
        // Merge coach mark flags by default so a single coach-mark PATCH doesn't
        // clobber the others. Pass `coachMarks: null` to reset all flags (used by
        // test-reset flows).
        let mergedCoach: Record<string, unknown>;
        if (incoming.coachMarks === null) {
            mergedCoach = {};
        } else {
            mergedCoach = {
                ...(currentState.coachMarks as Record<string, unknown> || {}),
                ...(incoming.coachMarks as Record<string, unknown> || {}),
            };
        }
        const nextState = { ...currentState, ...incoming, coachMarks: mergedCoach };
        const next = { ...cfg, onboardingState: nextState };
        fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n');
        return NextResponse.json({ onboardingState: nextState });
    } catch (err) {
        console.error('[ADHDev] PATCH /api/onboarding error:', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
