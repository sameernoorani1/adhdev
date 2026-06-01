const TICKET_ID_RE = /\b(?:AD|VD)-\d+\b/gi;

const WORK_INTENT_RE = /\b(?:work(?:ing)? on|fix(?:ing)?|implement(?:ing)?|handle|address|take|start|run|do|look at|investigate|claim|review|comment(?:s)?|thoughts?|analy[sz]e|explain|inspect|check|see)\b/i;

const CODEX_MARKERS = [
    'openai codex',
    'codex (v',
    'permissions: yolo mode',
    'approving:',
    'codex cli',
    'codex v',
    'full auto mode',
    'ctrl+e to explain',
];

const CLAUDE_MARKERS = [
    'esc to interrupt',
    'summarize code changes after completion',
    'press ctrl-c again to quit',
    'claude code v',
    'bypass permissions on',
    'shift+tab to cycle',
];

function uniqueTicketIds(text) {
    const ids = new Set();
    for (const match of String(text || '').matchAll(TICKET_ID_RE)) {
        ids.add(match[0].toUpperCase());
    }
    return Array.from(ids);
}

function isBareTicketRequest(text) {
    const stripped = String(text || '')
        .replace(TICKET_ID_RE, '')
        .replace(/\b(?:and|with)\b/gi, '')
        .replace(/[,\s;:+/&|()[\]{}.'"`-]/g, '')
        .trim();
    return stripped.length === 0;
}

export function extractDirectWorkTicketIds(text) {
    const raw = String(text || '');
    if (!raw.trim()) return [];
    const ids = uniqueTicketIds(raw);
    if (ids.length === 0) return [];

    if (isBareTicketRequest(raw) || WORK_INTENT_RE.test(raw)) {
        return ids;
    }

    return [];
}

function lastIndexOfAny(text, needles) {
    let index = -1;
    for (const needle of needles) {
        const next = text.lastIndexOf(needle);
        if (next > index) index = next;
    }
    return index;
}

function shellPromptLineIndex(text) {
    let last = -1;
    let offset = 0;
    for (const line of String(text || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (
            /^[A-Z]:\\.*>\s*$/i.test(trimmed) ||
            /^PS\s+[A-Z]:\\.*>\s*$/i.test(trimmed) ||
            /^(?:[\w.-]+@[\w.-]+(?::[^\s]*)?|[~./\w-]+)?[$#]\s*$/.test(trimmed)
        ) {
            last = offset;
        }
        offset += line.length + 1;
    }
    return last;
}

export function detectAgentFromTerminalTail(text) {
    const normalized = String(text || '').toLowerCase();
    if (!normalized.trim()) return null;

    const codexIndex = lastIndexOfAny(normalized, CODEX_MARKERS);
    const claudeIndex = lastIndexOfAny(normalized, CLAUDE_MARKERS);
    const best = codexIndex > claudeIndex
        ? { name: 'Codex', index: codexIndex }
        : claudeIndex >= 0
            ? { name: 'Claude Code', index: claudeIndex }
            : null;

    if (!best) return null;

    const lastPrompt = shellPromptLineIndex(text);
    if (lastPrompt > best.index) return null;

    return best.name;
}

export const __test = {
    isBareTicketRequest,
    shellPromptLineIndex,
};
