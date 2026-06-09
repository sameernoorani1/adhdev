// AD-064: when the board file is large enough that a blind read will trip the
// agent's per-tool token cap, surface that fact in the Run prompt itself —
// not just in ADHDEV.md. The dynamic per-board size warning lives in
// `./boardSizeWarning` (server-only — uses `node:fs`/`node:path`); callers
// from the server pass the computed string in via `sizeNote`. Client callers
// (FeedbackBoard, TicketDetailModal) just omit it — the static "don't read
// the whole thing if it's large" instruction in the prompt body still fires.

export function buildRunPrompt(ticketIds: string[], sizeNote: string = '', contextBrief: string = ''): string {
    const ids = Array.from(new Set(ticketIds.map(id => id.trim()).filter(Boolean)));
    const contextNote = contextBrief.trim() ? `\n\n${contextBrief.trim()}` : '';
    sizeNote = `${sizeNote}${contextNote}`;

    if (ids.length === 0) {
        return `Read ADHDEV.md. Inspect only the relevant entries in .adhdev/board.json or use targeted search if the board file is large. Follow the ADHDev execution contract and work on all actionable tickets.${sizeNote}\nAdd this acknowledgement to the ADHDev Ack Block in the ticket and terminal summary both: ✅ ACK: Prompt ADHDev Guidance.`;
    }

    // AD-338: claim FIRST. The board's running indicator only lights when you
    // claim — so claim before reading/working, or the user stares at an idle card
    // wondering if anything is happening. One quick POST per ticket, then work.
    const claimFirst = ids.length === 1
        ? `FIRST, before reading or doing anything else, claim it: \`POST http://localhost:3111/api/feedback/agent-claim\` with \`{ "ticketId": "${ids[0]}", "agent": "<your name>", "plan": "<one line>" }\`. This lights the running indicator on the board immediately. THEN read and work.`
        : `FIRST, before reading or doing anything else, claim each ticket as you start it: \`POST http://localhost:3111/api/feedback/agent-claim\` with \`{ "ticketId": "AD-###", "agent": "<your name>", "plan": "<one line>" }\`. This lights each card's running indicator immediately. THEN read and work.`;

    // AD-341: release LAST. The running indicator stays lit until you explicitly
    // close it. A done/blocked PATCH closes it automatically; for any ticket you
    // do NOT move to done (no-code, handshake, left for review), make one final
    // agent-release call so the card stops animating the instant you're finished
    // — don't leave it spinning for the fallback timeout to clean up.
    const releaseLast = ids.length === 1
        ? `LAST, when you are finished with ${ids[0]}: if you did not PATCH it to done/blocked, \`POST http://localhost:3111/api/feedback/agent-release\` with \`{ "ticketId": "${ids[0]}" }\` to stop the running indicator immediately.`
        : `LAST, when you finish EACH ticket: if you did not PATCH it to done/blocked, \`POST http://localhost:3111/api/feedback/agent-release\` with \`{ "ticketId": "AD-###" }\` to stop that card's running indicator immediately.`;

    if (ids.length === 1) {
        return `Work on ticket ${ids[0]}.\n${claimFirst}\nRead ADHDEV.md and the full ${ids[0]} entry in .adhdev/board.json, including the hidden execution contract, all comments, all activity, and current execution state. Do not read the entire board file if it is large; resolve only the full entry for ${ids[0]}.${sizeNote}\n${releaseLast}\nAdd this acknowledgement to the ADHDev Ack Block in the ticket and terminal summary both: ✅ ACK: Prompt ADHDev Guidance.`;
    }

    return `Work on these tickets: ${ids.join(', ')}.\n${claimFirst}\nRead ADHDEV.md and the full entry for each referenced ticket in .adhdev/board.json, including the hidden execution contract, all comments, all activity, and current execution state. Do not read the entire board file if it is large; resolve only the full entries for the referenced tickets.${sizeNote}\n${releaseLast}\nAdd this acknowledgement to the ADHDev Ack Block in the ticket and terminal summary both: ✅ ACK: Prompt ADHDev Guidance.`;
}

