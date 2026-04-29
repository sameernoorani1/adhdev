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
import fs from 'fs';
import os from 'os';
import path from 'path';

const PORT = parseInt(process.env.TERMINAL_PORT || '3112', 10);

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
    showProgressPage: false,
};

const clients = new Set();
const REGISTRY_PATH = path.join(os.homedir(), '.adhdev', 'registry.json');
const BOARD_RELATIVE_PATH = path.join('.adhdev', 'board.json');
const PROTOCOL_FILENAME = 'ADHDEV.md';

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

function getBoardPath(projectId) {
    return path.join(getProjectRoot(projectId), BOARD_RELATIVE_PATH);
}

// AD-146: read the user's preferred display name from the project config.
// AD-200: fallback is now the neutral 'You' (was 'Sameer' historically).
function getUserDisplayName(projectId) {
    try {
        const configPath = path.join(getProjectRoot(projectId), '.adhdev', 'config.json');
        if (!fs.existsSync(configPath)) return 'You';
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const name = typeof parsed?.userDisplayName === 'string' ? parsed.userDisplayName.trim() : '';
        return name || 'You';
    } catch {
        return 'You';
    }
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

function readBoard(projectId) {
    try {
        const boardPath = getBoardPath(projectId);
        if (!fs.existsSync(boardPath)) return null;
        return JSON.parse(fs.readFileSync(boardPath, 'utf-8'));
    } catch {
        return null;
    }
}

// AD-175: write-temp-then-rename so a kill mid-flush leaves the existing
// board.json intact instead of a half-written file. The rename is atomic on
// POSIX, and on Windows fs.renameSync replaces the destination atomically as
// long as both paths are on the same filesystem (we always write the tmp
// file alongside the target, so they are).
function writeBoard(data, projectId) {
    const target = getBoardPath(projectId);
    const tmp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
        fs.renameSync(tmp, target);
    } catch {
        try { fs.unlinkSync(tmp); } catch {}
    }
}

function extractReferencedTicketIds(command, boardData) {
    const matches = command.match(/\b[A-Z]{2,6}-\d+\b/gi) || [];
    const ids = Array.from(new Set(matches.map(match => match.toUpperCase())));
    if (!boardData?.tickets?.length) return ids;
    const validIds = new Set(boardData.tickets.map(ticket => String(ticket.id || '').toUpperCase()));
    return ids.filter(id => validIds.has(id));
}

function resolveTicketIdsFromUiContext(command, boardData) {
    const lower = command.toLowerCase();
    const selectedIds = Array.isArray(uiContext.selectedTicketIds) ? uiContext.selectedTicketIds : [];

    if ((/\b(these|selected)\b/.test(lower) || lower.includes('current selection')) && selectedIds.length > 0) {
        return selectedIds.map(id => String(id).toUpperCase());
    }

    if ((/\bthis ticket\b/.test(lower) || /\bcurrent ticket\b/.test(lower)) && uiContext.selectedTicketId) {
        return [String(uiContext.selectedTicketId).toUpperCase()];
    }

    if ((/\bthis mission\b/.test(lower) || /\bcurrent mission\b/.test(lower)) && uiContext.missionFilter && boardData?.tickets?.length) {
        return boardData.tickets
            .filter(ticket => String(ticket.missionId || '') === String(uiContext.missionFilter))
            .map(ticket => String(ticket.id).toUpperCase());
    }

    return [];
}

function alreadyIncludesAdhdevContract(command) {
    const lower = command.toLowerCase();
    return (
        lower.includes('adhdev.md') ||
        lower.includes('.adhdev/board.json') ||
        lower.includes('execution contract') ||
        lower.includes('workflow rules')
    );
}

