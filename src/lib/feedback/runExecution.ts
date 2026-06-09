import { readFeedback, resolveTicketById, writeFeedback, withFeedbackLock, type FeedbackRun, type FeedbackTicket } from './core';
import { buildAgentStartupGuidance, buildRunPrompt, type PreferredAgentPref } from './runPrompt';
import { boardSizeWarning } from './boardSizeWarning';
import { terminalAuthHeaders } from './sessionToken';
import { getCurrentGitSha } from './gitDiff';
import { getActiveProject, getProjectById } from './registry';
import { createRunRecord, markRunFailed, markRunSubmitted, upsertRun } from './runs';
import { markRunSent } from './runLifecycle';
import { buildRunContextBrief } from './runContextBrief';
import fs from 'fs';
import path from 'path';

// §5.4 follow-up: read the project's saved preferredAgent (id + variant +
// custom flags) so the startup-guidance text addresses the user with the
// agent + flags they actually picked, not the bare `claude` default.
function readPreferredAgent(projectId?: string | null): PreferredAgentPref | null {
    try {
        const project = getProjectById(projectId) || getActiveProject();
        if (!project) return null;
        const cfgPath = path.join(project.path, '.adhdev', 'config.json');
        if (!fs.existsSync(cfgPath)) return null;
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        const pref = cfg?.onboardingState?.preferredAgent;
        if (pref && typeof pref.id === 'string' && typeof pref.variantId === 'string') return pref;
        return null;
    } catch { return null; }
}

const TERMINAL_URL = 'http://localhost:3112';

export interface RunExecutionResult {
    success: boolean;
    terminal: boolean;
    agentReady: boolean;
    pendingLaunch?: boolean;
    agentName?: string | null;
    ticketIds: string[];
    prompt: string;
    message: string;
    autoOpenTerminal?: boolean;
    guidance?: string[];
    updatedTickets?: FeedbackTicket[];
    activeRun?: FeedbackRun;
}

interface AgentPromptOptions {
    agentRequirement?: 'optional' | 'required';
    taskLabel?: string;
}

interface TerminalAgentStatus {
    connected: boolean;
    agentActive: boolean;
    agentName: string | null;
}

async function getTerminalAgentStatus(projectId?: string | null): Promise<TerminalAgentStatus> {
    try {
        // AD-300: the original 2s budget timed out under load (4-shell sessions,
        // mid-cogitation), so the Run pre-flight saw `connected: false` and
        // refused to dispatch even though the user could see the agent
        // chugging in the pane. 6s comfortably covers a busy terminal server
        // without making the UI feel stuck — the /status snapshot is otherwise
        // cheap, so a longer tail is fine.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        // AD-141: scope the status probe to this project so a run on one board
        // doesn't see another board's agent state.
        const statusUrl = projectId
            ? `${TERMINAL_URL}/status?project=${encodeURIComponent(projectId)}`
            : `${TERMINAL_URL}/status`;
        const res = await fetch(statusUrl, { signal: controller.signal }).catch(() => null);
        clearTimeout(timeout);

        if (!res?.ok) {
            return { connected: false, agentActive: false, agentName: null };
        }

        const data = await res.json();
        return {
            connected: true,
            agentActive: Boolean(data.agentActive),
            agentName: data.agentName || null,
        };
    } catch {
        return { connected: false, agentActive: false, agentName: null };
    }
}

