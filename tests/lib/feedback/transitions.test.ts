import { describe, it, expect } from 'vitest';
import { validateAgentTransition } from '@/lib/feedback/transitions';
import { getDefaultAgentRules, type FeedbackTicket } from '@/lib/feedback/core';

const RULES = getDefaultAgentRules();

function makeTicket(overrides: Partial<FeedbackTicket> = {}): FeedbackTicket {
    return {
        id: 'AD-001',
        title: 'Test ticket',
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

const aiComment = (content: string) => ({
    id: 'c-1',
    author: 'Claude Code',
    authorType: 'ai',
    content,
    images: [],
    createdAt: '2026-04-30T00:01:00.000Z',
});

const fixComment = aiComment('Implemented the fix and updated the route.');

const validExecution = {
    runId: 'r-1',
    actor: 'Claude Code',
    actorType: 'ai' as const,
    status: 'in_progress' as const,
    startedAt: '2026-04-30T00:00:00.000Z',
    updatedAt: '2026-04-30T00:01:00.000Z',
    summary: 'shipped fix',
    filesTouched: ['src/foo.ts'],
    verification: ['tsc clean'],
    result: 'success' as const,
};

describe('validateAgentTransition', () => {
    describe('forbidden statuses', () => {
        it('blocks AI from setting reviewed', () => {
            const ticket = makeTicket({ status: 'done' });
            const result = validateAgentTransition(ticket, 'reviewed', RULES);
            expect(result.allowed).toBe(false);
            expect(result.error).toMatch(/reviewed/);
        });

        it('blocks AI from setting observe', () => {
            const ticket = makeTicket({ status: 'done' });
            const result = validateAgentTransition(ticket, 'observe', RULES);
            expect(result.allowed).toBe(false);
        });

        it('blocks AI from setting deferred', () => {
            const ticket = makeTicket({ status: 'done' });
            const result = validateAgentTransition(ticket, 'deferred', RULES);
            expect(result.allowed).toBe(false);
        });
    });

    describe('hard gate: AI comment required for done', () => {
        it('blocks done without any AI comment', () => {
            const ticket = makeTicket({ status: 'todo', execution: validExecution });
            const result = validateAgentTransition(ticket, 'done', RULES, ticket);
            expect(result.allowed).toBe(false);
            expect(result.error).toMatch(/without an AI comment/);
        });

        it('allows done when AI comment + fix language + execution metadata are present', () => {
            const ticket = makeTicket({
                status: 'todo',
                comments: [fixComment],
                execution: validExecution,
            });
            const next = { ...ticket, status: 'done', execution: validExecution };
            const result = validateAgentTransition(ticket, 'done', RULES, next);
            expect(result.allowed).toBe(true);
        });

        it('blocks done when AI comments are discussion-only (no fix language)', () => {
            const discussion = aiComment('Plan: will look into this. Suggest deferring.');
            const ticket = makeTicket({
                status: 'todo',
                comments: [discussion],
                execution: validExecution,
            });
            const result = validateAgentTransition(ticket, 'done', RULES, ticket);
            expect(result.allowed).toBe(false);
            expect(result.error).toMatch(/discussion only/);
        });
    });

    describe('allowed transitions per ticket type', () => {
        it('normal: backlog -> todo allowed', () => {
            const ticket = makeTicket({ status: 'backlog', ticketType: 'normal' });
            const result = validateAgentTransition(ticket, 'todo', RULES);
            expect(result.allowed).toBe(true);
        });

        it('normal: backlog -> done blocked (must go through todo)', () => {
            const ticket = makeTicket({ status: 'backlog', ticketType: 'normal', comments: [fixComment], execution: validExecution });
            const result = validateAgentTransition(ticket, 'done', RULES, { ...ticket, status: 'done' });
            expect(result.allowed).toBe(false);
            expect(result.error).toMatch(/cannot transition from "backlog" to "done"/);
        });

        it('normal: todo -> done allowed (with fix comment + metadata)', () => {
            const ticket = makeTicket({ status: 'todo', ticketType: 'normal', comments: [fixComment], execution: validExecution });
            const next = { ...ticket, status: 'done', execution: validExecution };
            const result = validateAgentTransition(ticket, 'done', RULES, next);
            expect(result.allowed).toBe(true);
        });

        it('normal: reopen -> done allowed (with fix comment + metadata)', () => {
            const ticket = makeTicket({ status: 'reopen', ticketType: 'normal', comments: [fixComment], execution: validExecution });
            const next = { ...ticket, status: 'done', execution: validExecution };
            const result = validateAgentTransition(ticket, 'done', RULES, next);
            expect(result.allowed).toBe(true);
        });

        it('discussion: todo -> done blocked (no allowed targets from todo)', () => {
            const ticket = makeTicket({ status: 'todo', ticketType: 'discussion', comments: [fixComment], execution: validExecution });
            const result = validateAgentTransition(ticket, 'done', RULES, { ...ticket, status: 'done' });
            expect(result.allowed).toBe(false);
        });

        it('discussion: backlog -> todo allowed', () => {
            const ticket = makeTicket({ status: 'backlog', ticketType: 'discussion' });
            const result = validateAgentTransition(ticket, 'todo', RULES);
            expect(result.allowed).toBe(true);
        });
    });

    describe('idea workflow plan + approval', () => {
        it('idea: blocks done if no plan comment present', () => {
            const ticket = makeTicket({
                status: 'backlog',
                ticketType: 'idea',
                comments: [fixComment],
                execution: validExecution,
            });
            const result = validateAgentTransition(ticket, 'done', RULES, { ...ticket, status: 'done' });
            // First fails on transition rules (idea backlog -> [todo])
            expect(result.allowed).toBe(false);
        });
    });

    describe('execution metadata gate', () => {
        it('blocks done if execution metadata missing', () => {
            const ticket = makeTicket({ status: 'todo', comments: [fixComment] });
            const result = validateAgentTransition(ticket, 'done', RULES, { ...ticket, status: 'done' });
            expect(result.allowed).toBe(false);
            expect(result.error).toMatch(/execution metadata is missing/);
        });

        it('blocks done if filesTouched is empty', () => {
            const exec = { ...validExecution, filesTouched: [] };
            const ticket = makeTicket({ status: 'todo', comments: [fixComment], execution: exec });
            const result = validateAgentTransition(ticket, 'done', RULES, { ...ticket, status: 'done', execution: exec });
            expect(result.allowed).toBe(false);
            expect(result.error).toMatch(/filesTouched is empty/);
        });

        it('blocks done if result is not success', () => {
            const exec = { ...validExecution, result: 'blocked' as const };
            const ticket = makeTicket({ status: 'todo', comments: [fixComment], execution: exec });
            const result = validateAgentTransition(ticket, 'done', RULES, { ...ticket, status: 'done', execution: exec });
            expect(result.allowed).toBe(false);
            expect(result.error).toMatch(/execution result must be "success"/);
        });
    });
});
