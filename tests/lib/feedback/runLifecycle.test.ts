import { describe, expect, it } from 'vitest';
import type { FeedbackData, FeedbackRun } from '../../../src/lib/feedback/core';
import {
    createRunRecord,
    upsertRun,
    markRunTerminal,
    markRunSubmitted,
    heartbeatActiveRuns,
    sweepStaleRuns,
    RUN_DISPATCH_STALE_MS,
    RUN_HEARTBEAT_STALE_MS,
    RUN_AGENT_CLAIM_STALE_MS,
} from '../../../src/lib/feedback/runs';
import {
    markRunSent,
    claimRun,
    deriveRunningTicketIds,
    isTicketRunning,
} from '../../../src/lib/feedback/runLifecycle';

const T0 = '2026-06-05T00:00:00.000Z';
const at = (ms: number, base = T0) => new Date(new Date(base).getTime() + ms).toISOString();
const emptyData = (): FeedbackData => ({ nextId: 1, columns: {}, tickets: [], activeRuns: [] });

function dispatch(data: FeedbackData, runId: string, ticketIds: string[], source: FeedbackRun['source'] = 'ui-run', nowIso = T0) {
    upsertRun(data, createRunRecord({ runId, projectId: null, ticketIds, agent: 'Claude Code', nowIso, source }));
    markRunSent(data, runId, nowIso); // prompt sent into the terminal
}

describe('AD-269 run lifecycle — dispatch is NOT running (the Run-button false-positive)', () => {
    it('a dispatched-but-unclaimed run does not animate', () => {
        const d = emptyData();
        dispatch(d, 'run-1', ['AD-1']);
        expect(d.activeRuns![0].status).toBe('dispatching');
        expect(deriveRunningTicketIds(d)).toEqual([]);
        expect(isTicketRunning(d, 'AD-1')).toBe(false);
    });

    it('shows the OLD behaviour for contrast: markRunSubmitted would have lit it on send', () => {
        const d = emptyData();
        dispatch(d, 'run-1', ['AD-1']);
        markRunSubmitted(d, 'run-1', T0); // the optimistic flip we removed from the dispatch path
        expect(isTicketRunning(d, 'AD-1')).toBe(true);
    });
});

describe('AD-269 run lifecycle — a CLAIM is the only thing that starts running', () => {
    it('a claim after a UI dispatch promotes the SAME lease (no duplicate)', () => {
        const d = emptyData();
        dispatch(d, 'run-1', ['AD-1']);
        expect(isTicketRunning(d, 'AD-1')).toBe(false);
        const lease = claimRun(d, { ticketIds: ['AD-1'], agent: 'Claude Code', source: 'agent-claim', nowIso: at(2000) });
        expect(lease.runId).toBe('run-1');       // promoted, not duplicated
        expect(d.activeRuns!.length).toBe(1);
        expect(lease.status).toBe('running');
        expect(isTicketRunning(d, 'AD-1')).toBe(true);
    });

    it('a direct / external claim with no prior dispatch opens a fresh running lease', () => {
        const d = emptyData();
        const lease = claimRun(d, { ticketIds: ['AD-2'], agent: 'Codex', source: 'agent-claim', nowIso: T0, runId: 'claim-2' });
        expect(lease.status).toBe('running');
        expect(deriveRunningTicketIds(d)).toEqual(['AD-2']);
    });

    it('claim never demotes a lease back (claim raced ahead of /execute returning)', () => {
        const d = emptyData();
        dispatch(d, 'run-8', ['AD-8']);                                                   // dispatching
        claimRun(d, { ticketIds: ['AD-8'], agent: 'x', source: 'agent-claim', nowIso: at(500) }); // promoted → running
        markRunSent(d, 'run-8', at(1000));                                                 // /execute returns late
        expect(d.activeRuns![0].status).toBe('running');                                   // not demoted to dispatching
        expect(isTicketRunning(d, 'AD-8')).toBe(true);
    });
});

