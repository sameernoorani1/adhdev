import { describe, expect, it } from 'vitest';
import {
    createRunRecord,
    getActiveRunTicketIds,
    heartbeatActiveRuns,
    markRunDispatched,
    markRunFailed,
    markRunSubmitted,
    markRunTerminal,
    sweepStaleRuns,
    upsertRun,
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

    it('marks terminal submit as sent without confirming the run is working yet', () => {
        const data = makeData();
        upsertRun(data, createRunRecord({
            runId: 'run-1',
            ticketIds: ['AD-269'],
            agent: 'Claude Code',
            nowIso: '2026-05-07T20:00:00.000Z',
        }));

        expect(markRunSubmitted(data, 'run-1', '2026-05-07T20:00:05.000Z', 'session-1')).toBe(true);

        expect(data.activeRuns?.[0]).toMatchObject({
            status: 'dispatching',
            terminalSessionId: 'session-1',
            dispatchResult: 'sent',
            lastHeartbeatAt: '2026-05-07T20:00:00.000Z',
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

    it('stales unconfirmed dispatches quickly', () => {
        const data = makeData();
        upsertRun(data, createRunRecord({
            runId: 'run-1',
            ticketIds: ['AD-269'],
            agent: 'Claude Code',
            nowIso: '2026-05-07T20:00:00.000Z',
        }));
        markRunSubmitted(data, 'run-1', '2026-05-07T20:00:01.000Z');

        expect(sweepStaleRuns(data, '2026-05-07T20:00:25.000Z')).toBe(true);

        expect(data.activeRuns?.[0]).toMatchObject({
            status: 'stale',
            blocker: 'Recovered: prompt was sent but no active agent confirmed the run.',
        });
    });
});
