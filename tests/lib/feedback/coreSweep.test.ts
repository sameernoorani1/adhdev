import { describe, expect, it, vi } from 'vitest';
import type { FeedbackData, FeedbackTicket } from '@/lib/feedback/core';
import { sweepStaleExecutions } from '@/lib/feedback/core';
import { createRunRecord, upsertRun } from '@/lib/feedback/runs';

function makeTicket(): FeedbackTicket {
    return {
        id: 'AD-221',
        title: 'Running state',
        description: '',
        status: 'todo',
        priority: 'medium',
        missionId: '',
        wave: '',
        session: '',
        ticketType: 'normal',
        aiAddressable: true,
        reporter: 'sameer',
        images: [],
        tags: [],
        reopenCount: 0,
        comments: [],
        activity: [],
        createdAt: '2026-05-18T19:00:00.000Z',
        updatedAt: '2026-05-18T19:00:00.000Z',
        resolvedAt: null,
        relations: [],
        execution: {
            runId: 'run-direct',
            actor: 'Codex',
            actorType: 'ai',
            status: 'in_progress',
            startedAt: '2026-05-18T19:00:00.000Z',
            updatedAt: '2026-05-18T19:00:00.000Z',
            filesTouched: [],
            verification: [],
        },
    };
}

function makeData(): FeedbackData {
    return {
        nextId: 1,
        columns: {},
        tickets: [makeTicket()],
        missions: [],
        batches: [],
        sessionActivity: [],
        activeRuns: [],
        executionContract: { version: 1, rules: [] } as unknown as FeedbackData['executionContract'],
    };
}

describe('sweepStaleExecutions', () => {
    it('does not block stale execution receipts while an active run lease exists', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-18T19:10:00.000Z'));
        try {
            const data = makeData();
            const run = createRunRecord({
                runId: 'run-direct',
                ticketIds: ['AD-221'],
                agent: 'Codex',
                nowIso: '2026-05-18T19:00:00.000Z',
                source: 'agent-claim',
            });
            run.status = 'running';
            run.lastHeartbeatAt = '2026-05-18T19:00:00.000Z';
            upsertRun(data, run);

            expect(sweepStaleExecutions(data)).toBe(false);
            expect(data.tickets[0].execution?.status).toBe('in_progress');
            expect(data.activeRuns?.[0].status).toBe('running');
        } finally {
            vi.useRealTimers();
        }
    });

    it('blocks stale execution receipts when there is no active run lease', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-18T19:10:00.000Z'));
        try {
            const data = makeData();

            expect(sweepStaleExecutions(data)).toBe(true);
            expect(data.tickets[0].execution).toMatchObject({
                status: 'blocked',
                blocker: 'Recovered: stale in_progress without active session.',
            });
        } finally {
            vi.useRealTimers();
        }
    });
});
