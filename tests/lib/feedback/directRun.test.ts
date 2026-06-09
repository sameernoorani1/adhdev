import { describe, expect, it } from 'vitest';
import { isClaimComment, shouldStartDirectRun } from '../../../src/lib/feedback/directRun';

describe('directRun — isClaimComment', () => {
    it('fires on real claim / plan comments', () => {
        expect(isClaimComment('**Claiming ticket.** Will inspect and fix.')).toBe(true);
        expect(isClaimComment('**Plan:** change X in file Y.')).toBe(true);
        expect(isClaimComment('Picking it up — refactoring the parser now.')).toBe(true);
        expect(isClaimComment("I'll start by reading the ticket.")).toBe(true);
    });

    it('does NOT fire on analysis / discussion comments (no spurious animation)', () => {
        expect(isClaimComment('Here are my findings: the root cause is X. Recommendation: Y.')).toBe(false);
        expect(isClaimComment('Good question. The tradeoff is between A and B.')).toBe(false);
        expect(isClaimComment('')).toBe(false);
    });

    it('does NOT fire on completion / blocker / reopen comments', () => {
        expect(isClaimComment('**Implementation complete.** Files touched: a.ts')).toBe(false);
        expect(isClaimComment('**Completion note / workflow blocker.**')).toBe(false);
        expect(isClaimComment('**Reopening — still broken (new evidence).**')).toBe(false);
    });
});

describe('directRun — shouldStartDirectRun (foolproof claim → running, no agentLive gate)', () => {
    const base = { content: '**Claiming ticket.**', ticketStatus: 'todo', priorExecutionStatus: null };

    it('starts on a claim comment on an active ticket — no live-agent probe needed', () => {
        expect(shouldStartDirectRun(base)).toBe(true);
        expect(shouldStartDirectRun({ ...base, ticketStatus: 'reopen' })).toBe(true);
    });

    it('does NOT start on a done/reviewed ticket (the AD-221/AD-244 resurrection guard)', () => {
        expect(shouldStartDirectRun({ ...base, ticketStatus: 'done' })).toBe(false);
        expect(shouldStartDirectRun({ ...base, ticketStatus: 'reviewed' })).toBe(false);
    });

    it('does NOT start when the ticket is already running (heartbeat path owns it)', () => {
        expect(shouldStartDirectRun({ ...base, priorExecutionStatus: 'in_progress' })).toBe(false);
    });

    it('does NOT start on a non-claim (analysis / completion) comment', () => {
        expect(shouldStartDirectRun({ ...base, content: 'Here is my analysis of the tradeoffs.' })).toBe(false);
        expect(shouldStartDirectRun({ ...base, content: '**Implementation complete.**' })).toBe(false);
    });
});