export async function executeAgentPrompt(
    prompt: string,
    projectId?: string | null,
    ticketIds?: string[],
    runId?: string | null,
    options: AgentPromptOptions = {},
): Promise<RunExecutionResult> {
    const trimmedPrompt = prompt.trim();
    const terminalStatus = await getTerminalAgentStatus(projectId);
    const preferred = readPreferredAgent(projectId);
    const guidance = buildAgentStartupGuidance(terminalStatus.agentName, preferred);

    if (!trimmedPrompt) {
        return {
            success: false,
            terminal: false,
            agentReady: false,
            agentName: null,
            ticketIds: [],
            prompt,
            message: 'No prompt was provided.',
        };
    }

    if (!terminalStatus.connected) {
        return {
            success: false,
            terminal: false,
            agentReady: false,
            agentName: terminalStatus.agentName,
            ticketIds: [],
            prompt: trimmedPrompt,
            autoOpenTerminal: true,
            message: 'Terminal is not connected. Open the terminal pane and start your coding agent.',
            guidance,
        };
    }

    if (options.agentRequirement === 'required' && !terminalStatus.agentActive) {
        return {
            success: false,
            terminal: true,
            agentReady: false,
            agentName: terminalStatus.agentName,
            ticketIds: ticketIds || [],
            prompt: trimmedPrompt,
            autoOpenTerminal: true,
            pendingLaunch: true,
            message: `${options.taskLabel || 'This task'} needs a running coding agent. Launch an agent in the terminal, then retry.`,
            guidance,
        };
    }

    // AD-142 / AD-149 reopen: the old hard-gate ("Coding agent is not running")
    // blocked Run whenever the server's output-pattern detection missed, even
    // though Claude was demonstrably running in the pane. Detection by pattern
    // matching is brittle — if the agent is past its startup banner, or the
    // terminal server restarted while the agent was already up, agentState
    // stays inactive. Removing the block: as long as the shell is connected,
    // we send the prompt through. If no agent is listening, the prompt sits
    // in the user's shell — annoying but fixable, and vastly better than
    // silently blocking a run that should work.

    try {
        const executeRes = await fetch(`${TERMINAL_URL}/execute`, {
            method: 'POST',
            // AD-204: forward the session token to the terminal server.
            headers: { 'Content-Type': 'application/json', ...terminalAuthHeaders() },
            body: JSON.stringify({
                command: trimmedPrompt,
                // AD-141: pin the command to the caller's project so two tabs
                // on different boards can no longer write to each other's shell.
                projectId: projectId ?? undefined,
                // AD-149: pass the tickets this Run covers so the server can
                // populate activeRunTicketIds and the /api/terminal-status poll
                // lights up every affected card — not just whichever still sits
                // inside the client-side fallback freshness window.
                ticketIds: ticketIds && ticketIds.length > 0 ? ticketIds : undefined,
                runId: runId || undefined,
            }),
        });

        if (!executeRes.ok) {
            throw new Error(`Terminal server responded with ${executeRes.status}`);
        }
    } catch (err) {
        console.error('[ADHDev] executeAgentPrompt /execute error:', err);
        return {
            success: false,
            terminal: true,
            agentReady: true,
            agentName: terminalStatus.agentName,
            ticketIds: [],
            prompt: trimmedPrompt,
            message: 'Failed to send the prompt to the coding agent.',
        };
    }

    // AD-142/AD-149 reopen: when detection is uncertain, still return success
    // so the Run isn't blocked, but tailor the toast so the user knows to start
    // claude if it isn't already running.
    const actor = terminalStatus.agentName || preferred?.id || 'Coding Agent';
    const message = terminalStatus.agentActive
        ? `Sent prompt to ${actor}.`
        : 'Sent prompt to the terminal. If your coding agent isn\'t running, start it and press Enter to submit.';
    return {
        success: true,
        terminal: true,
        agentReady: terminalStatus.agentActive,
        agentName: actor,
        ticketIds: [],
        prompt: trimmedPrompt,
        message,
    };
}