function buildInjectedExecutionContract(ticketIds, boardData, projectId) {
    const tickets = (boardData?.tickets || []).filter(ticket => ticketIds.includes(String(ticket.id || '').toUpperCase()));
    const userName = getUserDisplayName(projectId);
    const lines = [
        '[ADHDEV AUTO-CONTEXT]',
        // AD-146: tell the agent the user's name up front so every comment
        // addresses them by name instead of as "human" / "user".
        `User: ${userName}. Address them as "${userName}" in comments, terminal output, and summaries — never as "human", "user", or "reporter".`,
        `Treat this as declared ADHDev work for ticket${ticketIds.length === 1 ? '' : 's'} ${ticketIds.join(', ')}.`,
        `Read ${PROTOCOL_FILENAME} and the full referenced ticket entries in ${BOARD_RELATIVE_PATH} before acting.`,
        'Execution contract:',
        '- Read the hidden ticket execution contract first.',
        '- Read the full ticket entry before acting.',
        '- Read all comments and activity on the ticket before acting.',
        '- Add or update an AI plan comment before implementation.',
        '- Keep ticket status and execution state accurately updated while working.',
        `- Reply in comments to any @mentions from ${userName} on these tickets.`,
        '- After work, add an AI completion comment with summary, files touched, and verification.',
        '- If blocked or interrupted, add/update comments and leave the ticket in an accurate non-done state.',
        '- Add this acknowledgement to the ADHDev Ack Block in the ticket and terminal summary both: ✅ ACK: Embedded Contract Read.',
    ];

    if (tickets.length > 0) {
        lines.push('Ticket scope:');
        for (const ticket of tickets) {
            const metadata = [
                ticket.status ? `status: ${ticket.status}` : null,
                ticket.priority ? `priority: ${ticket.priority}` : null,
                ticket.wave ? `wave: ${ticket.wave}` : null,
                ticket.session ? `session: ${ticket.session}` : null,
                ticket.contractVersion ? `contract: v${ticket.contractVersion}` : null,
            ].filter(Boolean).join(', ');
            lines.push(`- ${ticket.id}: ${ticket.title}${metadata ? ` (${metadata})` : ''}`);
            if (ticket.description) {
                lines.push(`  Description: ${String(ticket.description).trim()}`);
            }
            if (Array.isArray(ticket.comments) && ticket.comments.length > 0) {
                lines.push('  Comments:');
                for (const comment of ticket.comments) {
                    lines.push(`  - [${comment.author} | ${comment.authorType} | ${comment.createdAt}] ${String(comment.content || '').trim()}`);
                }
            } else {
                lines.push('  Comments: none');
            }
            if (Array.isArray(ticket.activity) && ticket.activity.length > 0) {
                lines.push('  Activity:');
                for (const activity of ticket.activity) {
                    const fromTo = activity.from || activity.to ? ` (${activity.from || ''}${activity.to ? ` -> ${activity.to}` : ''})` : '';
                    lines.push(`  - [${activity.by} | ${activity.byType} | ${activity.at}] ${activity.action}${fromTo}`);
                }
            } else {
                lines.push('  Activity: none');
            }
        }
    }

    const contextBits = [];
    if (uiContext.view) contextBits.push(`view: ${uiContext.view}`);
    if (uiContext.missionFilter) contextBits.push(`mission: ${uiContext.missionFilter}`);
    if (uiContext.stackBy) contextBits.push(`stacked by: ${uiContext.stackBy}`);
    if (uiContext.groupedBy && uiContext.groupedBy !== 'none') contextBits.push(`grouped by: ${uiContext.groupedBy}`);
    if (contextBits.length > 0) {
        lines.push(`UI context: ${contextBits.join(', ')}`);
    }

    return `\n\n${lines.join('\n')}`;
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
    const boardData = readBoard(projectId);
    if (!boardData?.tickets?.length) return;

    const ids = new Set(ticketIds.map(id => String(id).toUpperCase()));
    const now = new Date().toISOString();
    let changed = false;

    for (const ticket of boardData.tickets) {
        if (!ids.has(String(ticket.id || '').toUpperCase())) continue;
        if (ticket.execution?.status !== 'in_progress') continue;

        ticket.execution = {
            ...ticket.execution,
            status: 'blocked',
            updatedAt: now,
            blocker: ticket.execution.blocker || 'Interrupted by user (Esc / Ctrl+C).',
        };

        if (!Array.isArray(ticket.activity)) ticket.activity = [];
        ticket.activity.push({
            action: 'execution_interrupted',
            by: ticket.execution.actor || 'Coding Agent',
            byType: 'ai',
            at: now,
        });
        ticket.updatedAt = now;
        changed = true;
    }

    if (changed) writeBoard(boardData, projectId);
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

function bumpExecutionForActiveTickets(projectId, ticketIds) {
    if (!ticketIds?.length) return;
    const boardData = readBoard(projectId);
    if (!boardData?.tickets?.length) return;

    const ids = new Set(ticketIds.map(id => String(id).toUpperCase()));
    const now = new Date().toISOString();
    let changed = false;

    for (const ticket of boardData.tickets) {
        if (!ids.has(String(ticket.id || '').toUpperCase())) continue;
        const prior = ticket.execution || {};
        // If the agent has explicitly completed or blocked this run, the
        // heartbeat does NOT resurrect the indicator. It only keeps alive
        // what was already alive.
        if (prior.status === 'done' || prior.status === 'blocked') continue;

        ticket.execution = {
            ...prior,
            runId: prior.runId || `exec-${Date.now().toString(36)}`,
            actorType: prior.actorType || 'ai',
            status: 'in_progress',
            startedAt: prior.startedAt || now,
            updatedAt: now,
            completedAt: null,
            plan: prior.plan || '',
            summary: prior.summary || '',
            filesTouched: Array.isArray(prior.filesTouched) ? prior.filesTouched : [],
            verification: Array.isArray(prior.verification) ? prior.verification : [],
            blocker: null,
            actor: prior.actor || 'Coding Agent',
        };
        ticket.updatedAt = now;
        changed = true;
    }

    if (changed) writeBoard(boardData, projectId);
}

function autoCompleteTickets(projectId, ticketIds, reason = 'auto_cleared') {
    if (!ticketIds?.length) return;
    const boardData = readBoard(projectId);
    if (!boardData?.tickets?.length) return;

    const ids = new Set(ticketIds.map(id => String(id).toUpperCase()));
    const now = new Date().toISOString();
    let changed = false;

    for (const ticket of boardData.tickets) {
        if (!ids.has(String(ticket.id || '').toUpperCase())) continue;
        const prior = ticket.execution || {};
        // Respect explicit agent completion — don't overwrite a proper done/
        // blocked record that was PATCHed via the feedback API.
        if (prior.status !== 'in_progress') continue;

        ticket.execution = {
            ...prior,
            status: 'done',
            result: reason,
            completedAt: now,
            updatedAt: now,
        };
        if (!Array.isArray(ticket.activity)) ticket.activity = [];
        ticket.activity.push({
            action: 'execution_completed',
            by: prior.actor || 'Coding Agent',
            byType: 'ai',
            at: now,
            reason,
        });
        ticket.updatedAt = now;
        changed = true;
    }

    if (changed) writeBoard(boardData, projectId);
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
        try { bumpExecutionForActiveTickets(session.projectId, ids); } catch {}
    }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(session) {
    if (!session?.heartbeatInterval) return;
    clearInterval(session.heartbeatInterval);
    session.heartbeatInterval = null;
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
            try {
                const boardPath = path.join(project.path, BOARD_RELATIVE_PATH);
                if (!fs.existsSync(boardPath)) continue;
                const boardData = JSON.parse(fs.readFileSync(boardPath, 'utf-8'));
                if (!boardData?.tickets?.length) continue;
                const now = new Date().toISOString();
                let changed = false;
                for (const ticket of boardData.tickets) {
                    if (ticket.execution?.status === 'in_progress') {
                        ticket.execution = {
                            ...ticket.execution,
                            status: 'blocked',
                            updatedAt: now,
                            blocker: ticket.execution.blocker || 'Terminal server restarted while run was in progress.',
                        };
                        ticket.updatedAt = now;
                        changed = true;
                    }
                }
                if (changed) {
                    fs.writeFileSync(boardPath, JSON.stringify(boardData, null, 2) + '\n', 'utf-8');
                    console.log(`Recovered stale in_progress executions for project ${project.id || project.path}`);
                }
            } catch {}
        }
    } catch {}
}

