import { describe, expect, it } from 'vitest';
import { buildLaunchCommand } from '@/lib/feedback/agentCatalog';
import { buildAgentStartupGuidance } from '@/lib/feedback/runPrompt';

describe('agent launch commands', () => {
    it('uses Codex CLI flags supported by the current CLI', () => {
        expect(buildLaunchCommand('Codex', 'auto-edit')).toBe('codex --sandbox workspace-write --ask-for-approval on-request');
        expect(buildLaunchCommand('Codex', 'full-auto')).toBe('codex --dangerously-bypass-approvals-and-sandbox');
    });

    it('uses the saved preferred agent when terminal detection is uncertain', () => {
        expect(buildAgentStartupGuidance(null, { id: 'Codex', variantId: 'full-auto' })[1])
            .toBe('2. Start your coding agent by running `codex --dangerously-bypass-approvals-and-sandbox`.');
    });
});
