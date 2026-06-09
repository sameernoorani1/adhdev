import { describe, expect, it } from 'vitest';
import {
    buildAdhdevProtocol,
    buildExecutionContractText,
    buildInlineContractNotice,
    getDefaultExecutionContract,
} from '@/lib/feedback/protocol';

describe('ADHDev protocol contract', () => {
    it('requires bare ticket references to resolve live full ticket context', () => {
        const contract = getDefaultExecutionContract();

        expect(contract.mustResolveBareTicketReferences).toBe(true);
        expect(buildExecutionContractText(contract, 'Sameer')).toContain(
            'Treat a bare ticket id as a request to resolve the live full ticket entry',
        );
        expect(buildInlineContractNotice(contract, 'Sameer')).toContain(
            'Treat a bare ticket id as a request to resolve that full live ticket context',
        );
        expect(buildAdhdevProtocol('AD', 'Sameer')).toContain(
            'A bare ticket id such as `AD-123` is enough context to act',
        );
    });

    it('requires ticket-specific analysis to be recorded as a ticket comment', () => {
        const contract = getDefaultExecutionContract();

        expect(contract.mustPostTicketSpecificAnalysis).toBe(true);
        expect(buildExecutionContractText(contract, 'Sameer')).toContain(
            'terminal-only responses are incomplete',
        );
        expect(buildInlineContractNotice(contract, 'Sameer')).toContain(
            'Post ticket-specific thoughts/findings/recommendations/analysis/review as ticket comments',
        );
        expect(buildAdhdevProtocol('AD', 'Sameer')).toContain(
            'post the substantive response as a ticket comment and summarize it in terminal',
        );
    });

    it('requires discussion analysis to synthesize prior context and recommend next action', () => {
        const contract = getDefaultExecutionContract();

        expect(contract.mustMeetDiscussionAnalysisQualityBar).toBe(true);
        expect(buildExecutionContractText(contract, 'Sameer')).toContain(
            'consider relevant prior AI comments',
        );
        expect(buildInlineContractNotice(contract, 'Sameer')).toContain(
            'prior AI comments, evidence, tradeoffs, and recommendation',
        );
        expect(buildAdhdevProtocol('AD', 'Sameer')).toContain(
            'Do not let an apology, claim, receipt, or process explanation substitute for the requested analysis',
        );
    });
});