function markDeclaredRun(projectId, ticketIds, actorName) {
    const boardData = readBoard(projectId);
    if (!boardData?.tickets?.length) return;

    const now = new Date().toISOString();
    const nowMs = Date.now();
    // AD-159: window for de-duping declarations. A user pressing Enter twice
    // (often a "did that work?" retry) used to land two Claiming-ticket
    // comments + two pairs of activity entries on the same ticket within
    // seconds. 30s is long enough to absorb retries without suppressing a
    // legitimate re-declaration after a real conversation.
    const DECLARATION_DEDUP_MS = 30 * 1000;
    const actor = actorName || 'Coding Agent';
    let changed = false;

    for (const ticket of boardData.tickets) {
        if (!ticketIds.includes(String(ticket.id || '').toUpperCase())) continue;

        // AD-159: skip if this actor already declared a terminal run on this
        // ticket within the dedup window. Keeps the comment trail clean and
        // avoids the misleading "started working ... started working ..."
        // double-entry seen on AD-158.
        const recentDeclaration = (ticket.activity || []).some(entry => {
            if (entry.action !== 'terminal_run_declared') return false;
            if (entry.by !== actor) return false;
            const ts = new Date(entry.at || 0).getTime();
            return Number.isFinite(ts) && (nowMs - ts) < DECLARATION_DEDUP_MS;
        });
        if (recentDeclaration) continue;

        if (!Array.isArray(ticket.comments)) ticket.comments = [];
        ticket.comments.push({
            id: `c-${Date.now().toString(36)}-${ticket.id}`,
            author: actorName || 'Coding Agent',
            authorType: 'ai',
            content: `**Claiming ticket.** Terminal-referenced ADHDev work was declared for ${ticket.id}. I will inspect the ticket, follow the ADHDev contract, and post a completion update here.`,
            images: [],
            createdAt: now,
        });

        ticket.execution = {
            runId: ticket.execution?.runId || `run-${Date.now().toString(36)}-${ticket.id}`,
            actor: actorName || ticket.execution?.actor || 'Coding Agent',
            actorType: 'ai',
            status: 'in_progress',
            startedAt: ticket.execution?.startedAt || now,
            updatedAt: now,
            completedAt: null,
            plan: ticket.execution?.plan || '',
            summary: ticket.execution?.summary || '',
            filesTouched: Array.isArray(ticket.execution?.filesTouched) ? ticket.execution.filesTouched : [],
            verification: Array.isArray(ticket.execution?.verification) ? ticket.execution.verification : [],
            result: ticket.execution?.result,
            blocker: null,
            batchId: ticket.execution?.batchId,
        };

        if (!Array.isArray(ticket.activity)) ticket.activity = [];
        ticket.activity.push({
            action: 'terminal_run_declared',
            by: actorName || 'Coding Agent',
            byType: 'ai',
            at: now,
        });
        ticket.activity.push({
            action: 'execution_started',
            by: actorName || 'Coding Agent',
            byType: 'ai',
            at: now,
        });
        ticket.updatedAt = now;
        changed = true;
    }

    if (changed) writeBoard(boardData, projectId);
}

