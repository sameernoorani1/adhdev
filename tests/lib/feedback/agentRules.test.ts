import { describe, expect, it } from 'vitest';
import { getDefaultAgentRules } from '@/lib/feedback/core';

describe('default agent rules', () => {
    it('sets a discussion quality bar for comments and discussion workflows', () => {
        const rules = getDefaultAgentRules();

        expect(rules.global.commentRules.join('\n')).toContain('DISCUSSION QUALITY');
        expect(rules.global.commentRules.join('\n')).toContain('prior AI comments');
        expect(rules.workflows.discussion.instructions).toContain('addresses the ticket requirement');
        expect(rules.workflows.discussion.instructions).toContain('considers prior AI comments');
        expect(rules.workflows.idea.instructions).toContain('recommends next action');
    });
});
