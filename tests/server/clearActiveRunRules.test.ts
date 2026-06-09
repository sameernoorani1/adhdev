import { describe, it, expect } from 'vitest';
import {
    AUTO_COMPLETE_ON_CLEAR_REASONS,
    GRACEFUL_CLEAR_REASONS,
    hasActiveRunExceededMaxDuration,
    isGracefulClearReason,
    shouldAutoCompleteOnClear,
} from '../../server/clearActiveRunRules.mjs';

// AD-216: covers the auto-complete decision in clearActiveRunTickets.
// terminal.mjs delegates to shouldAutoCompleteOnClear for the reason gate;
// these tests pin the contract so a future refactor that re-adds the
// heuristic reasons (the AD-178 regression) trips the suite.

describe('AUTO_COMPLETE_ON_CLEAR_REASONS', () => {
    it('is a Set of exactly the reliable reasons (incl. AD-341 turn_end)', () => {
        expect(AUTO_COMPLETE_ON_CLEAR_REASONS).toBeInstanceOf(Set);
        expect([...AUTO_COMPLETE_ON_CLEAR_REASONS].sort()).toEqual([
            'detection_stale',
            'max_runtime_exceeded',
            'shell_exited',
            'timed_out',
            'turn_end',
        ]);
    });
});

describe('GRACEFUL_CLEAR_REASONS (AD-341)', () => {
    it('turn_end is graceful (auto-completes, but no "auto-cleared" warning)', () => {
        expect(isGracefulClearReason('turn_end')).toBe(true);
        expect(shouldAutoCompleteOnClear('turn_end')).toBe(true);
        expect(GRACEFUL_CLEAR_REASONS.has('turn_end')).toBe(true);
    });

    it('crash/abandon reasons are NOT graceful (they keep the warning comment)', () => {
        expect(isGracefulClearReason('shell_exited')).toBe(false);
        expect(isGracefulClearReason('detection_stale')).toBe(false);
        expect(isGracefulClearReason('timed_out')).toBe(false);
        expect(isGracefulClearReason('max_runtime_exceeded')).toBe(false);
    });
});

describe('shouldAutoCompleteOnClear', () => {
    describe('reasons that auto-complete', () => {
        it('shell_exited → true', () => {
            expect(shouldAutoCompleteOnClear('shell_exited')).toBe(true);
        });

        it('detection_stale → true', () => {
            expect(shouldAutoCompleteOnClear('detection_stale')).toBe(true);
        });

        it('timed_out → true', () => {
            expect(shouldAutoCompleteOnClear('timed_out')).toBe(true);
        });

        it('max_runtime_exceeded → true (AD-221 60-min watchdog)', () => {
            expect(shouldAutoCompleteOnClear('max_runtime_exceeded')).toBe(true);
        });
    });

    describe('reasons that do NOT auto-complete', () => {
        it('interrupted → false (handled separately by markTicketsInterrupted)', () => {
            expect(shouldAutoCompleteOnClear('interrupted')).toBe(false);
        });

        it('agent_idle → false (heuristic, fires mid-run between tickets)', () => {
            expect(shouldAutoCompleteOnClear('agent_idle')).toBe(false);
        });

        it('shell_prompt → false (heuristic, fires when output happens to end with prompt-like string)', () => {
            expect(shouldAutoCompleteOnClear('shell_prompt')).toBe(false);
        });

        it('cleared (default reason) → false', () => {
            expect(shouldAutoCompleteOnClear('cleared')).toBe(false);
        });

        it('unknown reason → false', () => {
            expect(shouldAutoCompleteOnClear('something_else')).toBe(false);
        });

        it('empty string → false', () => {
            expect(shouldAutoCompleteOnClear('')).toBe(false);
        });
    });
});

describe('hasActiveRunExceededMaxDuration', () => {
    it('uses the matching active run startedAt instead of an old ticket execution receipt', () => {
        const boardData = {
            tickets: [
                {
                    id: 'AD-270',
                    execution: {
                        status: 'done',
                        startedAt: '2026-05-07T22:25:47.141Z',
                    },
                },
            ],
            activeRuns: [
                {
                    runId: 'run-fresh',
                    ticketIds: ['AD-270'],
                    status: 'running',
                    startedAt: '2026-05-08T09:35:38.251Z',
                    updatedAt: '2026-05-08T09:36:00.000Z',
                },
            ],
        };

        expect(hasActiveRunExceededMaxDuration(
            boardData,
            ['AD-270'],
            new Date('2026-05-08T08:40:00.000Z').getTime(),
            'run-fresh',
        )).toBe(false);
    });

    it('expires the matching active run when its own lease exceeds the cutoff', () => {
        const boardData = {
            activeRuns: [
                {
                    runId: 'run-old',
                    ticketIds: ['AD-270'],
                    status: 'running',
                    startedAt: '2026-05-08T07:35:38.251Z',
                    updatedAt: '2026-05-08T09:36:00.000Z',
                },
            ],
        };

        expect(hasActiveRunExceededMaxDuration(
            boardData,
            ['ad-270'],
            new Date('2026-05-08T08:40:00.000Z').getTime(),
            'run-old',
        )).toBe(true);
    });

    it('ignores stale/completed runs and non-matching run ids', () => {
        const boardData = {
            activeRuns: [
                {
                    runId: 'run-stale',
                    ticketIds: ['AD-270'],
                    status: 'stale',
                    startedAt: '2026-05-08T07:35:38.251Z',
                },
                {
                    runId: 'run-other',
                    ticketIds: ['AD-270'],
                    status: 'running',
                    startedAt: '2026-05-08T07:35:38.251Z',
                },
            ],
        };

        expect(hasActiveRunExceededMaxDuration(
            boardData,
            ['AD-270'],
            new Date('2026-05-08T08:40:00.000Z').getTime(),
            'run-current',
        )).toBe(false);
    });
});