function scheduleActiveRunClear(session) {
    if (!session) return;
    if (session.clearActiveRunTimeout) clearTimeout(session.clearActiveRunTimeout);
    if (session.activeRunTicketIds.length > 0) {
        session.clearActiveRunTimeout = setTimeout(() => {
            clearActiveRunTickets(session, 'timed_out');
        }, ACTIVE_RUN_TTL_MS);
    }
}

function setActiveRunTickets(session, ticketIds = []) {
    if (!session) return;
    session.activeRunTicketIds = Array.from(new Set(ticketIds.filter(Boolean)));
    session.requestState.status = session.activeRunTicketIds.length > 0 ? 'running' : 'idle';
    session.requestState.startedAt = session.activeRunTicketIds.length > 0 ? new Date().toISOString() : null;
    session.requestState.updatedAt = new Date().toISOString();
    session.requestState.lastEvent = session.activeRunTicketIds.length > 0 ? 'request_started' : 'request_cleared';
    scheduleActiveRunClear(session);
    // AD-149 permanent fix: heartbeat kicks in the moment a run starts and
    // keeps execution.updatedAt fresh every 10 s until the set clears.
    if (session.activeRunTicketIds.length > 0) {
        bumpExecutionForActiveTickets(session.projectId, session.activeRunTicketIds);
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
// Heuristic triggers (`shell_prompt`, `agent_idle`) used to auto-complete too,
// but in practice they fired mid-run: a chunk happened to end with
// a shell-prompt-shaped string, or the busy markers paused briefly between
// tickets — and the FE running pill dropped on tickets the agent hadn't
// finished posting comments/PATCH for. Now those reasons just clear the active
// set + stop the heartbeat; execution.status stays `in_progress` until the
// agent's own PATCH lands. The reliable reasons keep auto-completing as a
// crashed-agent safety net.
const AUTO_COMPLETE_ON_CLEAR_REASONS = new Set([
    'shell_exited',
    'detection_stale',
    'timed_out',
]);

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
    session.requestState.updatedAt = new Date().toISOString();
    session.requestState.lastEvent = reason;
    // AD-149 permanent fix: close out the heartbeat. Skip auto-complete for
    // 'interrupted' (markTicketsInterrupted upstream already set them to
    // 'blocked' with a richer semantic) AND for the heuristic reasons (see
    // AD-178 — they fire mid-run). 'cleared' (the default) is also skipped
    // because callers that pass no reason haven't asserted the agent is gone.
    stopHeartbeat(session);
    if (
        reason !== 'interrupted'
        && priorIds.length > 0
        && AUTO_COMPLETE_ON_CLEAR_REASONS.has(reason)
    ) {
        try { autoCompleteTickets(session.projectId, priorIds, reason); } catch {}
    }
}

function setAgentActive(session, name) {
    if (!session || !name) return;
    const prior = session.agentState.name;
    session.agentState.active = true;
    session.agentState.name = name;
    session.agentState.lastDetectedAt = Date.now();
    session.requestState.updatedAt = new Date().toISOString();
    session.requestState.lastEvent = prior === name ? session.requestState.lastEvent : 'agent_switched';
    if (session.requestState.status === 'interrupted') {
        session.requestState.status = 'idle';
        session.requestState.lastEvent = 'agent_ready';
    }
}

function clearAgentActive(session) {
    if (!session) return;
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

function detectAgentOutput(session, data) {
    if (!session) return;
    const cleanChunk = stripAnsi(data);
    const chunk = cleanChunk.toLowerCase();
    session.outputTail = (session.outputTail + cleanChunk).slice(-4000);
    const normalized = session.outputTail.toLowerCase();
    if (!chunk.trim() && !normalized.trim()) return;

    // AD-144 reopen #2: detection markers must be *distinctive* — bare words
    // like "codex" or "aider" triggered false agent switches whenever Claude's
    // output mentioned them (e.g. a conversation about agent mascots
    // flipped the session to Codex because the reply referenced Codex as a
    // robot). Keep only phrases that a foreign agent would not print casually.
    if (
        chunk.includes('esc to interrupt') ||
        chunk.includes('summarize code changes after completion') ||
        chunk.includes('press ctrl-c again to quit') ||
        chunk.includes('claude code v') ||
        // AD-156 / AD-139 reopen: Claude Code's input prompt repaints
        // `>> bypass permissions on (shift+tab to cycle)` every frame while
        // it's idle/listening. Without this marker, detection missed in
        // user sessions — so Run reported "Sent to Coding Agent" while
        // the prompt actually landed in bare cmd.exe.
        chunk.includes('bypass permissions on') ||
        chunk.includes('shift+tab to cycle')
    ) {
        setAgentActive(session, 'Claude Code');
        return;
    }

    if (
        chunk.includes('approving:') ||
        chunk.includes('codex cli') ||
        chunk.includes('codex v') ||
        chunk.includes('full auto mode') ||
        chunk.includes('ctrl+e to explain')
    ) {
        setAgentActive(session, 'Codex');
        return;
    }

    if (
        chunk.includes('aider v') ||
        (chunk.includes('model:') && chunk.includes('aider'))
    ) {
        setAgentActive(session, 'Aider');
        return;
    }

    // AD-169: Gemini CLI distinctive output markers. Gemini's TUI shows a
    // "GEMINI.md" hint on launch and a "/directory" workspace footer; the
    // privacy/auth screens print "google ai" lines. Keep markers narrow so
    // foreign agents don't false-trigger (see AD-144 reopen #2).
    if (
        chunk.includes('gemini cli') ||
        chunk.includes('gemini.md file') ||
        chunk.includes('workspace (/directory)') ||
        (chunk.includes('google ai') && chunk.includes('gemini'))
    ) {
        setAgentActive(session, 'Gemini CLI');
        return;
    }

    if (
        chunk.includes('cursor agent') ||
        chunk.includes('cursor-agent v')
    ) {
        setAgentActive(session, 'Cursor Agent');
        return;
    }

    // AD-156 reopen #2: if the agent's detection markers have been silent for
    // > AGENT_DETECTION_STALE_MS while output is still flowing, the agent has
    // exited and the shell-prompt regex below missed it (e.g., the exit chunk
    // didn't end with `>`). Clear here so Run can't lie afterwards.
    if (expireStaleAgent(session, 'detection_stale')) return;

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
            clearActiveRunTickets(session, 'shell_prompt');
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
        clearActiveRunTickets(session, 'agent_idle');
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

    const wasAgentActive = session.agentState.active;
    session.agentInputBuffer = (session.agentInputBuffer || '') + data;
    const buf = session.agentInputBuffer;
    const newlineIndex = buf.search(/[\r\n]/);
    if (newlineIndex === -1) return data;

    const command = buf.slice(0, newlineIndex);
    session.agentInputBuffer = buf.slice(newlineIndex + 1);
    detectAgentCommand(session, command);

    if (!wasAgentActive || !command.trim()) {
        return data;
    }

    const boardData = readBoard(session.projectId);
    const explicitTicketIds = extractReferencedTicketIds(command, boardData);
    const contextualTicketIds = explicitTicketIds.length === 0 ? resolveTicketIdsFromUiContext(command, boardData) : [];
    const ticketIds = explicitTicketIds.length > 0 ? explicitTicketIds : contextualTicketIds;
    if (ticketIds.length === 0) {
        return data;
    }

    // AD-159: bare-reference guard. If the user typed nothing but ticket IDs
    // (and trivial punctuation), they're almost certainly looking it up,
    // referencing it, or testing — not declaring a run. Without this guard
    // typing `AD-158` + Enter into the agent prompt dumps the full ADHDev
    // contract block into Claude's input AND lights up the Running indicator
    // on a card nobody is actually working. Imperative phrasing like
    // `Fix AD-158` still trips the trigger because residualSignal is
    // non-empty after stripping IDs and punctuation.
    if (explicitTicketIds.length > 0) {
        const residualSignal = command
            .replace(/\b[A-Z]{2,6}-\d+\b/gi, '')
            .replace(/[^a-zA-Z0-9]/g, '');
        if (residualSignal.length === 0) {
            return data;
        }
    }

    setActiveRunTickets(session, ticketIds);
    markDeclaredRun(session.projectId, ticketIds, session.agentState.name || 'Coding Agent');

    if (alreadyIncludesAdhdevContract(command)) {
        return data;
    }

    const injection = buildInjectedExecutionContract(ticketIds, boardData, session.projectId);
    const chunkNewlineIndex = data.search(/[\r\n]/);
    if (chunkNewlineIndex === -1) {
        return `${data}${injection}`;
    }

    return `${data.slice(0, chunkNewlineIndex)}${injection}${data.slice(chunkNewlineIndex)}`;
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
        outputTail: '',
        activeRunTicketIds: [],
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
    // AD-156 reopen #2: also check on the read path so /status (which Run's
    // agentReady gate consults) reports an honest agentActive even when no
    // output has flowed since the agent exited.
    if (session) expireStaleAgent(session, 'detection_stale');
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

const httpServer = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { command, ticketId, ticketIds, batchId, projectId: rawProjectId } = JSON.parse(body);
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
                setActiveRunTickets(session, normalizedTicketIds);

                // AD-184: previously this was two separate writes
                // (command, then '\r'). On Windows ConPTY the trailing '\r'
                // could race with the running app's input handler and the
                // command would land "typed but not entered". Combine into
                // a single write so the prompt and its enter ship together.
                const commandWithEnter = (command.endsWith('\r') || command.endsWith('\n'))
                    ? command
                    : command + '\r';
                session.shell.write(commandWithEnter);

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

    res.writeHead(404);
    res.end('Not Found');
});

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
    console.log(`Terminal server running on http://localhost:${PORT} (WebSocket + HTTP)`);
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
