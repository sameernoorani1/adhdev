/**
 * Terminal WebSocket server — runs alongside Next.js dev server.
 * Keeps PERSISTENT per-project shell sessions. Browser tabs can disconnect
 * and reconnect without losing their session. Multiple projects are isolated
 * end-to-end: each project has its own shell, its own run-capture state,
 * its own agent detection — AD-141 reopen fix.
 *
 * Usage: node server/terminal.mjs
 * Runs on port 3112 by default.
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { shouldAutoCompleteOnClear } from './clearActiveRunRules.mjs';

const PORT = parseInt(process.env.TERMINAL_PORT || '3112', 10);

// AD-202/AD-203/AD-204: security perimeter for the terminal server.
//   - CORS: replace wildcard with an explicit allowlist of the board origins.
//   - Origin checks: every mutating HTTP endpoint + the WS upgrade reject
//     anything that didn't come from the board.
//   - Session token: random 32-byte hex token generated at boot and written to
//     ~/.adhdev/session-token with mode 0o600. Required as the x-adhdev-token
//     header on every HTTP endpoint and as ?token=<value> on WS connect.
//     The Next.js process reads the same file and forwards the token on every
//     server-to-server fetch.
//
// Bind the server to 127.0.0.1 (AD-201) — the gate alone is not enough; the
// interface itself must not be reachable from the wider network.
const ALLOWED_ORIGINS = new Set([
    `http://localhost:3111`,
    `http://127.0.0.1:3111`,
]);
const SESSION_TOKEN_PATH = path.join(os.homedir(), '.adhdev', 'session-token');

function getOrCreateSessionToken() {
    try {
        const dir = path.dirname(SESSION_TOKEN_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(SESSION_TOKEN_PATH)) {
            const existing = fs.readFileSync(SESSION_TOKEN_PATH, 'utf-8').trim();
            if (/^[0-9a-f]{64}$/i.test(existing)) return existing;
        }
        const token = crypto.randomBytes(32).toString('hex');
        // Write then chmod (chmod is a no-op on Windows but keeps Unix safe).
        fs.writeFileSync(SESSION_TOKEN_PATH, token + '\n', { mode: 0o600 });
        try { fs.chmodSync(SESSION_TOKEN_PATH, 0o600); } catch {}
        return token;
    } catch (err) {
        console.error('Failed to read/create session token:', err.message);
        // Fail closed: a random in-memory token. Next.js side won't know it,
        // so all requests will 401 — which beats silently leaving the server
        // unauthenticated.
        return crypto.randomBytes(32).toString('hex');
    }
}
const SESSION_TOKEN = getOrCreateSessionToken();

function isAllowedOrigin(req) {
    const origin = req.headers && req.headers.origin;
    if (!origin) {
        // Same-origin server-to-server fetches (Next.js -> terminal) don't
        // send Origin. We allow these and rely on the token check + localhost
        // bind as the gate. Browser cross-origin fetches always send Origin.
        return true;
    }
    return ALLOWED_ORIGINS.has(origin);
}

function isTokenValid(req, urlObj) {
    const headerToken = req.headers && req.headers['x-adhdev-token'];
    if (typeof headerToken === 'string' && headerToken === SESSION_TOKEN) return true;
    if (urlObj) {
        const queryToken = urlObj.searchParams.get('token');
        if (queryToken === SESSION_TOKEN) return true;
    }
    return false;
}

function applyCorsHeaders(req, res) {
    const origin = req.headers && req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    // No header at all when origin is not allowlisted -- the browser will
    // refuse to read the response.
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-adhdev-token');
}

// Use cmd.exe on Windows (PowerShell breaks many things), bash on unix
const SHELL = process.env.ADHDEV_SHELL
    || (process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/bash'));

let pty;
try {
    pty = await import('node-pty');
} catch (err) {
    console.error('Failed to load node-pty:', err.message);
    console.error('Install with: npm install node-pty');
    process.exit(1);
}

const DEFAULT_PROJECT_ID = '__default__';
// AD-144 reopen: bumped from 50k chars (≈ 200 lines of ANSI-laden output) to
// 2 MB. At ~80 chars/line that's ~25k lines, which comfortably covers a full
// day's Claude Code session and exceeds xterm's 10k-line scrollback so nothing
// is lost on the rare legitimate replay path (full-page reload, project
// switch, fresh launch).
const BUFFER_MAX = 2_000_000;
// AD-149 7th scenario: 10 min was far too long. When Claude finishes a turn
// and sits at its input prompt it stops producing output — the only clear
// path for an idle agent is this TTL. 2 minutes is long enough to tolerate a
// genuinely long-running tool (big build, slow test) that's quiet for a while,
// short enough that the indicator clears within reasonable time of actual
// idle. Every output chunk resets the timer, so active work never fires it.
const ACTIVE_RUN_TTL_MS = 2 * 60 * 1000;

// AD-144: persist per-project terminal history under the project's
// .adhdev directory so it survives `npx adhdev` / terminal-server restarts.
// Before this, the in-memory shellBuffer was wiped the moment the terminal
// server process exited — the user saw a blank terminal on every relaunch
// even though the same project was "still open".
const HISTORY_DIR_RELATIVE = path.join('.adhdev', 'terminal-history');
const HISTORY_WRITE_DEBOUNCE_MS = 800;

// AD-141 take 3: per-project sessions hold ALL mutable run-state. The only
// cross-project global kept is `currentProjectId`, and it is used solely as a
// last-resort default for endpoints called with no project hint (legacy paths).
// Broadcasts, /execute, /status, agent detection and activeRunTicketIds are
// all scoped to a specific session. Two tabs on different boards cannot see
// each other's output or run state anymore.
const sessions = new Map();
let currentProjectId = null;

let uiContext = {
    activeProjectId: null,
    view: 'board',
    missionFilter: null,
    selectedMissionId: null,
    selectedTicketId: null,
    selectedTicketIds: [],
    stackBy: 'status',
    groupedBy: 'none',
    showBatchPane: false,
    showActivityFeed: false,
};

const clients = new Set();
const REGISTRY_PATH = path.join(os.homedir(), '.adhdev', 'registry.json');
const BOARD_API_URL = process.env.ADHDEV_BOARD_URL || 'http://localhost:3111';

function normalizeProjectId(id) {
    return id && typeof id === 'string' ? id : DEFAULT_PROJECT_ID;
}

function getProjectRoot(projectId) {
    try {
        if (fs.existsSync(REGISTRY_PATH)) {
            const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
            const projects = Array.isArray(registry.projects) ? registry.projects : [];
            if (projectId && projectId !== DEFAULT_PROJECT_ID) {
                const match = projects.find(project => project.id === projectId);
                if (match?.path) return match.path;
            }
            const active = projects.find(project => project.id === registry.activeProjectId) || projects[0];
            if (active?.path) return active.path;
        }
    } catch {}

    return process.env.ADHDEV_CWD || process.cwd();
}

// AD-144: per-project terminal history persistence.
function getHistoryPath(projectId) {
    const id = normalizeProjectId(projectId);
    return path.join(getProjectRoot(id), HISTORY_DIR_RELATIVE, `${id}.log`);
}

function loadHistoryBuffer(projectId) {
    try {
        const p = getHistoryPath(projectId);
        if (!fs.existsSync(p)) return [];
        const contents = fs.readFileSync(p, 'utf-8');
        if (!contents) return [];
        // Trim to the buffer cap so restart cost is bounded.
        return [contents.slice(-BUFFER_MAX)];
    } catch {
        return [];
    }
}

function writeHistoryBuffer(session) {
    try {
        const p = getHistoryPath(session.projectId);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, session.shellBuffer.join(''), 'utf-8');
    } catch {}
}

function scheduleHistoryWrite(session) {
    if (!session) return;
    if (session.historyWriteTimeout) return;
    session.historyWriteTimeout = setTimeout(() => {
        session.historyWriteTimeout = null;
        writeHistoryBuffer(session);
    }, HISTORY_WRITE_DEBOUNCE_MS);
}

function clearHistoryBuffer(projectId) {
    try {
        const p = getHistoryPath(projectId);
        if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
}

// AD-301: the Next.js API at BOARD_API_URL takes ~5s to come up while this
// terminal server starts immediately, so the first batch of POSTs from
// `recoverStaleInProgressTickets` (and any heartbeat racing the boot)
// reliably fails with ECONNREFUSED. The original error path dumped the
// full undici stack with an AggregateError tree for each retry — looked
// alarming on a clean startup and drowned the actually-useful boot log.
// We now suppress ECONNREFUSED during a brief startup grace period (the
// expected boot race) and downgrade the post-grace failure to a one-line
// warning without the stack tree.
const POST_STARTUP_GRACE_MS = 15_000;
const POST_RETRY_LOG_THROTTLE_MS = 30_000;
const postStartedAt = Date.now();
let lastPostRetryLogAt = 0;

function isConnectionRefused(err) {
    if (!err) return false;
    if (err.code === 'ECONNREFUSED') return true;
    if (err.cause && isConnectionRefused(err.cause)) return true;
    if (Array.isArray(err.errors)) return err.errors.some(isConnectionRefused);
    return false;
}

function postTerminalRunState(projectId, payload) {
    fetch(`${BOARD_API_URL}/api/runs/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...payload }),
    }).catch(err => {
        const refused = isConnectionRefused(err);
        const withinGrace = Date.now() - postStartedAt < POST_STARTUP_GRACE_MS;
        if (refused && withinGrace) return;
        if (refused) {
            const now = Date.now();
            if (now - lastPostRetryLogAt < POST_RETRY_LOG_THROTTLE_MS) return;
            lastPostRetryLogAt = now;
            console.warn(`[terminal] board API unreachable at ${BOARD_API_URL} (will keep retrying silently).`);
            return;
        }
        console.error('[terminal] terminal run-state API update failed:', err?.message || err);
    });
}

function heartbeatActiveRuns(projectId, ticketIds, runId) {
    if (!ticketIds?.length) return;
    postTerminalRunState(projectId, {
        action: 'heartbeat',
        ticketIds,
        runId: runId || undefined,
    });
}

function markActiveRunsTerminal(projectId, ticketIds, reason) {
    if (!ticketIds?.length) return;
    postTerminalRunState(projectId, {
        action: 'clear-active-runs',
        ticketIds,
        reason,
    });
}

// AD-149 follow-up: when the user presses Esc or Ctrl+C in the terminal the
// server clears its own activeRunTicketIds, but the ticket's own execution
// record still shows status='in_progress' with a fresh updatedAt. The client's
// fallback freshness window then keeps the Running indicator lit for up to 60 s
// (terminal-status) or 5 min (active-status). Mark the ticket's execution as
// 'blocked' on interrupt so isTicketExecutionActive returns false immediately
// on the next fetch — the indicator clears within a poll.
function markTicketsInterrupted(projectId, ticketIds) {
    if (!ticketIds?.length) return;
    postTerminalRunState(projectId, {
        action: 'interrupt-tickets',
        ticketIds,
    });
}

// AD-149 permanent fix — the heartbeat architecture.
//
// Single source of truth for the running indicator: `execution.status`.
// The server owns transitions exclusively. No more event-driven flips from
// the comments API, no client-side freshness windows, no pattern-detection
// blending. The rules:
//
// 1. When a ticket enters `activeRunTicketIds`, its execution is set to
//    `in_progress` with a fresh `updatedAt`.
// 2. While it stays in the set, a heartbeat loop (every 10 s) re-stamps
//    `updatedAt` so external observers can tell the run is still live.
// 3. When it leaves the set (TTL, shell exit, Esc, shell-prompt regex, etc.),
//    its execution is auto-completed — status `done` with result `auto_cleared`
//    — UNLESS the agent has already explicitly PATCHed it to done/blocked
//    (which we honour, never overwrite).
// 4. Esc/Ctrl+C still marks execution `blocked` via the existing
//    `markTicketsInterrupted` (preferred over auto-cleared for explicit user
//    abort — has a richer semantic).
const HEARTBEAT_INTERVAL_MS = 10 * 1000;

// AD-221: hard ceiling on a single in_progress run. If the agent's natural
// completion signal (PATCH to done/blocked, shell exit, both timers
// agreeing) never lands, the heartbeat-based mascot would haunt forever.
// 60 min is well above any realistic single-ticket run; the watchdog
// only fires for genuinely stuck/forgotten executions.
const MAX_RUN_DURATION_MS = 60 * 60 * 1000;

// AD-156 reopen #2: if no agent-detection marker has fired in this many ms,
// the agent has exited and we should stop reporting it as active. Claude Code
// repaints `bypass permissions on` while idle and `esc to interrupt` while
// running, so a live agent refreshes `lastDetectedAt` constantly. 60s of
// silence on those markers means the agent is gone — even if the prompt-regex
// in detectAgentOutput missed because the exit chunk wasn't terminated by `>`.
const AGENT_DETECTION_STALE_MS = 60 * 1000;

function isAgentDetectionStale(session) {
    if (!session?.agentState?.active) return false;
    const last = session.agentState.lastDetectedAt || 0;
    return last > 0 && (Date.now() - last) > AGENT_DETECTION_STALE_MS;
}

function expireStaleAgent(session, reason = 'detection_stale') {
    if (!isAgentDetectionStale(session)) return false;
    clearAgentActive(session);
    if (session.activeRunTicketIds.length > 0) {
        clearActiveRunTickets(session, reason);
    }
    return true;
}

function autoCompleteTickets(projectId, ticketIds, reason = 'auto_cleared') {
    if (!ticketIds?.length) return;
    postTerminalRunState(projectId, {
        action: 'auto-complete-tickets',
        ticketIds,
        reason,
    });
}

function startHeartbeat(session) {
    if (!session) return;
    if (session.heartbeatInterval) return;   // already running
    session.heartbeatInterval = setInterval(() => {
        const ids = session.activeRunTicketIds || [];
        if (ids.length === 0) {
            stopHeartbeat(session);
            return;
        }
        // AD-221: max-runtime watchdog. If any active execution has been
        // in_progress longer than MAX_RUN_DURATION_MS, the agent has
        // either crashed silently or was forgotten — the timer-based
        // signals never fired. Clear with `max_runtime_exceeded` so the
        // mascot drops instead of haunting the board indefinitely.
        try {
            if (anyActiveRunExceededMaxDuration(session.projectId, ids, session.activeRunId)) {
                clearActiveRunTickets(session, 'max_runtime_exceeded');
                return;
            }
        } catch {}
        if (session.agentState?.active) {
            confirmActiveRunTickets(session);
        }
    }, HEARTBEAT_INTERVAL_MS);
}

function anyActiveRunExceededMaxDuration(projectId, ticketIds, runId = null) {
    if (!ticketIds?.length) return false;
    const session = getSession(projectId);
    if (!session || (runId && session.activeRunId !== runId)) return false;
    const startedMs = new Date(session.activeRunStartedAt || session.requestState?.startedAt || '').getTime();
    return Number.isFinite(startedMs) && Date.now() - startedMs > MAX_RUN_DURATION_MS;
}

function stopHeartbeat(session) {
    if (!session?.heartbeatInterval) return;
    clearInterval(session.heartbeatInterval);
    session.heartbeatInterval = null;
}

function confirmActiveRunTickets(session) {
    if (!session?.activeRunTicketIds?.length) return;
    session.requestState.status = 'running';
    session.requestState.updatedAt = new Date().toISOString();
    session.requestState.lastEvent = 'agent_confirmed';
    // AD-307/AD-221: keep heartbeats in memory. The browser polls /status for
    // captureTicketIds and renders running state directly; persisting every
    // tick to board.json caused multi-minute feedback-lock queues while a run
    // animation was active.
}

// Server-startup recovery: any ticket left with execution.status='in_progress'
// from a prior crash/kill is clearly not actually running now. Mark as blocked
// so the indicator doesn't haunt forever.
function recoverStaleInProgressTickets() {
    try {
        if (!fs.existsSync(REGISTRY_PATH)) return;
        const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
        const projects = Array.isArray(registry.projects) ? registry.projects : [];
        for (const project of projects) {
            if (!project?.id) continue;
            postTerminalRunState(project.id, { action: 'recover-stale' });
        }
    } catch {}
}

function scheduleActiveRunClear(session) {
    if (!session) return;
    if (session.clearActiveRunTimeout) clearTimeout(session.clearActiveRunTimeout);
    if (session.activeRunTicketIds.length > 0) {
        session.clearActiveRunTimeout = setTimeout(() => {
            // AD-221: 2 minutes of shell-quiet does NOT mean the agent is
            // done. Claude in particular goes silent while it's thinking,
            // between tool calls, or when the user has paused mid-turn —
            // and the mascot was dropping after exactly that window.
            //   * If the agent is still posting UI markers, treat the gap as
            //     `agent_idle` (clears the active set + stops the heartbeat,
            //     but does NOT auto-complete — execution.status stays
            //     in_progress until the agent's own PATCH lands or
            //     detection-stale fires).
            //   * If detection has been quiet for >60s on top of the
            //     2-minute shell-quiet window, the agent really has gone —
            //     fall through as `detection_stale` and auto-complete.
            //   * Last-resort fallback when we never observed an agent on
            //     this session at all (legacy / unrecognized runner): keep
            //     the old `timed_out` behavior so dead runs still self-heal.
            const agentEverDetected = !!session.agentState?.lastDetectedAt;
            if (isAgentDetectionStale(session)) {
                clearActiveRunTickets(session, 'detection_stale');
            } else if (agentEverDetected && session.agentState?.active) {
                // AD-269: quiet agent work is still a live run. Keep the run
                // lease heartbeat alive instead of clearing UI state after a
                // shell-output gap.
                scheduleActiveRunClear(session);
            } else {
                clearActiveRunTickets(session, 'timed_out');
            }
        }, ACTIVE_RUN_TTL_MS);
    }
}

function setActiveRunTickets(session, ticketIds = [], runId = null) {
    if (!session) return;
    session.activeRunTicketIds = Array.from(new Set(ticketIds.filter(Boolean)));
    session.activeRunId = runId || null;
    session.activeRunStartedAt = session.activeRunTicketIds.length > 0 ? new Date().toISOString() : null;
    session.requestState.status = session.activeRunTicketIds.length > 0 ? 'dispatching' : 'idle';
    session.requestState.startedAt = session.activeRunStartedAt;
    session.requestState.updatedAt = new Date().toISOString();
    session.requestState.lastEvent = session.activeRunTicketIds.length > 0 ? 'request_started' : 'request_cleared';
    scheduleActiveRunClear(session);
    // Dispatching is only "prompt sent". Promote to confirmed running once
    // an agent is detected on this terminal session.
    if (session.activeRunTicketIds.length > 0) {
        if (session.agentState?.active) confirmActiveRunTickets(session);
        startHeartbeat(session);
    } else {
        stopHeartbeat(session);
    }
}

// AD-178: which clear-reasons are reliable enough to auto-complete the
// in_progress executions (= drop the running pill on the FE)?
//   - shell_exited: PTY actually died — the agent is gone, full stop.
//   - detection_stale: 60s without any agent-detection marker — the agent has
//     exited (see AD-156 reopen #2).
//   - timed_out: ACTIVE_RUN_TTL_MS (2 min) of no shell output at all — strong
//     signal the run is dead.
//   - max_runtime_exceeded: AD-221 60-min watchdog inside the heartbeat
//     for runs that never naturally complete (silent crash, forgotten run).
// AD-216: AUTO_COMPLETE_ON_CLEAR_REASONS + shouldAutoCompleteOnClear live in
// `./clearActiveRunRules.mjs` so the rules can be unit-tested without booting
// the WS server. Single source of truth for what counts as "agent is gone".

function clearActiveRunTickets(session, reason = 'cleared') {
    if (!session) return;
    // AD-149 permanent fix: snapshot the ids BEFORE emptying so we can
    // auto-complete their executions when the reason is reliable.
    const priorIds = [...session.activeRunTicketIds];
    session.activeRunTicketIds = [];
    if (session.clearActiveRunTimeout) {
        clearTimeout(session.clearActiveRunTimeout);
        session.clearActiveRunTimeout = null;
    }
    session.requestState.status = reason === 'interrupted' ? 'interrupted' : 'idle';
    session.requestState.startedAt = null;
    session.activeRunStartedAt = null;
    session.requestState.updatedAt = new Date().toISOString();
    session.requestState.lastEvent = reason;
    // AD-149 permanent fix: close out the heartbeat. Skip auto-complete for
    // 'interrupted' (markTicketsInterrupted upstream already set them to
    // 'blocked' with a richer semantic) AND for the heuristic reasons (see
    // AD-178 — they fire mid-run). 'cleared' (the default) is also skipped
    // because callers that pass no reason haven't asserted the agent is gone.
    stopHeartbeat(session);
    if (priorIds.length > 0 && (reason === 'interrupted' || shouldAutoCompleteOnClear(reason))) {
        try { markActiveRunsTerminal(session.projectId, priorIds, reason); } catch {}
    }
    session.activeRunId = null;
    if (priorIds.length > 0 && shouldAutoCompleteOnClear(reason)) {
        try { autoCompleteTickets(session.projectId, priorIds, reason); } catch {}
    }
}

function setAgentActive(session, name) {
    if (!session || !name) return;
    const prior = session.agentState.name;
    if (prior && prior !== name) {
        session.outputTail = '';
    }
    session.agentState.active = true;
    session.agentState.name = name;
    session.agentState.lastDetectedAt = Date.now();
    session.requestState.updatedAt = new Date().toISOString();
    session.requestState.lastEvent = prior === name ? session.requestState.lastEvent : 'agent_switched';
    if (session.requestState.status === 'interrupted') {
        session.requestState.status = 'idle';
        session.requestState.lastEvent = 'agent_ready';
    }
    confirmActiveRunTickets(session);
}

function clearAgentActive(session) {
    if (!session) return;
    session.outputTail = '';
    session.agentState.active = false;
    session.agentState.name = null;
    session.requestState.status = 'idle';
    session.requestState.startedAt = null;
    session.requestState.updatedAt = new Date().toISOString();
    session.requestState.lastEvent = 'agent_exited';
}

function stripAnsi(text) {
    return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^]*(?:|\x1b\\)/g, '');
}

function restoreAgentFromTail(session) {
    if (!session || session.agentState.active) return;
    const normalized = String(session.outputTail || '').toLowerCase();
    if (!normalized.trim()) return;
    if (
        normalized.includes('openai codex') ||
        normalized.includes('codex (v') ||
        normalized.includes('codex cli') ||
        normalized.includes('codex v') ||
        normalized.includes('full auto mode') ||
        normalized.includes('ctrl+e to explain')
    ) {
        setAgentActive(session, 'Codex');
        return;
    }
    if (
        normalized.includes('esc to interrupt') ||
        normalized.includes('summarize code changes after completion') ||
        normalized.includes('press ctrl-c again to quit') ||
        normalized.includes('claude code v') ||
        normalized.includes('bypass permissions on') ||
        normalized.includes('shift+tab to cycle')
    ) {
        setAgentActive(session, 'Claude Code');
    }
}

function detectAgentCommand(session, command) {
    if (!session) return;
    const normalized = command.trim().toLowerCase();
    if (!normalized) return;

    if (normalized === 'exit' || normalized === 'quit') {
        clearAgentActive(session);
        return;
    }

    if (normalized === 'claude' || normalized.startsWith('claude ') || normalized.includes('claude-code')) {
        setAgentActive(session, 'Claude Code');
        return;
    }

    if (normalized === 'codex' || normalized.startsWith('codex ')) {
        setAgentActive(session, 'Codex');
        return;
    }

    if (normalized === 'aider' || normalized.startsWith('aider ')) {
        setAgentActive(session, 'Aider');
        return;
    }

    // AD-169: Gemini CLI launches via `gemini` (or `gemini-cli` on some
    // installs). Reported via AD-169: the terminal label still said "Shell" after
    // launching it — without input-side detection we relied on output-only,
    // which doesn't always fire fast enough.
    if (normalized === 'gemini' || normalized.startsWith('gemini ') || normalized.includes('gemini-cli')) {
        setAgentActive(session, 'Gemini CLI');
        return;
    }

    // Cursor's terminal agent (`cursor-agent`) and Continue (`continue` /
    // `cn`) are the other two AI CLIs we cover by request.
    if (normalized === 'cursor-agent' || normalized.startsWith('cursor-agent ')) {
        setAgentActive(session, 'Cursor Agent');
        return;
    }
    if (normalized === 'continue' || normalized.startsWith('continue ')) {
        setAgentActive(session, 'Continue');
    }
}

function extractDirectWorkTicketIds(text) {
    const normalized = String(text || '').toLowerCase();
    if (!normalized.trim()) return [];
    const hasWorkIntent = /\b(work(?:ing)? on|fix(?:ing)?|implement(?:ing)?|handle|address|take|start|run|do|look at|investigate|claim)\b/.test(normalized);
    if (!hasWorkIntent) return [];
    const ids = new Set();
    for (const match of String(text).matchAll(/\b(?:AD|VD)-\d+\b/gi)) {
        ids.add(match[0].toUpperCase());
    }
    return Array.from(ids);
}

function maybeStartDirectTerminalRun(session, text) {
    if (!session?.agentState?.active) return;
    if (session.activeRunTicketIds.length > 0) return;
    const ticketIds = extractDirectWorkTicketIds(text);
    if (ticketIds.length === 0) return;
    const runId = `direct-${Date.now().toString(36)}-${ticketIds.join('-').toLowerCase()}`;
    setActiveRunTickets(session, ticketIds, runId);
    confirmActiveRunTickets(session);
}

function detectAgentOutput(session, data) {
    if (!session) return;
    const cleanChunk = stripAnsi(data);
    const chunk = cleanChunk.toLowerCase();
    session.outputTail = (session.outputTail + cleanChunk).slice(-4000);
    const normalized = session.outputTail.toLowerCase();
    if (!chunk.trim() && !normalized.trim()) return;

    const activeAgentName = session.agentState.active ? session.agentState.name : null;
    const seenForAgent = (agentName, matcher) => matcher(chunk) || (activeAgentName === agentName && matcher(normalized));
    const seenWhenIdle = matcher => matcher(chunk) || (!activeAgentName && matcher(normalized));
    const seenCodex = text => (
        text.includes('openai codex') ||
        text.includes('codex (v') ||
        text.includes('permissions: yolo mode') ||
        text.includes('approving:') ||
        text.includes('codex cli') ||
        text.includes('codex v') ||
        text.includes('full auto mode') ||
        text.includes('ctrl+e to explain')
    );
    const seenClaude = text => (
        text.includes('esc to interrupt') ||
        text.includes('summarize code changes after completion') ||
        text.includes('press ctrl-c again to quit') ||
        text.includes('claude code v') ||
        text.includes('bypass permissions on') ||
        text.includes('shift+tab to cycle')
    );

    if (seenForAgent('Codex', seenCodex) || seenWhenIdle(seenCodex)) {
        setAgentActive(session, 'Codex');
        return;
    }

    // AD-144 reopen #2: detection markers must be *distinctive* — bare words
    // like "codex" or "aider" triggered false agent switches whenever Claude's
    // output mentioned them (e.g. a conversation about agent mascots
    // flipped the session to Codex because the reply referenced Codex as a
    // robot). Keep only phrases that a foreign agent would not print casually.
    // AD-221: match against the rolling 4 KB tail (`normalized`), not just
    // the current chunk. Two reasons: (a) PTY writes can split a marker
    // across two chunks (`bypass permis`/`sions on`) — neither half matches
    // `chunk.includes` even though the phrase is on screen; (b) during long
    // quiet tool calls the TUI emits sparse spinner ticks without re-printing
    // the marker phrase, but the previous repaint is still in the tail —
    // that's "the agent is alive, just busy", not "the agent is gone".
    if (
        normalized.includes('esc to interrupt') ||
        normalized.includes('summarize code changes after completion') ||
        normalized.includes('press ctrl-c again to quit') ||
        normalized.includes('claude code v') ||
        // AD-156 / AD-139 reopen: Claude Code's input prompt repaints
        // `>> bypass permissions on (shift+tab to cycle)` every frame while
        // it's idle/listening. Without this marker, detection missed in
        // user sessions — so Run reported "Sent to Coding Agent" while
        // the prompt actually landed in bare cmd.exe.
        normalized.includes('bypass permissions on') ||
        normalized.includes('shift+tab to cycle')
    ) {
        if (seenForAgent('Claude Code', seenClaude) || seenWhenIdle(seenClaude)) {
            setAgentActive(session, 'Claude Code');
            return;
        }
    }

    if (
        normalized.includes('approving:') ||
        normalized.includes('codex cli') ||
        normalized.includes('codex v') ||
        normalized.includes('full auto mode') ||
        normalized.includes('ctrl+e to explain')
    ) {
        if (seenForAgent('Codex', seenCodex) || seenWhenIdle(seenCodex)) {
            setAgentActive(session, 'Codex');
            return;
        }
    }

    const seenAider = text => (
        text.includes('aider v') ||
        (text.includes('model:') && text.includes('aider'))
    );
    if (seenForAgent('Aider', seenAider) || seenWhenIdle(seenAider)) {
        setAgentActive(session, 'Aider');
        return;
    }

    // AD-169: Gemini CLI distinctive output markers. Gemini's TUI shows a
    // "GEMINI.md" hint on launch and a "/directory" workspace footer; the
    // privacy/auth screens print "google ai" lines. Keep markers narrow so
    // foreign agents don't false-trigger (see AD-144 reopen #2).
    const seenGemini = text => (
        text.includes('gemini cli') ||
        text.includes('gemini.md file') ||
        text.includes('workspace (/directory)') ||
        (text.includes('google ai') && text.includes('gemini'))
    );
    if (seenForAgent('Gemini CLI', seenGemini) || seenWhenIdle(seenGemini)) {
        setAgentActive(session, 'Gemini CLI');
        return;
    }

    const seenCursor = text => (
        text.includes('cursor agent') ||
        text.includes('cursor-agent v')
    );
    if (seenForAgent('Cursor Agent', seenCursor) || seenWhenIdle(seenCursor)) {
        setAgentActive(session, 'Cursor Agent');
        return;
    }

    // AD-221: removed the aggressive in-stream `expireStaleAgent('detection_stale')`
    // that previously fired here. It was the load-bearing cause of mascots
    // dropping mid-run: any non-marker chunk arriving 60s+ after the last
    // marker hit would trigger auto-complete, even while the agent was still
    // genuinely working (long tool call, spinner-only output). The
    // timer-fired path in `scheduleActiveRunClear` (which requires BOTH
    // 2-min shell-quiet AND fingerprint-stale) handles this correctly.

    // Shell prompt detection — only check the LATEST chunk (not accumulated tail)
    // to avoid false positives from agent output that contains > or $ characters.
    // Also skip if agent was detected recently (5s cooldown).
    const PROMPT_COOLDOWN_MS = 5000;
    const timeSinceAgentDetected = Date.now() - (session.agentState.lastDetectedAt || 0);
    if (session.agentState.active && timeSinceAgentDetected > PROMPT_COOLDOWN_MS) {
        const recentOutput = cleanChunk;
        // Windows cmd.exe: "C:\path\to\dir>"
        const isWindowsPrompt = /(?:^|\n)\s*[A-Z]:\\[^\r\n>]*>\s*$/m.test(recentOutput);
        // PowerShell: "PS C:\path>"
        const isPSPrompt = /(?:^|\n)\s*PS\s+[A-Z]:\\[^\r\n>]*>\s*$/m.test(recentOutput);
        // Unix: "user@host:~/path$ " or "$ " at line start
        const isUnixPrompt = /(?:^|\n)\s*(?:\w+@[\w.-]+[:#~][^\r\n]*|)\$\s*$/m.test(recentOutput);
        if (isWindowsPrompt || isPSPrompt || isUnixPrompt) {
            clearAgentActive(session);
            // AD-269: shell-prompt detection is heuristic and has repeatedly
            // fired mid-run. Do not clear the persisted active Run; completion
            // PATCH, explicit interrupt, reliable stale recovery, or the max
            // runtime watchdog owns that transition.
        }
    }

    // AD-053 reopen #2: `esc to interrupt` and the ctrl+c variants are *busy*
    // indicators that Claude Code prints on every loading frame — they used to
    // live in this idle-detection list, which meant the accumulated `normalized`
    // tail held the phrase for the lifetime of the session and cleared
    // activeRunTicketIds on every subsequent chunk. The spinner/shimmer/Running
    // badge vanished within seconds of Run. Only genuinely idle phrases stay.
    if (
        session.activeRunTicketIds.length > 0 &&
        (
            chunk.includes('waiting for your input') ||
            chunk.includes('awaiting your input')
        )
    ) {
        // Keep the active Run visible while the agent is awaiting input.
        // This is still live work from the board's perspective.
        scheduleActiveRunClear(session);
    }
}

function inspectTerminalInput(session, data) {
    if (!session) return data;
    if (data === '') {
        if (session.activeRunTicketIds.length > 0) {
            // AD-149 follow-up: mark affected tickets as blocked BEFORE
            // clearing the server active set so the client indicator clears
            // within one poll instead of riding the fallback freshness window.
            markTicketsInterrupted(session.projectId, session.activeRunTicketIds);
            clearActiveRunTickets(session, 'interrupted');
        } else {
            clearAgentActive(session);
        }
        return data;
    }

    if (data === '') {
        markTicketsInterrupted(session.projectId, session.activeRunTicketIds);
        clearActiveRunTickets(session, 'interrupted');
        session.agentInputBuffer = '';
        return data;
    }

    // Bracketed-paste payloads are opaque terminal data. Do not accumulate
    // them into the agent-command detector; pasted text can contain arbitrary
    // ticket IDs and newlines, but it is still just user input.
    if (data.startsWith('\x1b[200~')) {
        const pasted = data
            .replace(/^\x1b\[200~/, '')
            .replace(/\x1b\[201~$/, '');
        maybeStartDirectTerminalRun(session, pasted);
        return data;
    }

    session.agentInputBuffer = (session.agentInputBuffer || '') + data;
    const buf = session.agentInputBuffer;
    const newlineIndex = buf.search(/[\r\n]/);
    if (newlineIndex === -1) return data;

    const command = buf.slice(0, newlineIndex);
    session.agentInputBuffer = buf.slice(newlineIndex + 1);
    maybeStartDirectTerminalRun(session, command);
    detectAgentCommand(session, command);
    // Raw terminal input is opaque user data. Ticket context is injected only
    // via the explicit run paths, never by heuristically rewriting typed or
    // pasted terminal content.
    return data;
}

function getSession(projectId) {
    return sessions.get(normalizeProjectId(projectId)) || null;
}

function createSessionState(projectId) {
    // AD-144: prime the in-memory buffer from the persisted history file so a
    // restart of the terminal server (or `npx adhdev` itself) surfaces the
    // prior session's scrollback on the next WS connection.
    const seededBuffer = loadHistoryBuffer(projectId);
    // AD-144 reopen: track buffer length incrementally so the trim step in
    // shell.onData is O(1) per chunk instead of joining a multi-MB array.
    const seededLength = seededBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
    return {
        projectId,
        shell: null,
        shellBuffer: seededBuffer,
        shellBufferLength: seededLength,
        agentInputBuffer: '',
        outputTail: seededBuffer.join('').slice(-4000),
        activeRunTicketIds: [],
        activeRunId: null,
        activeRunStartedAt: null,
        clearActiveRunTimeout: null,
        historyWriteTimeout: null,
        agentState: { active: false, name: null, lastDetectedAt: 0 },
        requestState: { status: 'idle', startedAt: null, updatedAt: null, lastEvent: null },
    };
}

function getOrCreateSession(projectId) {
    const id = normalizeProjectId(projectId);
    const existing = sessions.get(id);
    if (existing?.shell) return existing;

    // Resolve cwd for this project
    let cwd = process.env.ADHDEV_CWD || process.cwd();
    try {
        if (fs.existsSync(REGISTRY_PATH)) {
            const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
            const projects = Array.isArray(registry.projects) ? registry.projects : [];
            const project = projects.find(p => p.id === id);
            if (project?.path) cwd = project.path;
        }
    } catch {}

    const session = existing || createSessionState(id);

    // AD-128: The ADHDev dev server is usually launched via `npx next dev`,
    // which prepends `<adhdev>/node_modules/.bin` to PATH. That folder can
    // contain stale binaries (e.g. an old locally-installed `claude`) that
    // take precedence over the user's global install when they type a command
    // in this pty. Strip any local `.bin` directories from PATH so the pty
    // resolves CLIs exactly the way a fresh user shell would.
    const parentEnv = { ...process.env };
    const pathKey = Object.keys(parentEnv).find(k => k.toLowerCase() === 'path') || 'PATH';
    const pathSep = process.platform === 'win32' ? ';' : ':';
    const originalPath = parentEnv[pathKey] || '';
    const filteredPath = originalPath
        .split(pathSep)
        .filter(entry => {
            const norm = entry.replace(/\\/g, '/').toLowerCase();
            return !(norm.includes('/node_modules/.bin'));
        })
        .join(pathSep);
    parentEnv[pathKey] = filteredPath;

    session.shell = pty.default.spawn(SHELL, [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd,
        env: { ...parentEnv, TERM: 'xterm-256color' },
    });

    console.log(`Shell started for project ${id} (PID: ${session.shell.pid}, cwd: ${cwd}, shell: ${SHELL})`);

    session.shell.onData((data) => {
        session.shellBuffer.push(data);
        session.shellBufferLength += data.length;
        // AD-144 reopen: O(1) incremental trim — avoids joining the entire
        // multi-MB buffer on every chunk just to measure length.
        while (session.shellBufferLength > BUFFER_MAX && session.shellBuffer.length > 1) {
            const shifted = session.shellBuffer.shift();
            session.shellBufferLength -= shifted.length;
        }

        // AD-144: debounce a write of the current buffer to disk so history
        // survives terminal-server / `npx adhdev` restarts.
        scheduleHistoryWrite(session);

        // AD-141 take 3: agent detection + run-clear scheduling are both
        // scoped to this session. Two projects each have their own agent
        // state, their own active run tickets, and their own clients.
        detectAgentOutput(session, data);
        if (session.activeRunTicketIds.length > 0) {
            scheduleActiveRunClear(session);
        }

        for (const client of clients) {
            if (client.projectId !== id) continue;
            try { client.send(JSON.stringify({ type: 'output', data })); } catch {}
        }
    });

    session.shell.onExit(({ exitCode }) => {
        console.log(`Shell exited for project ${id} (code: ${exitCode})`);
        for (const client of clients) {
            if (client.projectId !== id) continue;
            try { client.send(JSON.stringify({ type: 'exit', code: exitCode })); } catch {}
        }
        clearActiveRunTickets(session, 'shell_exited');
        clearAgentActive(session);
        // AD-144: flush any pending history write before dropping the session,
        // so the scrollback up to the shell's final frame is preserved for the
        // next `npx adhdev` launch.
        if (session.historyWriteTimeout) {
            clearTimeout(session.historyWriteTimeout);
            session.historyWriteTimeout = null;
        }
        writeHistoryBuffer(session);
        sessions.delete(id);
    });

    sessions.set(id, session);
    return session;
}

function snapshotSessionStatus(session) {
    // AD-221: status reads must not clear active runs. The browser polls this
    // endpoint every 2s, so using it as a detection-stale sweeper recreated the
    // premature mascot-stop bug while agents were busy in long quiet turns.
    if (session) {
        restoreAgentFromTail(session);
    }
    if (!session) {
        return {
            connected: false,
            shellConnected: false,
            clientConnected: clients.size > 0,
            clientCount: clients.size,
            capturing: false,
            captureTicketId: null,
            captureTicketIds: [],
            agentActive: false,
            agentName: null,
            agentStatus: 'inactive',
            requestStatus: 'idle',
            requestStartedAt: null,
            requestUpdatedAt: null,
            lastEvent: null,
            uiContext,
        };
    }
    return {
        connected: !!session.shell,
        shellConnected: !!session.shell,
        clientConnected: clients.size > 0,
        clientCount: clients.size,
        capturing: session.activeRunTicketIds.length > 0,
        captureTicketId: session.activeRunTicketIds[0] || null,
        captureTicketIds: session.activeRunTicketIds,
        agentActive: session.agentState.active,
        agentName: session.agentState.name,
        agentStatus: session.agentState.active ? 'running' : 'inactive',
        requestStatus: session.requestState.status,
        requestStartedAt: session.requestState.startedAt,
        requestUpdatedAt: session.requestState.updatedAt,
        lastEvent: session.requestState.lastEvent,
        projectId: session.projectId,
        uiContext,
    };
}

// AD-203: gate every mutating endpoint on Origin + token. Returns true if the
// request is authorised; false (and writes a 403) if it is not. Read-only /status
// is allowed without the gate so the OnboardingWizard etc. can poll.
function requireGate(req, res, urlObj) {
    if (!isAllowedOrigin(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Origin not allowed' }));
        return false;
    }
    if (!isTokenValid(req, urlObj)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid x-adhdev-token' }));
        return false;
    }
    return true;
}

const httpServer = createServer((req, res) => {
    applyCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // AD-141 take 3: /status is now project-scoped. Callers pass ?project=<id>
    // to get that project's state. Without the param we fall back to the
    // most-recent currentProjectId so legacy tooling still gets something
    // sensible — but the per-project callers avoid this path entirely.
    if (req.method === 'GET' && req.url && req.url.startsWith('/status')) {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        const projectId = normalizeProjectId(url.searchParams.get('project') || currentProjectId);
        const session = getSession(projectId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(snapshotSessionStatus(session)));
        return;
    }

    if (req.method === 'POST' && req.url === '/ui-context') {
        if (!requireGate(req, res, new URL(req.url, `http://localhost:${PORT}`))) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const nextContext = JSON.parse(body || '{}');
                uiContext = {
                    ...uiContext,
                    ...nextContext,
                    selectedTicketIds: Array.isArray(nextContext.selectedTicketIds) ? nextContext.selectedTicketIds : uiContext.selectedTicketIds,
                };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/stop-run') {
        if (!requireGate(req, res, new URL(req.url, `http://localhost:${PORT}`))) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            let projectId = currentProjectId;
            try {
                const parsed = JSON.parse(body || '{}');
                if (parsed && typeof parsed.projectId === 'string') projectId = parsed.projectId;
            } catch {}
            const session = getSession(projectId);
            if (session) clearActiveRunTickets(session, 'interrupted');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/execute') {
        if (!requireGate(req, res, new URL(req.url, `http://localhost:${PORT}`))) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { command, ticketId, ticketIds, batchId, projectId: rawProjectId, runId } = JSON.parse(body);
                if (!command) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Command required' }));
                    return;
                }

                // AD-141 take 3: route to the session whose projectId the
                // caller explicitly asked for. No more singleton routing —
                // a Run click from tab A on project X will ALWAYS land in
                // project X's shell, regardless of what tab B is doing.
                const projectId = normalizeProjectId(rawProjectId || currentProjectId);
                const session = getOrCreateSession(projectId);
                const normalizedTicketIds = Array.isArray(ticketIds)
                    ? ticketIds
                    : ticketId
                        ? [ticketId]
                        : batchId
                            ? [batchId]
                            : [];
                setActiveRunTickets(session, normalizedTicketIds, typeof runId === 'string' ? runId : null);

                // AD-184 → AD-140 (round 2): the 80ms-gap fix from round 1
                // was insufficient — reports kept coming in of the failure
                // mode where the prompt sits in Claude Code's input box but
                // Enter never fires. Five real causes (most → least common):
                //
                //   1. Claude's startup permissions dialog ("bypass permissions
                //      on / shift+tab to cycle") is still up; until dismissed,
                //      Claude is not listening to prompt input. A bare CR that
                //      arrives while it's up dismisses the dialog instead of
                //      submitting our prompt.
                //   2. Multi-line edit mode swallows the Enter — embedded \n in
                //      our prompt puts Claude in multi-line mode, where a bare
                //      CR is treated as "add a line" not "submit."
                //   3. Slow-machine race — the prior 80ms wasn't always enough.
                //   4. Windows ConPTY can split a single write into multiple
                //      reads; the trailing CR may land in a different cycle.
                //   5. Some Windows console apps expect CRLF, not just CR.
                //
                // Round-2 fix — defense-in-depth:
                //   (a) Wrap the prompt in bracketed-paste mode markers
                //       (ESC [ 200 ~ ... ESC [ 201 ~). Modern TUIs treat
                //       everything between those markers as a single paste,
                //       NOT as multi-line edit, so the in-buffer \n's are no
                //       longer ambiguous. Closes #2.
                //   (b) Delay Enter until the receiving REPL has had time to
                //       drain the bracketed-paste payload. Short fixed delays
                //       race on Windows/Codex/Claude when the prompt is large:
                //       the text visibly lands, but the submit keystroke is
                //       swallowed before the TUI exits paste handling.
                //   (c) Send Enter more than once. If Enter #1 lands while
                //       Claude's startup dialog is still up, it dismisses the
                //       dialog; the delayed follow-ups submit the prompt.
                //       Closes #1. Stray-second-Enter at a bash/cmd prompt
                //       just produces one blank line — cheap.
                //
                // Bracketed paste is the load-bearing fix; the timing changes
                // are belt-and-suspenders.
                //
                // AD-243: BPM tells the receiver "this is a paste," not
                //   "replace existing input." If the user (or a prior failed
                //   Run) left half-typed text in Claude Code's prompt buffer,
                //   the new BPM paste gets *appended* to that stale text and
                //   submitted as one merged prompt — silent prompt poisoning.
                //   Fix: prepend Ctrl+U (\x15, the universal readline kill-
                //   line) to wipe whatever's in the input box before pasting.
                //   Empty buffer → no-op; non-empty → cleared. Honored by
                //   Ink-based TUIs (Claude Code) and bash/zsh alike.
                const stripped = command.replace(/[\r\n]+$/, '');
                const BPM_OPEN = '\x1b[200~';
                const BPM_CLOSE = '\x1b[201~';
                const CTRL_U = '\x15';
                // AD-140 reopen: the double-Enter path still left rare runs
                // sitting in the agent prompt after a long paste. Scale the
                // initial submit window up for large prompts and keep two
                // delayed follow-up submits so a startup dialog, paste drain,
                // or ConPTY split cannot consume the only Enter.
                const firstSubmitDelay = Math.max(900, Math.min(3000, 650 + Math.ceil(stripped.length / 6)));
                const secondSubmitDelay = firstSubmitDelay + 600;
                const thirdSubmitDelay = firstSubmitDelay + 1800;
                session.shell.write(CTRL_U);
                setTimeout(() => {
                    try { session.shell.write(BPM_OPEN + stripped + BPM_CLOSE); } catch {}
                }, 50);
                setTimeout(() => {
                    try { session.shell.write('\r'); } catch { /* shell torn down between writes */ }
                }, firstSubmitDelay);
                setTimeout(() => {
                    try { session.shell.write('\r'); } catch { /* same */ }
                }, secondSubmitDelay);
                setTimeout(() => {
                    try { session.shell.write('\r'); } catch { /* same */ }
                }, thirdSubmitDelay);

                const identifier = batchId || ticketId || normalizedTicketIds.join(', ') || 'unknown';
                console.log(`Terminal execution started for project ${projectId}, ${batchId ? 'batch' : 'ticket'} ${identifier}`);

                res.writeHead(200);
                res.end(JSON.stringify({ success: true, message: 'Command executed', projectId }));
            } catch {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    // AD-144: explicit history wipe — called by Reset Session so a deliberate
    // reset actually starts with an empty scrollback on next launch.
    if (req.method === 'POST' && req.url && req.url.startsWith('/reset-history')) {
        if (!requireGate(req, res, new URL(req.url, `http://localhost:${PORT}`))) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { projectId: rawProjectId } = body ? JSON.parse(body) : {};
                const projectId = normalizeProjectId(rawProjectId || currentProjectId);
                const session = getSession(projectId);
                if (session) {
                    if (session.historyWriteTimeout) {
                        clearTimeout(session.historyWriteTimeout);
                        session.historyWriteTimeout = null;
                    }
                    session.shellBuffer = [];
                    session.shellBufferLength = 0;
                }
                clearHistoryBuffer(projectId);
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, projectId }));
            } catch {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    // Explicit UI reset: kill the project's current shell and wipe its
    // persisted scrollback. Typing `exit` into the PTY is not reliable when a
    // TUI owns the prompt, so expose a gated server-side reset path.
    if (req.method === 'POST' && req.url && req.url.startsWith('/reset-session')) {
        if (!requireGate(req, res, new URL(req.url, `http://localhost:${PORT}`))) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { projectId: rawProjectId } = body ? JSON.parse(body) : {};
                const projectId = normalizeProjectId(rawProjectId || currentProjectId);
                const session = getSession(projectId);
                if (session) {
                    if (session.activeRunTicketIds.length > 0) {
                        markTicketsInterrupted(projectId, session.activeRunTicketIds);
                        clearActiveRunTickets(session, 'interrupted');
                    }
                    clearAgentActive(session);
                    if (session.historyWriteTimeout) {
                        clearTimeout(session.historyWriteTimeout);
                        session.historyWriteTimeout = null;
                    }
                    session.shellBuffer = [];
                    session.shellBufferLength = 0;
                    try { session.shell?.kill(); } catch {}
                }
                clearHistoryBuffer(projectId);
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, projectId }));
            } catch {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

const wss = new WebSocketServer({ server: httpServer });

// AD-201: bind to 127.0.0.1 explicitly. The wider machine network must not be
// able to reach this server -- combined with the Origin/token gate (AD-202/203/
// 204) this is defense in depth.
httpServer.listen(PORT, '127.0.0.1', () => {
    console.log(`Terminal server running on http://127.0.0.1:${PORT} (WebSocket + HTTP)`);
    console.log(`Session token: ${SESSION_TOKEN_PATH}`);
    // AD-149 permanent fix: any in_progress executions left over from a prior
    // crash / kill are now definitionally stale — the server owning them is
    // freshly restarted. Mark them as blocked so the indicator doesn't haunt.
    try { recoverStaleInProgressTickets(); } catch {}
});

wss.on('connection', (ws, req) => {
    // AD-141 take 3: each client carries its own projectId. The global
    // currentProjectId is used only as a legacy fallback for /status with no
    // query param; we no longer mutate it on every connection, because doing
    // so caused cross-tab state bleed — the last-connected tab would reshape
    // the /execute + /status routing for every other tab.
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    // AD-203 + AD-204: gate the WS upgrade on Origin and token. Reject before
    // we spin up any per-session state.
    if (!isAllowedOrigin(req)) {
        try { ws.close(1008, 'Origin not allowed'); } catch {}
        return;
    }
    if (!isTokenValid(req, url)) {
        try { ws.close(1008, 'Missing or invalid token'); } catch {}
        return;
    }
    const projectId = normalizeProjectId(url.searchParams.get('project'));
    ws.projectId = projectId;
    if (!currentProjectId) currentProjectId = projectId;

    clients.add(ws);
    const session = getOrCreateSession(projectId);
    const s = session.shell;

    console.log(`Client connected for project ${projectId} (total: ${clients.size})`);

    if (session.shellBuffer.length > 0) {
        const replay = session.shellBuffer.join('');
        try { ws.send(JSON.stringify({ type: 'output', data: replay })); } catch {}
    }

    try { ws.send(JSON.stringify({ type: 'ready', pid: s.pid, shell: SHELL, projectId })); } catch {}

    ws.on('message', (msg) => {
        const activeSession = getSession(ws.projectId);
        if (!activeSession?.shell) return;
        try {
            const parsed = JSON.parse(msg.toString());
            if (parsed.type === 'input') {
                const transformedInput = inspectTerminalInput(activeSession, parsed.data || '');
                activeSession.shell.write(transformedInput);
            } else if (parsed.type === 'agent-hint') {
                if (typeof parsed.agentId === 'string' && parsed.agentId.trim()) {
                    setAgentActive(activeSession, parsed.agentId.trim());
                }
            } else if (parsed.type === 'resize') {
                activeSession.shell.resize(parsed.cols || 120, parsed.rows || 30);
            } else if (parsed.type === 'switch-project') {
                // AD-141 take 3: switching project only affects the requesting
                // client. currentProjectId tracks the most-recent switcher for
                // legacy /status calls without ?project=, but it no longer
                // routes output or execute anywhere.
                const newProjectId = normalizeProjectId(parsed.projectId);
                if (newProjectId === ws.projectId) return;
                ws.projectId = newProjectId;
                currentProjectId = newProjectId;
                const newSession = getOrCreateSession(newProjectId);
                const replay = newSession.shellBuffer.join('');
                try {
                    ws.send(JSON.stringify({ type: 'clear' }));
                    if (replay) ws.send(JSON.stringify({ type: 'output', data: replay }));
                    ws.send(JSON.stringify({ type: 'ready', pid: newSession.shell.pid, shell: SHELL, projectId: newProjectId }));
                } catch {}
                console.log(`Client switched terminal to project ${newProjectId}`);
            }
        } catch {
            activeSession.shell.write(msg.toString());
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`Client disconnected (total: ${clients.size})`);
    });
});

// AD-144: flush pending history writes on process shutdown so a restart
// doesn't lose the last ~HISTORY_WRITE_DEBOUNCE_MS of output.
function flushAllHistoryOnExit() {
    for (const [, session] of sessions) {
        if (session.historyWriteTimeout) {
            clearTimeout(session.historyWriteTimeout);
            session.historyWriteTimeout = null;
        }
        try { writeHistoryBuffer(session); } catch {}
        // AD-149 permanent fix: stop the heartbeat loops on shutdown so no
        // dangling intervals keep the process alive past the exit call.
        try { stopHeartbeat(session); } catch {}
    }
}

process.on('SIGINT', () => {
    flushAllHistoryOnExit();
    for (const [, session] of sessions) session.shell?.kill();
    httpServer.close();
    process.exit(0);
});
process.on('SIGTERM', () => {
    flushAllHistoryOnExit();
    for (const [, session] of sessions) session.shell?.kill();
    httpServer.close();
    process.exit(0);
});
