import { describe, expect, it } from 'vitest';
import {
    closeRunsForTicket,
    createRunRecord,
    getActiveRunTicketIds,
    heartbeatActiveRuns,
    markRunDispatched,
    markRunFailed,
    markRunSubmitted,
    markRunTerminal,
    sweepStaleRuns,
    upsertRun,
    RUN_DISPATCH_STALE_MS,
    RUN_HEARTBEAT_STALE_MS,
    RUN_AGENT_CLAIM_STALE_MS,
} from '@/lib/feedback/runs';
import type { FeedbackData } from '@/lib/feedback/core';

function makeData(): FeedbackData {
    return {
        nextId: 1,
        columns: {},
        tickets: [],
        missions: [],
        batches: [],
        sessionActivity: [],
        activeRuns: [],
        executionContract: { version: 1, rules: [] } as unknown as FeedbackData['executionContract'],
    };
}

describe('run lifecycle helpers', () => {
    it('creates a dispatching run and exposes its ticket ids as active', () => {
        const data = makeData();
        const run = createRunRecord({
            runId: 'run-1',
            projectId: 'proj-1',
            ticketIds: ['ad-269', 'AD-140'],
            agent: 'Claude Code',
            nowIso: '2026-05-07T20:00:00.000Z',
            startedRef: 'abc123',
        });

        upsertRun(data, run);

        expect(data.activeRuns?.[0]).toMatchObject({
            runId: 'run-1',
            status: 'dispatching',
            ticketIds: ['AD-269', 'AD-140'],
            startedRef: 'abc123',
        });
        expect(getActiveRunTicketIds(data).sort()).toEqual(['AD-140', 'AD-269']);
    });

    it('marks dispatch success as running and heartbeats the lease', () => {
        const data = makeData();
        upsertRun(data, createRunRecord({
            runId: 'run-1',
            ticketIds: ['AD-269'],
            agent: 'Claude Code',
            nowIso: '2026-05-07T20:00:00.000Z',
        }));

        expect(markRunDispatched(data, 'run-1', '2026-05-07T20:00:05.000Z', 'session-1')).toBe(true);
        expect(heartbeatActiveRuns(data, ['ad-269'], '2026-05-07T20:00:10.000Z')).toBe(true);

        expect(data.activeRuns?.[0]).toMatchObject({
            status: 'running',
            terminalSessionId: 'session-1',
            lastHeartbeatAt: '2026-05-07T20:00:10.000Z',
        });
    });

    it('marks terminal submit as a live run immediately', () => {
        const data = makeData();
        upsertRun(data, createRunRecord({
            runId: 'run-1',
            ticketIds: ['AD-269'],
            agent: 'Claude Code',
            nowIso: '2026-05-07T20:00:00.000Z',
        }));

        expect(markRunSubmitted(data, 'run-1', '2026-05-07T20:00:05.000Z', 'session-1')).toBe(true);

        expect(data.activeRuns?.[0]).toMatchObject({
            status: 'running',
            terminalSessionId: 'session-1',
            dispatchResult: 'sent',
            lastHeartbeatAt: '2026-05-07T20:00:05.000Z',
        });
    });

    it('dispatch failure is terminal and no longer active', () => {
        const data = makeData();
        upsertRun(data, createRunRecord({
            runId: 'run-1',
            ticketIds: ['AD-269'],
            agent: 'Claude Code',
            nowIso: '2026-05-07T20:00:00.000Z',
        }));

        expect(markRunFailed(data, 'run-1', '2026-05-07T20:00:05.000Z', 'terminal unavailable')).toBe(true);

        expect(data.activeRuns?.[0]).toMatchObject({
            status: 'failed',
            dispatchResult: 'failed',
            failure: 'terminal unavailable',
        });
        expect(getActiveRunTicketIds(data)).toEqual([]);
    });

    it('completion moves a run out of active state', () => {
        const data = makeData();
        upsertRun(data, createRunRecord({
            runId: 'run-1',
            ticketIds: ['AD-269'],
            agent: 'Claude Code',
            nowIso: '2026-05-07T20:00:00.000Z',
        }));
        markRunDispatched(data, 'run-1', '2026-05-07T20:00:01.000Z');

        expect(markRunTerminal(data, 'run-1', 'done', '2026-05-07T20:05:00.000Z')).toBe(true);

        expect(data.activeRuns?.[0].status).toBe('done');
        expect(getActiveRunTicketIds(data)).toEqual([]);
    });

    it('successful completion clears stale recovery details from the run receipt', () => {
        const data = makeData();
        upsertRun(data, {
            ...createRunRecord({
                runId: 'run-1',
                ticketIds: ['AD-270'],
                agent: 'Codex',
                nowIso: '2026-05-08T09:35:00.000Z',
            }),
            status: 'stale',
            blocker: 'Recovered: active run heartbeat expired without completion.',
            completedAt: '2026-05-08T09:37:00.000Z',
        });

        expect(markRunTerminal(data, 'run-1', 'done', '2026-05-08T09:41:00.000Z')).toBe(true);

        expect(data.activeRuns?.[0]).toMatchObject({
            status: 'done',
            blocker: null,
            failure: null,
            completedAt: '2026-05-08T09:41:00.000Z',
        });
    });

    it('stale recovery blocks expired active runs without marking success', () => {
        const data = makeData();
        upsertRun(data, createRunRecord({
            runId: 'run-1',
            ticketIds: ['AD-269'],
            agent: 'Claude Code',
            nowIso: '2026-05-07T20:00:00.000Z',
        }));
        markRunDispatched(data, 'run-1', '2026-05-07T20:00:01.000Z');

        expect(sweepStaleRuns(data, '2026-05-07T20:02:00.000Z', 30_000)).toBe(true);

        expect(data.activeRuns?.[0]).toMatchObject({
            status: 'stale',
            blocker: 'Recovered: active run heartbeat expired without completion.',
        });
    });

    it('holds an unconfirmed dispatch as "Sending" through the queue window, then stales (AD-338)', () => {
        // AD-338: a dispatched-but-unclaimed run must KEEP showing "Sending" while
        // the agent works down a multi-ticket queue (not vanish after 20s), then
        // self-expire if no claim ever confirms it. Times are relative to the
        // dispatch window constant so this tracks any future tuning.
        const data = makeData();
        const start = '2026-05-07T20:00:00.000Z';
        upsertRun(data, createRunRecord({
            runId: 'run-1',
            ticketIds: ['AD-269'],
            agent: 'Claude Code',
            nowIso: start,
        }));
        const startMs = new Date(start).getTime();
        const within = new Date(startMs + RUN_DISPATCH_STALE_MS - 1000).toISOString();
        const past = new Date(startMs + RUN_DISPATCH_STALE_MS + 1000).toISOString();

        // Within the window: still 'dispatching' — the card keeps showing "Sending".
        expect(sweepStaleRuns(data, within)).toBe(false);
        expect(data.activeRuns?.[0].status).toBe('dispatching');

        // Past the window: a never-claimed dispatch self-expires.
        expect(sweepStaleRuns(data, past)).toBe(true);
        expect(data.activeRuns?.[0]).toMatchObject({
            status: 'stale',
            blocker: 'Recovered: prompt was sent but no active agent confirmed the run.',
        });
    });

    it('lets explicit direct-agent claims stay live longer than terminal heartbeat runs', () => {
        // The claim window must outlast the ordinary heartbeat window, so a
        // direct agent that goes briefly quiet isn't swept like a Run lease.
        expect(RUN_AGENT_CLAIM_STALE_MS).toBeGreaterThan(RUN_HEARTBEAT_STALE_MS);

        const baseMs = new Date('2026-05-07T20:00:00.000Z').getTime();
        const at = (offsetMs: number) => new Date(baseMs + offsetMs).toISOString();
        const data = makeData();
        upsertRun(data, {
            ...createRunRecord({
                runId: 'run-direct',
                ticketIds: ['AD-221'],
                agent: 'Codex',
                nowIso: at(0),
                source: 'agent-claim',
            }),
            status: 'running',
            lastHeartbeatAt: at(0),
        });

        // Past the heartbeat window but inside the claim window: still live.
        expect(sweepStaleRuns(data, at(RUN_HEARTBEAT_STALE_MS + 60_000))).toBe(false);
        // Past the claim window: swept stale.
        expect(sweepStaleRuns(data, at(RUN_AGENT_CLAIM_STALE_MS + 60_000))).toBe(true);
        expect(data.activeRuns?.[0]).toMatchObject({
            status: 'stale',
            blocker: 'Recovered: direct agent claim exceeded the max live-run window without completion.',
        });
    });
});

