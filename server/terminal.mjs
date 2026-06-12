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
import { probeAgentLiveness, probeAgentBusy, isPidAlive } from './agentLiveness.mjs';
import { extractFirstTicketRef } from './ticketRef.mjs';

// AD-155: report the backend platform + Windows build to the client so xterm
// can be configured for the right PTY backend (windowsPty for ConPTY). ConPTY
// handles line-wrapping/reflow differently than a unix PTY, and xterm needs to
// know the backend to reflow correctly on resize — the config-level root cause
// the prior timing-nudge passes never addressed.
const OS_PLATFORM = process.platform;
const OS_BUILD = (() => {
    const m = String(os.release() || '').match(/\.(\d+)$/);
    return m ? Number(m[1]) : undefined;
})();

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

// AD-370: node-pty is a native module. On machines without a prebuilt binary
// AND without build tools (node-gyp toolchain) — the exact non-engineer
// audience, corporate proxies, unusual platforms — the import fails. We used to
// `process.exit(1)` here, which silently killed the terminal server and made
// the WHOLE board look broken even though kanban / comments / brain-dump / Run
// all work fine without a PTY. Instead we DEGRADE: keep the HTTP+WS server up,
// report `terminalAvailable: false` (+ reason) on /status, tell connecting WS
// clients so they can render an explanatory panel, and let the Run button fall
// back to "run your agent in your own terminal". PTY absence degrades one
// feature, not the product.
let pty = null;
let terminalAvailable = true;
let terminalUnavailableReason = null;
try {
    pty = await import('node-pty');
} catch (err) {
    terminalAvailable = false;
    terminalUnavailableReason = (err && err.message) ? err.message : String(err);
    console.error('[terminal] node-pty failed to load — embedded terminal disabled (the board still works).');
    console.error('[terminal] reason:', terminalUnavailableReason);
    console.error('[terminal] fix: run `npm rebuild node-pty` (or install your platform build tools), then restart `adhdev start`.');
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

// AD-318: `lastDetectedAt` is now refreshed by the per-session liveness probe
// (refreshAgentLiveness) every poll while the agent process is alive — not by
// terminal-output markers. This staleness check is a belt-and-suspenders backstop
// for the run-lease timer in scheduleActiveRunClear; the probe is the source of
// truth for whether an agent is actually running.
const AGENT_DETECTION_STALE_MS = 60 * 1000;

function isAgentDetectionStale(session) {
    if (!session?.agentState?.active) return false;
    const last = session.agentState.lastDetectedAt || 0;
    return last > 0 && (Date.now() - last) > AGENT_DETECTION_STALE_MS;
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
        session.clearActiveRunTimeout = setTimeout(() => { void onActiveRunQuiet(session); }, ACTIVE_RUN_TTL_MS);
    }
}

