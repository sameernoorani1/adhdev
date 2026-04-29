export function buildRunPrompt(ticketIds: string[]): string {
    const ids = Array.from(new Set(ticketIds.map(id => id.trim()).filter(Boolean)));
    // AD-146: the address-by-name directive lives in the contract, not the
    // Run prompt. ADHDEV.md's "The User" section, the per-ticket
    // _executionContract, and the terminal auto-context injection all carry
    // it already. The Run / Copy for AI prompt stays light — it's a pointer
    // to the contract, not a restatement.

    if (ids.length === 0) {
        return 'Read ADHDEV.md. Inspect only the relevant entries in .adhdev/board.json or use targeted search if the board file is large. Follow the ADHDev execution contract and work on all actionable tickets. Add this acknowledgement to the ADHDev Ack Block in the ticket and terminal summary both: ✅ ACK: Prompt ADHDev Guidance.';
    }

    if (ids.length === 1) {
        return `Work on ticket ${ids[0]}.\nRead ADHDEV.md and the full ${ids[0]} entry in .adhdev/board.json, including the hidden execution contract, all comments, all activity, and current execution state. Do not read the entire board file if it is large; resolve only the full entry for ${ids[0]}.\nAdd this acknowledgement to the ADHDev Ack Block in the ticket and terminal summary both: ✅ ACK: Prompt ADHDev Guidance.`;
    }

    return `Work on these tickets: ${ids.join(', ')}.\nRead ADHDEV.md and the full entry for each referenced ticket in .adhdev/board.json, including the hidden execution contract, all comments, all activity, and current execution state. Do not read the entire board file if it is large; resolve only the full entries for the referenced tickets.\nAdd this acknowledgement to the ADHDev Ack Block in the ticket and terminal summary both: ✅ ACK: Prompt ADHDev Guidance.`;
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

export function buildAgentStartupGuidance(agentName?: string | null): string[] {
    const lower = (agentName || '').toLowerCase();
    const command = lower.includes('codex')
        ? 'codex'
        : lower.includes('aider')
            ? 'aider'
            : 'claude';

    return [
        '1. Open the terminal pane.',
        `2. Start your coding agent by running \`${command}\`.`,
        '3. Once the coding agent is ready, click Run again.',
    ];
}