describe('AD-269 run lifecycle — elegant close', () => {
    const start = (source: FeedbackRun['source'] = 'ui-run') => {
        const d = emptyData();
        claimRun(d, { ticketIds: ['AD-3'], agent: 'x', source, nowIso: T0, runId: 'r3' });
        expect(isTicketRunning(d, 'AD-3')).toBe(true);
        return d;
    };

    it('completion (done) closes it', () => {
        const d = start();
        markRunTerminal(d, 'r3', 'done', at(5000));
        expect(isTicketRunning(d, 'AD-3')).toBe(false);
    });
    it('blocked closes it', () => {
        const d = start();
        markRunTerminal(d, 'r3', 'blocked', at(5000), 'blocked by agent');
        expect(isTicketRunning(d, 'AD-3')).toBe(false);
    });
    it('interrupt (Ctrl+C) closes it', () => {
        const d = start();
        markRunTerminal(d, 'r3', 'interrupted', at(5000));
        expect(isTicketRunning(d, 'AD-3')).toBe(false);
    });
});

describe('AD-269 run lifecycle — breakage handling (crash / never-claimed / staleness)', () => {
    it('a dispatched run that is never claimed self-expires — no lingering false running', () => {
        const d = emptyData();
        dispatch(d, 'run-5', ['AD-5']);
        expect(isTicketRunning(d, 'AD-5')).toBe(false);                 // never animated
        sweepStaleRuns(d, at(RUN_DISPATCH_STALE_MS + 1000), RUN_HEARTBEAT_STALE_MS);
        expect(d.activeRuns![0].status).toBe('stale');
        expect(isTicketRunning(d, 'AD-5')).toBe(false);
    });

    it('a running lease whose agent crashed (heartbeat lost) goes stale and stops animating', () => {
        const d = emptyData();
        claimRun(d, { ticketIds: ['AD-6'], agent: 'x', source: 'ui-run', nowIso: T0, runId: 'r6' });
        expect(isTicketRunning(d, 'AD-6')).toBe(true);
        sweepStaleRuns(d, at(RUN_HEARTBEAT_STALE_MS + 1000));
        expect(d.activeRuns![0].status).toBe('stale');
        expect(isTicketRunning(d, 'AD-6')).toBe(false);
    });

    it('a heartbeat keeps a running lease alive across the stale window', () => {
        const d = emptyData();
        claimRun(d, { ticketIds: ['AD-13'], agent: 'x', source: 'ui-run', nowIso: T0, runId: 'r13' });
        heartbeatActiveRuns(d, ['AD-13'], at(RUN_HEARTBEAT_STALE_MS - 1000), 'r13'); // fresh beat before it would expire
        sweepStaleRuns(d, at(RUN_HEARTBEAT_STALE_MS + 1000));                         // would be stale from T0, but beat moved it
        expect(isTicketRunning(d, 'AD-13')).toBe(true);
    });

    it('external (agent-claim) runs hold past the embedded window but eventually time out', () => {
        const d = emptyData();
        claimRun(d, { ticketIds: ['AD-7'], agent: 'x', source: 'agent-claim', nowIso: T0, runId: 'r7' });
        sweepStaleRuns(d, at(RUN_HEARTBEAT_STALE_MS + 1000));    // 90s — still within the 60-min external window
        expect(isTicketRunning(d, 'AD-7')).toBe(true);
        sweepStaleRuns(d, at(RUN_AGENT_CLAIM_STALE_MS + 1000));
        expect(isTicketRunning(d, 'AD-7')).toBe(false);
    });
});

describe('AD-269 run lifecycle — mixed board state', () => {
    it('only claimed-and-live tickets animate', () => {
        const d = emptyData();
        dispatch(d, 'run-a', ['AD-10']);                                                           // dispatching → no
        claimRun(d, { ticketIds: ['AD-11'], agent: 'x', source: 'agent-claim', nowIso: T0, runId: 'run-b' }); // running → yes
        claimRun(d, { ticketIds: ['AD-12'], agent: 'x', source: 'ui-run', nowIso: T0, runId: 'run-c' });
        markRunTerminal(d, 'run-c', 'done', at(1000));                                              // done → no
        expect(deriveRunningTicketIds(d).sort()).toEqual(['AD-11']);
    });
});
