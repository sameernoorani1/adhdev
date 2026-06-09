import { describe, it, expect } from 'vitest';
import { applyCaptureHeartbeat } from '@/lib/feedback/captureHeartbeat';
import type { FeedbackData, FeedbackTicket } from '@/lib/feedback/core';

// AD-244: pins the heartbeat-only contract for the terminal-status poll.
// The previous shape created `status: in_progress` executions on first sight
// of a ticket in `captureTicketIds`, which meant a freshly-created ticket
// the agent merely *mentioned* in output flipped into a false-running state
// on the next 2 s poll. The fix: heartbeat ONLY in_progress executions;
// never create. These tests guard against re-regression.

function makeData(tickets: FeedbackTicket[]): FeedbackData {
    return {
        nextId: 100,
        tickets,
        columns: [],
        batches: [],
        sessionActivity: [],
        missions: [],
        executionContract: { version: 1, rules: [] } as unknown as FeedbackData['executionContract'],
    } as unknown as FeedbackData;
}

function makeTicket(overrides: Partial<FeedbackTicket> = {}): FeedbackTicket {
    return {
        id: 'AD-001',
        title: 'T',
        description: '',
        status: 'todo',
        priority: 'medium',
        ticketType: 'normal',
        aiAddressable: true,
        reporter: 'Sameer',
        images: [],
        tags: [],
        reopenCount: 0,
        comments: [],
        activity: [],
        createdAt: '2026-04-30T00:00:00.000Z',
        updatedAt: '2026-04-30T00:00:00.000Z',
        resolvedAt: null,
        ...overrides,
    };
}

const NOW = '2026-05-05T20:00:00.000Z';

describe('applyCaptureHeartbeat', () => {
    it('does NOT create an execution on a ticket that has none', () => {
        const ticket = makeTicket({ id: 'AD-001' });
        const data = makeData([ticket]);
        const changed = applyCaptureHeartbeat(data, ['AD-001'], NOW);
        expect(changed).toBe(false);
        expect(data.tickets[0].execution).toBeUndefined();
    });

    it('does NOT create an execution when prior.status is undefined', () => {
        const ticket = makeTicket({
            id: 'AD-001',
            execution: { runId: 'exec-x', actor: 'Coding Agent', actorType: 'ai', startedAt: NOW, updatedAt: NOW, filesTouched: [], verification: [] } as unknown as FeedbackTicket['execution'],
        });
        const data = makeData([ticket]);
        const changed = applyCaptureHeartbeat(data, ['AD-001'], NOW);
        expect(changed).toBe(false);
    });

    it('does NOT resurrect a done execution', () => {
        const ticket = makeTicket({
            id: 'AD-001',
            execution: { runId: 'exec-x', actor: 'Coding Agent', actorType: 'ai', status: 'done', startedAt: NOW, updatedAt: NOW, filesTouched: [], verification: [] } as FeedbackTicket['execution'],
        });
        const data = makeData([ticket]);
        const changed = applyCaptureHeartbeat(data, ['AD-001'], NOW);
        expect(changed).toBe(false);
        expect(data.tickets[0].execution?.status).toBe('done');
    });

    it('does NOT resurrect a blocked execution', () => {
        const ticket = makeTicket({
            id: 'AD-001',
            execution: { runId: 'exec-x', actor: 'Coding Agent', actorType: 'ai', status: 'blocked', startedAt: NOW, updatedAt: NOW, filesTouched: [], verification: [] } as FeedbackTicket['execution'],
        });
        const data = makeData([ticket]);
        const changed = applyCaptureHeartbeat(data, ['AD-001'], NOW);
        expect(changed).toBe(false);
        expect(data.tickets[0].execution?.status).toBe('blocked');
    });

    it('heartbeats an in_progress execution by bumping updatedAt', () => {
        const before = '2026-05-05T19:00:00.000Z';
        const ticket = makeTicket({
            id: 'AD-001',
            execution: { runId: 'exec-x', actor: 'Coding Agent', actorType: 'ai', status: 'in_progress', startedAt: before, updatedAt: before, filesTouched: [], verification: [] } as FeedbackTicket['execution'],
        });
        const data = makeData([ticket]);
        const changed = applyCaptureHeartbeat(data, ['AD-001'], NOW);
        expect(changed).toBe(true);
        expect(data.tickets[0].execution?.updatedAt).toBe(NOW);
        expect(data.tickets[0].execution?.runId).toBe('exec-x');
        expect(data.tickets[0].execution?.startedAt).toBe(before);
    });

    it('matches ticket ids case-insensitively', () => {
        const before = '2026-05-05T19:00:00.000Z';
        const ticket = makeTicket({
            id: 'AD-001',
            execution: { runId: 'exec-x', actor: 'Coding Agent', actorType: 'ai', status: 'in_progress', startedAt: before, updatedAt: before, filesTouched: [], verification: [] } as FeedbackTicket['execution'],
        });
        const data = makeData([ticket]);
        const changed = applyCaptureHeartbeat(data, ['ad-001'], NOW);
        expect(changed).toBe(true);
    });

    it('returns false on empty input', () => {
        const data = makeData([]);
        expect(applyCaptureHeartbeat(data, [], NOW)).toBe(false);
        expect(applyCaptureHeartbeat(data, ['AD-001'], NOW)).toBe(false);
    });

    it('does not touch tickets not in the heartbeat list', () => {
        const before = '2026-05-05T19:00:00.000Z';
        const t1 = makeTicket({
            id: 'AD-001',
            execution: { runId: 'exec-1', actor: 'a', actorType: 'ai', status: 'in_progress', startedAt: before, updatedAt: before, filesTouched: [], verification: [] } as FeedbackTicket['execution'],
        });
        const t2 = makeTicket({
            id: 'AD-002',
            execution: { runId: 'exec-2', actor: 'a', actorType: 'ai', status: 'in_progress', startedAt: before, updatedAt: before, filesTouched: [], verification: [] } as FeedbackTicket['execution'],
        });
        const data = makeData([t1, t2]);
        applyCaptureHeartbeat(data, ['AD-001'], NOW);
        expect(data.tickets[0].execution?.updatedAt).toBe(NOW);
        expect(data.tickets[1].execution?.updatedAt).toBe(before);
    });
});
