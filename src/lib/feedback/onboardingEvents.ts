// AD-138: local-only onboarding funnel instrumentation. Records write-once
// ISO timestamps for first-time events in the project's .adhdev/config.json.
// No network send — these are read back by `adhdev status` only.

import fs from 'fs';
import path from 'path';
import { getActiveProject, getProjectById, type RegisteredProject } from './registry';

export type OnboardingEventKey =
    | 'initAt'
    | 'firstBoardViewAt'
    | 'firstRunAt'
    | 'firstUserTicketAt'
    | 'firstDoneAt';

function resolveProject(projectId?: string | null): RegisteredProject | null {
    return getProjectById(projectId) || getActiveProject();
}

function configPathFor(project: RegisteredProject): string {
    return path.join(project.path, '.adhdev', 'config.json');
}

function readConfig(project: RegisteredProject): Record<string, unknown> {
    const p = configPathFor(project);
    if (!fs.existsSync(p)) return {};
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
        return {};
    }
}

function writeConfig(project: RegisteredProject, next: Record<string, unknown>): void {
    const p = configPathFor(project);
    if (!fs.existsSync(path.dirname(p))) return;
    fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n');
}

/**
 * Record an onboarding event. Write-once: if the key already exists in
 * `onboardingEvents`, the call is a no-op — the first occurrence wins.
 * Best-effort: any IO error is swallowed so telemetry can't break callers.
 */
export function recordOnboardingEvent(key: OnboardingEventKey, projectId?: string | null): void {
    try {
        const project = resolveProject(projectId);
        if (!project) return;
        const config = readConfig(project);
        const events = (config.onboardingEvents as Record<string, string>) || {};
        if (events[key]) return; // write-once
        events[key] = new Date().toISOString();
        writeConfig(project, { ...config, onboardingEvents: events });
    } catch {
        // Telemetry is best-effort. Never throw.
    }
}
