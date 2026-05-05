import { describe, it, expect } from 'vitest';
import { AUTO_COMPLETE_ON_CLEAR_REASONS, shouldAutoCompleteOnClear } from '../../server/clearActiveRunRules.mjs';

// AD-216: covers the auto-complete decision in clearActiveRunTickets.
// terminal.mjs delegates to shouldAutoCompleteOnClear for the reason gate;
// these tests pin the contract so a future refactor that re-adds the
// heuristic reasons (the AD-178 regression) trips the suite.

describe('AUTO_COMPLETE_ON_CLEAR_REASONS', () => {
    it('is a Set of exactly the four reliable reasons', () => {
        expect(AUTO_COMPLETE_ON_CLEAR_REASONS).toBeInstanceOf(Set);
        expect([...AUTO_COMPLETE_ON_CLEAR_REASONS].sort()).toEqual([
            'detection_stale',
            'max_runtime_exceeded',
            'shell_exited',
            'timed_out',
        ]);
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
