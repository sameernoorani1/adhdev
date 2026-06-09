import { describe, expect, it } from 'vitest';
import { isTicketExecutionActive, isTicketExecutionInProgress } from '../../../src/lib/feedback/executionState';

const ticket = (over: Partial<{ id: string; status: string; execution: { status?: string | null; updatedAt?: string | null } | null }> = {}) => ({
    id: over.id ?? 'AD-345',
    status: over.status ?? 'todo',
    execution: over.execution === undefined ? { status: 'in_progress', updatedAt: new Date().toISOString() } : over.execution,
});

describe('isTicketExecutionActive — done-guard ordering (AD-341)', () => {
    it('a done ticket does NOT animate even if still in the terminal active set', () => {
        // The Run-button "didn't stop" bug: the terminal's captureTicketIds still
        // lists a ticket the agent just PATCHed to done.
        const t = ticket({ status: 'done' });
        expect(isTicketExecutionActive(t, ['AD-345'])).toBe(false);
    });

    it('a reviewed ticket does NOT animate even if still in the active set', () => {
        expect(isTicketExecutionActive(ticket({ status: 'reviewed' }), ['AD-345'])).toBe(false);
    });

    it('an active ticket in the terminal active set DOES animate', () => {
        expect(isTicketExecutionActive(ticket({ status: 'todo' }), ['AD-345'])).toBe(true);
    });

    it('a fresh in_progress execution animates without the active set', () => {
        expect(isTicketExecutionActive(ticket({ status: 'in_progress' }), null)).toBe(true);
    });
});

describe('isTicketExecutionInProgress (mascot, AD-341)', () => {
    it('does not animate a done ticket even with execution stuck in_progress', () => {
        expect(isTicketExecutionInProgress(ticket({ status: 'done' }))).toBe(false);
    });

    it('animates an in_progress execution on a live ticket', () => {
        expect(isTicketExecutionInProgress(ticket({ status: 'todo' }))).toBe(true);
    });
});
