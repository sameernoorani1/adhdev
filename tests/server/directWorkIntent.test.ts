import { describe, expect, it } from 'vitest';
import { detectAgentFromTerminalTail, extractDirectWorkTicketIds } from '../../server/directWorkIntent.mjs';

describe('direct terminal ticket intent', () => {
    it('treats a bare ticket id as work intent inside an active agent', () => {
        expect(extractDirectWorkTicketIds('AD-326')).toEqual(['AD-326']);
        expect(extractDirectWorkTicketIds('AD-326, AD-221')).toEqual(['AD-326', 'AD-221']);
    });

    it('accepts discussion and review phrasing, not incidental ticket mentions', () => {
        expect(extractDirectWorkTicketIds('pls see comments on AD-327 and share thoughts')).toEqual(['AD-327']);
        expect(extractDirectWorkTicketIds('AD-326 is mentioned in the docs')).toEqual([]);
    });
});

describe('agent restoration from terminal tail', () => {
    it('does not resurrect an agent from stale scrollback after a shell prompt', () => {
        const tail = [
            'Claude Code v1.2.3',
            'esc to interrupt',
            'work complete',
            'C:\\Codebases\\adhdev>',
        ].join('\n');

        expect(detectAgentFromTerminalTail(tail)).toBeNull();
    });

    it('restores an agent when the latest distinctive marker is after the shell prompt', () => {
        const tail = [
            'C:\\Codebases\\adhdev>',
            'OpenAI Codex',
            'full auto mode',
        ].join('\n');

        expect(detectAgentFromTerminalTail(tail)).toBe('Codex');
    });
});