// AD-341: the run-clear decision when the shell has gone quiet for
// ACTIVE_RUN_TTL_MS. This is the TURN-END fallback (layer 2 of Sameer's
// defense-in-depth close; the explicit agent-release callback is layer 1).
//
// The old logic kept the run alive for as long as the agent PROCESS was alive
// (AD-269 + AD-318). But an interactive agent like Claude Code stays alive the
// whole session — it finishes a ticket and sits at its prompt, still alive — so
// the run NEVER closed on its own. "Process alive" is the wrong stop signal.
//
// The right signal is TURN-END: the shell is quiet AND the agent has no tool /
// command running under it (no live descendant pids). Then it's idle at its
// prompt and the run can close even though the process lives on. A long silent
// build/test keeps a descendant alive → we re-arm instead of false-closing
// (the AD-221 failure mode). probeAgentBusy fails safe to "busy".
async function onActiveRunQuiet(session) {
    if (!session?.shell || session.activeRunTicketIds.length === 0) return;

    // Agent's process has been gone >60s → it really exited. Auto-complete.
    if (isAgentDetectionStale(session)) {
        clearActiveRunTickets(session, 'detection_stale');
        return;
    }

    const agentEverDetected = !!session.agentState?.lastDetectedAt;
    if (!agentEverDetected || !session.agentState?.active) {
        // Never observed an agent on this session (legacy / unrecognized
        // runner): keep the old self-healing behavior for dead runs.
        clearActiveRunTickets(session, 'timed_out');
        return;
    }

    // Agent process is alive. Mid-turn (running a tool) or idle at its prompt?
    let busy = true;
    try {
        busy = await probeAgentBusy(session.agentState.pid);
    } catch {
        busy = true; // fail safe: never false-close on a probe glitch
    }
    // The session may have been torn down while we awaited the probe.
    if (!sessions.get(session.projectId) || !session.shell || session.activeRunTicketIds.length === 0) return;

    if (busy) {
        scheduleActiveRunClear(session); // still working — re-arm the turn-end check
    } else {
        // Quiet + no tool running = the agent finished its turn (idle at prompt).
        // Close even though the process is alive. 'turn_end' auto-completes the
        // execution (drops the mascot) but, unlike a crash, posts no warning.
        clearActiveRunTickets(session, 'turn_end');
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

// AD-341 (direct-terminal start): a ticket reference in the live terminal IS the
// user starting work on it. Whether you type "AD-344" or describe it, the agent
// resolves it and echoes the id in its output — so scanning the output stream
// catches both your explicit reference AND a description the agent maps to a
// ticket. This is the ONLY signal available at the START of direct work: the
// agent does the work before it ever writes to the board (and often skips
// agent-claim on trivial tickets), so without this the card never animates.
//
// Scoped to stay compatible with AD-318 (which removed agent-NAME text sniffing):
//   - Gated on an AD-318 process-CONFIRMED agent, so a bare "AD-12" typed into a
//     plain shell with no agent can't light anything.
//   - Only binds when NO run is already active — never hijacks a Run-button
//     dispatch or an in-flight batch.
//   - Self-healing: the board's done-guard (AD-341) won't animate a closed
//     ticket, and turn-end / release / done-PATCH clears a stray bind.
function maybeBindReferencedTicket(session, data) {
    if (!session?.agentState?.active) return;          // only with a real live agent
    if (session.activeRunTicketIds.length > 0) return; // a run is already lit
    const ticketId = extractFirstTicketRef(data);
    if (!ticketId) return;
    setActiveRunTickets(session, [ticketId], null);
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
    if (priorIds.length > 0 && reason !== 'cleared') {
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


// AD-318: agent liveness is derived from a real OS process probe
// (server/agentLiveness.mjs), polled per session. Text/scrollback detection is
// gone — an agent is "running" only while its process is alive under this shell.
const AGENT_LIVENESS_POLL_MS = 3000;
// Grace window after a launch hint before we stop waiting for the agent's
// process to appear (npm shim -> node startup can take a couple seconds).
const AGENT_LAUNCH_GRACE_MS = 12000;

async function refreshAgentLiveness(session) {
    if (!session?.shell) return;
    // Fast path: a known agent PID still alive => still running. process.kill(pid,0)
    // only tests existence, so we skip the heavier full process enumeration.
    if (session.agentState.active && session.agentState.pid && isPidAlive(session.agentState.pid)) {
        session.agentState.lastDetectedAt = Date.now();
        return;
    }
    let result;
    try {
        result = await probeAgentLiveness(session.shell.pid, session.agentMarker?.name || null);
    } catch {
        result = { active: false, name: null, pid: null };
    }
    // The session may have been torn down while we awaited the OS probe.
    if (!sessions.get(session.projectId) || !session.shell) return;

    if (result.active && result.name) {
        setAgentActive(session, result.name);
        session.agentState.pid = result.pid;
    } else {
        if (session.agentState.active) clearAgentActive(session);
        session.agentState.pid = null;
        // Stop expecting an agent whose process never came up after the launch.
        if (session.agentMarker && Date.now() - session.agentMarker.launchedAt > AGENT_LAUNCH_GRACE_MS) {
            session.agentMarker = null;
        }
    }
}






function inspectTerminalInput(session, data) {
    if (!session) return data;
    // AD-149: an empty input frame is the client's explicit interrupt (Ctrl+C /
    // Esc) signal. Clear any active run / agent state — a deliberate user action,
    // not a text heuristic.
    if (data === '') {
        if (session.activeRunTicketIds.length > 0) {
            markTicketsInterrupted(session.projectId, session.activeRunTicketIds);
            clearActiveRunTickets(session, 'interrupted');
        } else {
            clearAgentActive(session);
        }
        return data;
    }
    // AD-318: typed and pasted terminal text is opaque user data. Agent identity
    // and ticket context come from the launch marker + process liveness + the
    // explicit Run paths — never from sniffing what was typed. (Typed text is
    // what made "hi claude" in a bare shell falsely report an agent, and what
    // auto-started bogus runs off mentioned ticket numbers — AD-269.)
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
        agentState: { active: false, name: null, pid: null, lastDetectedAt: 0 },
        // AD-318: launch hint (identity) + per-session liveness probe handle.
        agentMarker: null,
        livenessTimer: null,
        requestState: { status: 'idle', startedAt: null, updatedAt: null, lastEvent: null },
    };
}

function getOrCreateSession(projectId) {
    // AD-370: no PTY backend — never attempt to spawn a shell. Callers
    // (/execute, WS connect) gate on terminalAvailable before reaching here;
    // this is the defensive backstop so a stray call can't throw.
    if (!terminalAvailable || !pty) return null;
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

        // AD-341: light direct-terminal work when a ticket id is referenced in
        // the stream while a process-confirmed agent is live (see the function
        // for why this is AD-318-compatible).
        maybeBindReferencedTicket(session, data);

        // AD-318: agent detection no longer reads terminal output — liveness is
        // the per-session refreshAgentLiveness OS probe. We still warm the
        // run-clear timer on output so an active run's lease doesn't expire mid-work.
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
        if (session.livenessTimer) { clearInterval(session.livenessTimer); session.livenessTimer = null; }
        session.agentMarker = null;
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

    // AD-318: start the per-session agent-liveness probe loop. Replaces all
    // terminal-text detection — agentState now tracks a real process.
    if (!session.livenessTimer) {
        session.livenessTimer = setInterval(() => { void refreshAgentLiveness(session); }, AGENT_LIVENESS_POLL_MS);
    }
    sessions.set(id, session);
    return session;
}

function snapshotSessionStatus(session) {
    // AD-221: status reads must not clear active runs. The browser polls this
    // endpoint every 2s, so using it as a detection-stale sweeper recreated the
    // premature mascot-stop bug while agents were busy in long quiet turns.
    // AD-318: /status just reads the process-probe-derived agentState; it no
    // longer re-detects from scrollback (the AD-292 false-positive seed).
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
            // AD-370: surface PTY availability even with no session so the
            // OnboardingWizard / Run pre-flight / TerminalPane can all react.
            terminalAvailable,
            terminalReason: terminalUnavailableReason,
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
        terminalAvailable,
        terminalReason: terminalUnavailableReason,
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
                const { command, ticketId, ticketIds, batchId, projectId: rawProjectId, runId, submitMode } = JSON.parse(body);
                if (!command) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Command required' }));
                    return;
                }

                // AD-370: no PTY — can't run anything embedded. Return a clear,
                // structured 503 so the Run path falls back to copy-the-prompt /
                // run-in-your-own-terminal instead of throwing on a null shell.
                if (!terminalAvailable) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'terminal-unavailable', reason: terminalUnavailableReason }));
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
                const shellSubmit = submitMode === 'shell';
                if (!shellSubmit) {
                    setActiveRunTickets(session, normalizedTicketIds, typeof runId === 'string' ? runId : null);
                }

                if (shellSubmit) {
                    const stripped = command.replace(/[\r\n]+$/, '');
                    session.shell.write(stripped + '\r');
                    console.log(`Terminal shell command submitted for project ${projectId}`);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, message: 'Shell command submitted', projectId }));
                    return;
                }

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

    // AD-370: degraded mode — no PTY backend. Tell the client so it renders the
    // explanatory panel, then leave the socket open and idle (no shell to
    // attach, no broadcast list to join). Not closing avoids a reconnect storm;
    // the client treats this message as terminal — it stops showing "connecting".
    if (!terminalAvailable) {
        try { ws.send(JSON.stringify({ type: 'terminal-unavailable', reason: terminalUnavailableReason })); } catch {}
        return;
    }

    clients.add(ws);
    const session = getOrCreateSession(projectId);
    const s = session.shell;

    console.log(`Client connected for project ${projectId} (total: ${clients.size})`);

    if (session.shellBuffer.length > 0) {
        const replay = session.shellBuffer.join('');
        try { ws.send(JSON.stringify({ type: 'output', data: replay })); } catch {}
    }

    try { ws.send(JSON.stringify({ type: 'ready', pid: s.pid, shell: SHELL, projectId, platform: OS_PLATFORM, osBuild: OS_BUILD })); } catch {}

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
                    // AD-318: the launch hint is the agent-OWNED identity signal. It
                    // does NOT flip state — it records which agent to expect so the
                    // process probe can disambiguate. Liveness is the probe alone.
                    activeSession.agentMarker = { name: parsed.agentId.trim(), launchedAt: Date.now() };
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
                    ws.send(JSON.stringify({ type: 'ready', pid: newSession.shell.pid, shell: SHELL, projectId: newProjectId, platform: OS_PLATFORM, osBuild: OS_BUILD }));
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
        if (session.livenessTimer) { clearInterval(session.livenessTimer); session.livenessTimer = null; }
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