export function buildBatchPlanningPrompt(mode: 'full' | 'incremental', ticketIds?: string[]): string {
    const ids = Array.from(new Set((ticketIds || []).map(id => id.trim()).filter(Boolean)));

    if (mode === 'incremental' && ids.length > 0) {
        return [
            `Plan batches only for these selected tickets: ${ids.join(', ')}.`,
            'Read ADHDEV.md and .adhdev/board.json for the planning protocol, full ticket details, current batches, wave/session hints, and ticket status.',
            'Group only tickets that should realistically be worked in one focused coding pass.',
            'Use codebase area overlap, shared files/components, dependency order, risk, and expected context-switch cost.',
            'Avoid mixing unrelated work just to equalize batch size.',
            'Create or update batches with clear names and a short rationale for each batch.',
        ].join('\n');
    }

    if (mode === 'incremental') {
        return [
            'Plan batches for the remaining unbatched actionable tickets.',
            'Read ADHDEV.md and .adhdev/board.json for the planning protocol, full ticket details, current batches, wave/session hints, and ticket status.',
            'Respect existing good batches unless there is a clear reason to restructure them.',
            'Group only tickets that should realistically be worked in one focused coding pass.',
            'Use codebase area overlap, shared files/components, dependency order, risk, and expected context-switch cost.',
            'Create or update batches with clear names and a short rationale for each batch.',
        ].join('\n');
    }

    return [
        'Redo the full batch plan for all actionable tickets.',
        'Read ADHDEV.md and .adhdev/board.json for the planning protocol, full ticket details, existing batches, wave/session hints, and ticket status.',
        'Group tickets into execution batches that maximize focus and minimize context switching.',
        'Use codebase area overlap, shared files/components, dependency order, risk, and expected context-switch cost.',
        'Avoid batches that are too large, too heterogeneous, or blocked by unfinished prerequisite work.',
        'Create or update batches with clear names and a short rationale for each batch.',
    ].join('\n');
}

// §5.4 follow-up: respect the user's onboarding-saved preferred agent +
// variant when telling them how to start the agent. Falls back to the
// detected agent name (or bare `claude`) when no preference is stored.
export interface PreferredAgentPref {
    id?: string;
    variantId?: string;
    customFlags?: string;
}

const AGENT_RUN_COMMAND_BY_ID: Record<string, string> = {
    'Claude Code': 'claude',
    'Codex': 'codex',
    'Gemini CLI': 'gemini',
    'Aider': 'aider',
    'Cursor Agent': 'cursor-agent',
    'Continue': 'continue',
};

const AGENT_VARIANT_FLAGS: Record<string, Record<string, string>> = {
    'Claude Code': {
        standard: '',
        yolo: '--dangerously-skip-permissions',
    },
    'Codex': {
        standard: '',
        'auto-edit': '--sandbox workspace-write --ask-for-approval on-request',
        'full-auto': '--dangerously-bypass-approvals-and-sandbox',
    },
    'Aider': {
        standard: '',
        'yes-always': '--yes-always',
    },
};

export function buildAgentStartupGuidance(agentName?: string | null, preferred?: PreferredAgentPref | null): string[] {
    let command: string;
    if (preferred?.id && AGENT_RUN_COMMAND_BY_ID[preferred.id]) {
        const base = AGENT_RUN_COMMAND_BY_ID[preferred.id];
        const flags = preferred.variantId === 'custom'
            ? (preferred.customFlags || '').trim()
            : (AGENT_VARIANT_FLAGS[preferred.id]?.[preferred.variantId || 'standard'] || '');
        command = flags ? `${base} ${flags}` : base;
    } else {
        const lower = (agentName || '').toLowerCase();
        command = lower.includes('codex')
            ? 'codex'
            : lower.includes('aider')
                ? 'aider'
                : lower.includes('gemini')
                    ? 'gemini'
                    : lower.includes('cursor')
                        ? 'cursor-agent'
                        : 'claude';
    }

    return [
        '1. Open the terminal pane.',
        `2. Start your coding agent by running \`${command}\`.`,
        '3. Once the coding agent is ready, click Run again.',
    ];
}
