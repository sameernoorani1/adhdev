import { describe, expect, it } from 'vitest';
import { extractFirstTicketRef } from '../../server/ticketRef.mjs';

describe('extractFirstTicketRef (AD-341 direct-terminal start)', () => {
    it('extracts an explicit ticket id the user typed', () => {
        expect(extractFirstTicketRef('AD-344')).toBe('AD-344');
        expect(extractFirstTicketRef('> work on AD-344 please')).toBe('AD-344');
    });

    it('extracts the id the agent echoes after resolving a description', () => {
        expect(extractFirstTicketRef("I'll start by reading the ticket AD-344 from the board.")).toBe('AD-344');
    });

    it('is case-insensitive and normalises to upper-case', () => {
        expect(extractFirstTicketRef('ad-12')).toBe('AD-12');
    });

    it('returns the FIRST referenced id', () => {
        expect(extractFirstTicketRef('AD-100 relates to AD-200')).toBe('AD-100');
    });

    it('does not match inside another word (BAD-3, ROAD-5)', () => {
        expect(extractFirstTicketRef('that was a BAD-3 idea on ROAD-5')).toBeNull();
    });

    it('needs at least one digit', () => {
        expect(extractFirstTicketRef('AD- is not a ticket')).toBeNull();
        expect(extractFirstTicketRef('plain text, no ticket')).toBeNull();
    });

    it('handles non-string / empty input safely', () => {
        expect(extractFirstTicketRef('')).toBeNull();
        expect(extractFirstTicketRef(undefined)).toBeNull();
        expect(extractFirstTicketRef(null)).toBeNull();
    });

    it('matches an id wrapped in ANSI-adjacent punctuation', () => {
        expect(extractFirstTicketRef('[AD-7]')).toBe('AD-7');
        expect(extractFirstTicketRef('(AD-58)')).toBe('AD-58');
    });
});
