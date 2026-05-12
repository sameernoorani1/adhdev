import type { FeedbackData, FeedbackRun } from './core';

export const RUN_HEARTBEAT_STALE_MS = 90 * 1000;
export const RUN_DISPATCH_STALE_MS = 20 * 1000;

export const ACTIVE_RUN_STATUSES = new Set<FeedbackRun['status']>([
    'dispatching',
    'running',
    'finishing',
]);

export function normalizeRuns(runs: unknown): FeedbackRun[] {
    if (!Array.isArray(runs)) return [];
    return runs
        .filter((run): run is FeedbackRun => !!run && typeof run === 'object' && typeof (run as FeedbackRun).runId === 'string')
        .map(run => ({
            runId: String(run.runId),
            projectId: typeof run.projectId === 'string' ? run.projectId : null,
            ticketIds: Array.isArray(run.ticketIds) ? Array.from(new Set(run.ticketIds.map(id => String(id).toUpperCase()).filter(Boolean))) : [],
            status: isRunStatus(run.status) ? run.status : 'running',
            terminalSessionId: typeof run.terminalSessionId === 'string' ? run.terminalSessionId : null,
            agent: typeof run.agent === 'string' ? run.agent : 'Coding Agent',
            startedAt: typeof run.startedAt === 'string' ? run.startedAt : new Date().toISOString(),
            updatedAt: typeof run.updatedAt === 'string' ? run.updatedAt : new Date().toISOString(),
            lastHeartbeatAt: typeof run.lastHeartbeatAt === 'string' ? run.lastHeartbeatAt : null,
            dispatchResult: typeof run.dispatchResult === 'string' ? run.dispatchResult : null,
            completedAt: typeof run.completedAt === 'string' ? run.completedAt : null,
            failure: typeof run.failure === 'string' ? run.failure : null,
            blocker: typeof run.blocker === 'string' ? run.blocker : null,
            startedRef: typeof run.startedRef === 'string' ? run.startedRef : undefined,
        }));
}

export function createRunRecord(params: {
    runId: string;
    projectId?: string | null;
    ticketIds: string[];
    agent: string;
    nowIso: string;
    startedRef?: string;
}): FeedbackRun {
    return {
        runId: params.runId,
        projectId: params.projectId ?? null,
        ticketIds: Array.from(new Set(params.ticketIds.map(id => String(id).toUpperCase()).filter(Boolean))),
        status: 'dispatching',
        terminalSessionId: null,
        agent: params.agent,
        startedAt: params.nowIso,
        updatedAt: params.nowIso,
        lastHeartbeatAt: params.nowIso,
        dispatchResult: null,
        completedAt: null,
        failure: null,
        blocker: null,
        startedRef: params.startedRef,
    };
}

export function upsertRun(data: FeedbackData, run: FeedbackRun): void {
    if (!Array.isArray(data.activeRuns)) data.activeRuns = [];
    const index = data.activeRuns.findIndex(existing => existing.runId === run.runId);
    if (index >= 0) data.activeRuns[index] = run;
    else data.activeRuns.push(run);
}

export function markRunDispatched(data: FeedbackData, runId: string, nowIso: string, terminalSessionId?: string | null): boolean {
    const run = findRun(data, runId);
    if (!run) return false;
    run.status = 'running';
    run.updatedAt = nowIso;
    run.lastHeartbeatAt = nowIso;
    run.terminalSessionId = terminalSessionId ?? run.terminalSessionId ?? null;
    run.dispatchResult = 'sent';
    run.failure = null;
    run.blocker = null;
    return true;
}

export function markRunSubmitted(data: FeedbackData, runId: string, nowIso: string, terminalSessionId?: string | null): boolean {
    const run = findRun(data, runId);
    if (!run) return false;
    run.status = 'dispatching';
    run.updatedAt = nowIso;
    run.terminalSessionId = terminalSessionId ?? run.terminalSessionId ?? null;
    run.dispatchResult = 'sent';
    run.failure = null;
    run.blocker = null;
    return true;
}

export function markRunFailed(data: FeedbackData, runId: string, nowIso: string, failure: string): boolean {
    const run = findRun(data, runId);
    if (!run) return false;
    run.status = 'failed';
    run.updatedAt = nowIso;
    run.completedAt = nowIso;
    run.dispatchResult = 'failed';
    run.failure = failure;
    run.blocker = failure;
    return true;
}

