// AD-341: pure ticket-reference extraction, split out of terminal.mjs so it can
// be unit-tested without booting the WS server (same pattern as
// clearActiveRunRules.mjs and the agentLiveness.mjs parsers).

const TICKET_REF_RE = /\bAD-(\d{1,6})\b/i;

/**
 * The FIRST ticket id referenced in `text`, normalised to upper-case
 * "AD-<n>", or null. The leading word boundary keeps "BAD-3" / "ROAD-5" from
 * matching; the digit cap avoids binding an absurd id.
 *
 * @param {unknown} text
 * @returns {string | null}
 */
export function extractFirstTicketRef(text) {
    const m = TICKET_REF_RE.exec(typeof text === 'string' ? text : String(text || ''));
    return m ? `AD-${m[1]}`.toUpperCase() : null;
}