export async function executeRunPrompt(ticketIds: string[], projectId?: string | null, options: AgentPromptOptions = {}): Promise<RunExecutionResult> {
    const ids = Array.from(new Set(ticketIds.map(id => id.trim()).filter(Boolean)));
    const contextBrief = ids.length > 0 ? buildRunContextBrief(readFeedback(projectId), ids) : '';
    const prompt = buildRunPrompt(ids, boardSizeWarning(), contextBrief);

    if (ids.length === 0) {
        return {
            success: false,
            terminal: false,
            agentReady: false,
            ticketIds: [],
            prompt,
            message: 'No tickets were provided.',
        };
    }

    const terminalStatus = await getTerminalAgentStatus(projectId);
    const preferred = readPreferredAgent(projectId);
    const guidance = buildAgentStartupGuidance(terminalStatus.agentName, preferred);
    if (!terminalStatus.connected) {
        return {
            success: false,
            terminal: false,
            agentReady: false,
            agentName: terminalStatus.agentName,
            ticketIds: [],
            prompt,
            autoOpenTerminal: true,
            message: 'Terminal is not connected. Open the terminal pane and start your coding agent.',
            guidance,
        };
    }

    if (options.agentRequirement === 'required' && !terminalStatus.agentActive) {
        return {
            success: false,
            terminal: true,
            agentReady: false,
            agentName: terminalStatus.agentName,
            ticketIds: ids,
            prompt,
            autoOpenTerminal: true,
            pendingLaunch: true,
            message: `${options.taskLabel || 'This run'} needs a running coding agent. Launch an agent in the terminal, then retry.`,
            guidance,
        };
    }

    const runId = `run-${Date.now().toString(36)}-${ids.join('-').toLowerCase()}`;
    const actor = terminalStatus.agentName || preferred?.id || 'Coding Agent';
    const project = getProjectById(projectId) || getActiveProject();
    const startedRef = project ? (getCurrentGitSha(project.path) ?? undefined) : undefined;

    const prepared = await withFeedbackLock(projectId, async () => {
        const data = readFeedback(projectId);
        const resolvedTickets: Array<{ index: number; ticket: FeedbackTicket }> = [];

        for (const ticketId of ids) {
            const resolved = resolveTicketById(data, ticketId);
            if (!resolved.ok) {
                return {
                    success: false,
                    terminal: false,
                    agentReady: false,
                    ticketIds: ids,
                    prompt,
                    message: resolved.error || `Ticket ${ticketId} not found.`,
                };
            }

            resolvedTickets.push({ index: resolved.index!, ticket: resolved.ticket! });
        }

        // AD-149: pass the resolved ids through so the terminal server can
        // populate activeRunTicketIds — the live /api/terminal-status poll becomes
        // authoritative and every affected card lights up, regardless of status.
        const activeRun = createRunRecord({ runId, projectId, ticketIds: ids, agent: actor, nowIso: new Date().toISOString(), startedRef, source: 'ui-run' });
        upsertRun(data, activeRun);

        // AD-184: reports of "coding agent isn't working" toasts firing
        // even when the prompt visibly executed. Root cause: the AD-156 gate
        // below was using the same brittle pattern-match detection that AD-149
        // already removed from the execute step. The prompt has already been
        // sent at this point — refusing to claim the ticket because detection
        // missed leaves the user with the worst of both worlds (work happens,
        // toast says it didn't).
        //
        // Trust the click. If the shell is connected and /execute succeeded,
        // run the claim flow. If detection wasn't sure, surface that as an
        // informational toast (already set in executeAgentPrompt's message),
        // not as a failure. Worst case the prompt sits in a bare shell — same
        // outcome as before, but no false-failure toast.
        const now = new Date().toISOString();
        // AD-269: live running state now lives in activeRuns. Ticket execution
        // remains the durable completion receipt.
        // AD-240: capture HEAD SHA so the done-time diff has a baseline.
        // Silent null when the project isn't a git repo.
        const updatedTickets: FeedbackTicket[] = [];

        for (const { index, ticket } of resolvedTickets) {
            const planComment = {
                id: `c-${Date.now().toString(36)}-${index}`,
                author: actor,
                authorType: 'ai' as const,
                content: `**Claiming ticket.** Run ${runId} triggered from ADHDev for ${ticket.id}. Will inspect the ticket, implement the requested change, and report back here.`,
                images: [],
                createdAt: now,
            };
            const updatedTicket: FeedbackTicket = {
                ...ticket,
                comments: [...(ticket.comments || []), planComment],
                activity: [
                    ...(ticket.activity || []),
                    { action: 'run_triggered', by: actor, byType: 'ai', at: now },
                    { action: 'run_dispatching', by: actor, byType: 'ai', at: now },
                ],
                updatedAt: now,
            };

            data.tickets[index] = updatedTicket;
            updatedTickets.push(updatedTicket);
        }

        writeFeedback(data, projectId);

        return { updatedTickets, activeRun };
    });

    if ('success' in prepared && prepared.success === false) return prepared;

    const executionResult = await executeAgentPrompt(prompt, projectId, ids, runId);
    const completedAt = new Date().toISOString();
    let activeRun = prepared.activeRun;

    await withFeedbackLock(projectId, () => {
        const data = readFeedback(projectId);
        if (executionResult.success) {
            // AD-341: the prompt was dispatched to a terminal where an agent is
            // ALIVE — that IS the agent working it, so animate immediately. No
            // claim handshake (agents don't reliably claim; the dispatcher's own
            // placeholder claim even gets the agent's agent-claim rejected as
            // stale). If NO agent is present, keep it 'dispatching' ("Sending")
            // rather than falsely showing "running".
            if (terminalStatus.agentActive) {
                markRunSubmitted(data, runId, completedAt);
            } else {
                markRunSent(data, runId, completedAt);
            }
        } else {
            markRunFailed(data, runId, completedAt, executionResult.message || 'Failed to dispatch run to terminal.');
            const idSet = new Set(ids.map(id => id.toUpperCase()));
            for (const ticket of data.tickets) {
                if (!idSet.has(String(ticket.id || '').toUpperCase())) continue;
                ticket.activity = [
                    ...(ticket.activity || []),
                    { action: 'run_dispatch_failed', by: actor, byType: 'ai', at: completedAt },
                ];
                ticket.updatedAt = completedAt;
            }
        }
        activeRun = data.activeRuns?.find(run => run.runId === runId) || activeRun;
        writeFeedback(data, projectId);
    });

    if (!executionResult.success) {
        return {
            ...executionResult,
            ticketIds: ids,
            updatedTickets: prepared.updatedTickets,
            activeRun,
        };
    }

    return {
        success: true,
        terminal: true,
        agentReady: executionResult.agentReady,
        agentName: actor,
        ticketIds: ids,
        prompt,
        message: ids.length === 1 ? `Sent ${ids[0]} to ${actor}.` : `Sent ${ids.length} tickets to ${actor}.`,
        updatedTickets: prepared.updatedTickets,
        activeRun,
    };
}