export function markRunTerminal(
    data: FeedbackData,
    runId: string,
    status: Extract<FeedbackRun['status'], 'done' | 'blocked' | 'failed' | 'interrupted' | 'stale'>,
    nowIso: string,
    detail?: string | null,
): boolean {
    const run = findRun(data, runId);
    if (!run) return false;
    run.status = status;
    run.updatedAt = nowIso;
    run.completedAt = nowIso;
    run.lastHeartbeatAt = run.lastHeartbeatAt || nowIso;
    if (status === 'done') {
        run.failure = null;
        run.blocker = null;
    }
    if (detail) {
        if (status === 'failed') run.failure = detail;
        else run.blocker = detail;
    }
    return true;
}

export function heartbeatActiveRuns(data: FeedbackData, ticketIds: string[], nowIso: string, runId?: string | null): boolean {
    if (!Array.isArray(data.activeRuns) || data.activeRuns.length === 0) return false;
    const idSet = new Set(ticketIds.map(id => String(id).toUpperCase()));
    let changed = false;
    for (const run of data.activeRuns) {
        if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
        if (runId && run.runId !== runId) continue;
        if (!run.ticketIds.some(id => idSet.has(String(id).toUpperCase()))) continue;
        run.status = 'running';
        run.updatedAt = nowIso;
        run.lastHeartbeatAt = nowIso;
        changed = true;
    }
    return changed;
}

export function getActiveRunTicketIds(data: Pick<FeedbackData, 'activeRuns'>): string[] {
    if (!Array.isArray(data.activeRuns)) return [];
    const ids = new Set<string>();
    for (const run of data.activeRuns) {
        if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
        for (const id of run.ticketIds || []) ids.add(String(id).toUpperCase());
    }
    return Array.from(ids);
}

export function findActiveRunForTicket(data: Pick<FeedbackData, 'activeRuns'>, ticketId: string): FeedbackRun | null {
    const normalized = String(ticketId || '').toUpperCase();
    if (!normalized || !Array.isArray(data.activeRuns)) return null;
    return data.activeRuns.find(run =>
        ACTIVE_RUN_STATUSES.has(run.status) &&
        (run.ticketIds || []).some(id => String(id).toUpperCase() === normalized)
    ) || null;
}

export function sweepStaleRuns(data: FeedbackData, nowIso = new Date().toISOString(), staleMs = RUN_HEARTBEAT_STALE_MS): boolean {
    if (!Array.isArray(data.activeRuns) || data.activeRuns.length === 0) return false;
    const nowMs = new Date(nowIso).getTime();
    if (!Number.isFinite(nowMs)) return false;
    let changed = false;
    for (const run of data.activeRuns) {
        if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
        const priorStatus = run.status;
        const staleMsForRun = priorStatus === 'dispatching' ? RUN_DISPATCH_STALE_MS : staleMs;
        const heartbeatRaw = run.lastHeartbeatAt || run.updatedAt || run.startedAt;
        const heartbeatMs = new Date(heartbeatRaw).getTime();
        if (!Number.isFinite(heartbeatMs) || nowMs - heartbeatMs <= staleMsForRun) continue;
        run.status = 'stale';
        run.updatedAt = nowIso;
        run.completedAt = nowIso;
        run.blocker = run.blocker || (priorStatus === 'dispatching'
            ? 'Recovered: prompt was sent but no active agent confirmed the run.'
            : 'Recovered: active run heartbeat expired without completion.');
        changed = true;
    }
    return changed;
}

function findRun(data: FeedbackData, runId: string): FeedbackRun | null {
    if (!Array.isArray(data.activeRuns)) data.activeRuns = [];
    return data.activeRuns.find(run => run.runId === runId) || null;
}

function isRunStatus(value: unknown): value is FeedbackRun['status'] {
    return (
        value === 'dispatching' ||
        value === 'running' ||
        value === 'finishing' ||
        value === 'done' ||
        value === 'blocked' ||
        value === 'failed' ||
        value === 'interrupted' ||
        value === 'stale'
    );
}