describe('closeRunsForTicket (AD-341)', () => {
    const liveRun = (runId: string, ticketIds: string[]) => ({
        ...createRunRecord({ runId, ticketIds, agent: 'Claude Code', nowIso: '2026-06-05T00:00:00.000Z', source: 'ui-run' }),
        status: 'running' as const,
    });

    it('closes a single-ticket lease by ticket id (case-insensitive)', () => {
        const data = makeData();
        upsertRun(data, liveRun('run-1', ['AD-342']));
        expect(closeRunsForTicket(data, 'ad-342', 'done', '2026-06-05T00:01:00.000Z')).toBe(true);
        expect(data.activeRuns?.[0]).toMatchObject({ status: 'done', ticketIds: [] });
    });

    it('multi-ticket batch: drops only the named ticket, keeps the lease running', () => {
        const data = makeData();
        upsertRun(data, liveRun('run-batch', ['AD-1', 'AD-2', 'AD-3']));
        expect(closeRunsForTicket(data, 'AD-2', 'done', '2026-06-05T00:01:00.000Z')).toBe(true);
        expect(data.activeRuns?.[0].status).toBe('running');
        expect(data.activeRuns?.[0].ticketIds).toEqual(['AD-1', 'AD-3']);
    });

    it('returns false when no active lease covers the ticket', () => {
        const data = makeData();
        upsertRun(data, liveRun('run-x', ['AD-9']));
        expect(closeRunsForTicket(data, 'AD-404', 'done', '2026-06-05T00:01:00.000Z')).toBe(false);
        expect(data.activeRuns?.[0].status).toBe('running');
    });

    it('ignores already-terminal leases', () => {
        const data = makeData();
        upsertRun(data, { ...liveRun('run-done', ['AD-5']), status: 'done' as const });
        expect(closeRunsForTicket(data, 'AD-5', 'done', '2026-06-05T00:01:00.000Z')).toBe(false);
    });
});
