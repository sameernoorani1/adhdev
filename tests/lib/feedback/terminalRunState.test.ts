import { describe, expect, it } from 'vitest';
import type { FeedbackData } from '@/lib/feedback/core';
import { createRunRecord, upsertRun } from '@/lib/feedback/runs';
import {
    applyTerminalHeartbeat,
    autoCompleteTerminalTickets,
    markTerminalActiveRunsCleared,
    markTerminalTicketsInterrupted,
    recoverTerminalRestartState,
} from '@/lib/feedback/terminalRunState';

function makeData(): FeedbackData {
    return {
        nextId: 1,
        columns: {},
        tickets: [
            {
                id: 'AD-1',
                title: 'Running',
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
                createdAt: '2026-05-15T00:00:00.000Z',
                updatedAt: '2026-05-15T00:00:00.000Z',
                resolvedAt: null,
                relations: [],
                execution: {
                    runId: 'run-1',
                    actor: 'Codex',
                    actorType: 'ai',
                    status: 'in_progress',
                    startedAt: '2026-05-15T00:00:00.000Z',
                    updatedAt: '2026-05-15T00:00:00.000Z',
                    filesTouched: [],
                    verification: [],
                },
            },
            {
                id: 'AD-2',
                title: 'Idle',
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
                createdAt: '2026-05-15T00:00:00.000Z',
                updatedAt: '2026-05-15T00:00:00.000Z',
                resolvedAt: null,
                relations: [],
            },
        ],
        missions: [],
        batches: [],
        sessionActivity: [],
        activeRuns: [],
        executionContract: { version: 1, rules: [] } as unknown as FeedbackData['executionContract'],
    };
}

describe('terminal run-state mutations', () => {
    it('heartbeats active tickets and runs without creating execution rows', () => {
        const data = makeData();
        upsertRun(data, createRunRecord({
            runId: 'run-1',
            ticketIds: ['AD-1', 'AD-2'],
            agent: 'Codex',
            nowIso: '2026-05-15T00:00:00.000Z',
        }));

        expect(applyTerminalHeartbeat(data, ['AD-1', 'AD-2'], '2026-05-15T00:00:10.000Z', 'run-1')).toBe(true);

        expect(data.tickets[0].execution?.updatedAt).toBe('2026-05-15T00:00:10.000Z');
        expect(data.tickets[1].execution).toBeUndefined();
        expect(data.activeRuns?.[0]).toMatchObject({
            status: 'running',
            lastHeartbeatAt: '2026-05-15T00:00:10.000Z',
        });
    });

    it('marks interrupted tickets blocked and clears active runs as interrupted', () => {
        const data = makeData();
        upsertRun(data, createRunRecord({
            runId: 'run-1',
            ticketIds: ['AD-1'],
            agent: 'Codex',
            nowIso: '2026-05-15T00:00:00.000Z',
        }));

        expect(markTerminalTicketsInterrupted(data, ['AD-1'], '2026-05-15T00:01:00.000Z')).toBe(true);
        expect(markTerminalActiveRunsCleared(data, ['AD-1'], 'interrupted', '2026-05-15T00:01:00.000Z')).toBe(true);

        expect(data.tickets[0].execution).toMatchObject({
            status: 'blocked',
            blocker: 'Interrupted by user (Esc / Ctrl+C).',
        });
        expect(data.activeRuns?.[0].status).toBe('interrupted');
    });

    it('clears active runs for agent-idle without auto-completing tickets', () => {
        const data = makeData();
        upsertRun(data, createRunRecord({
            runId: 'run-1',
            ticketIds: ['AD-1'],
            agent: 'Codex',
            nowIso: '2026-05-15T00:00:00.000Z',
        }));

        expect(markTerminalActiveRunsCleared(data, ['AD-1'], 'agent_idle', '2026-05-15T00:01:00.000Z')).toBe(true);

        expect(data.activeRuns?.[0]).toMatchObject({
            status: 'stale',
            blocker: 'Recovered: terminal run cleared (agent_idle).',
        });
        expect(data.tickets[0].execution).toMatchObject({
            status: 'in_progress',
        });
    });

    it('auto-completes only still in-progress executions', () => {
        const data = makeData();

        expect(autoCompleteTerminalTickets(data, ['AD-1', 'AD-2'], 'timed_out', '2026-05-15T00:02:00.000Z')).toBe(true);

        expect(data.tickets[0].execution).toMatchObject({
            status: 'done',
            result: 'success',
            completedAt: '2026-05-15T00:02:00.000Z',
        });
        expect(data.tickets[1].execution).toBeUndefined();
    });

    it('AD-303: appends a system comment when a silent run auto-completes', () => {
        const data = makeData();

        autoCompleteTerminalTickets(data, ['AD-1'], 'timed_out', '2026-05-15T00:02:00.000Z');

        const comments = data.tickets[0].comments;
        expect(comments).toHaveLength(1);
        const last = comments[comments.length - 1];
        expect(last.authorType).toBe('system');
        expect(last.content).toContain('no shell output for 2 min');
        expect(last.content).toContain('terminal scrollback');
        expect(last.createdAt).toBe('2026-05-15T00:02:00.000Z');

        // Untouched ticket gets no comment.
        expect(data.tickets[1].comments).toHaveLength(0);
    });

    it('AD-303: silent-end comment falls back to the reason verbatim for unknown reasons', () => {
        const data = makeData();

        autoCompleteTerminalTickets(data, ['AD-1'], 'mystery_reason', '2026-05-15T00:02:00.000Z');

        const last = data.tickets[0].comments[0];
        expect(last.content).toContain('auto-cleared (mystery_reason)');
    });

    it('recovers restart-stale active runs and in-progress receipts', () => {
        const data = makeData();
        upsertRun(data, createRunRecord({
            runId: 'run-1',
            ticketIds: ['AD-1'],
            agent: 'Codex',
            nowIso: '2026-05-15T00:00:00.000Z',
        }));

        expect(recoverTerminalRestartState(data, '2026-05-15T00:03:00.000Z')).toBe(true);

        expect(data.activeRuns?.[0]).toMatchObject({
            status: 'stale',
            blocker: 'Terminal server restarted while run was in progress.',
        });
        expect(data.tickets[0].execution).toMatchObject({
            status: 'blocked',
            blocker: 'Terminal server restarted while run was in progress.',
        });
    });
});
