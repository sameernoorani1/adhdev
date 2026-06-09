import { NextRequest } from 'next/server';
import { readFeedback, writeFeedback, withFeedbackLock, resolveTicketById } from '@/lib/feedback/core';
import { terminalAuthHeaders } from '@/lib/feedback/sessionToken';
import { getCurrentGitSha } from '@/lib/feedback/gitDiff';
import { getActiveProject, getProjectById } from '@/lib/feedback/registry';
import { createRunRecord, markRunFailed, upsertRun } from '@/lib/feedback/runs';
import { markRunSent } from '@/lib/feedback/runLifecycle';

/**
 * POST /api/run-terminal
 * Sends a command to the terminal to execute a ticket
 *
 * Body: { ticketId: string, mode: 'claude-code' | 'prompt' }
 *
 * This will send the appropriate command to the terminal WebSocket server
 * for execution within the terminal session.
 */
export async function POST(request: NextRequest) {
    try {
        const { ticketId, mode = 'claude-code' } = await request.json();
        if (!ticketId) return Response.json({ error: 'Required: ticketId' }, { status: 400 });

        // AD-141: scope reads and the downstream /execute call to the caller's
        // project so tabs on different boards don't cross-wire.
        const projectId = request.headers.get('x-adhdev-project');
        const runId = `run-${Date.now().toString(36)}-${String(ticketId).toLowerCase()}`;
        const lockResult = await withFeedbackLock(projectId, () => {
            const data = readFeedback(projectId);
            const resolved = resolveTicketById(data, ticketId);
            if (!resolved.ok) {
                return { error: { message: resolved.error, status: resolved.status || 404 } };
            }

            const ticket = resolved.ticket!;
            const now = new Date().toISOString();
            const idx = resolved.index!;
            data.tickets[idx].comments = [
                ...(data.tickets[idx].comments || []),
                {
                    id: `c-${Date.now().toString(36)}`,
                    author: mode === 'claude-code' ? 'Claude Code' : 'Terminal',
                    authorType: 'ai',
                    content: `**Claiming ticket.** Terminal run ${runId} declared for ${ticket.id}. Will inspect the ticket, work the request, and post a completion update here.`,
                    images: [],
                    createdAt: now,
                },
            ];
            // AD-240: capture git HEAD as the diff baseline.
            const project = getProjectById(projectId) || getActiveProject();
            const startedRef = project ? (getCurrentGitSha(project.path) ?? undefined) : undefined;
            const actor = mode === 'claude-code' ? 'Claude Code' : 'Terminal';
            upsertRun(data, createRunRecord({
                runId,
                projectId,
                ticketIds: [ticket.id],
                agent: actor,
                nowIso: now,
                startedRef,
                source: 'terminal-run',
            }));
            if (!data.tickets[idx].activity) data.tickets[idx].activity = [];
            data.tickets[idx].activity.push({
                action: 'claimed',
                by: actor,
                byType: 'ai',
                at: now
            });
            data.tickets[idx].activity.push({
                action: 'run_dispatching',
                by: actor,
                byType: 'ai',
                at: now
            });
            data.tickets[idx].updatedAt = now;
            writeFeedback(data, projectId);
            return { ticket };
        });

        if (lockResult.error) {
            return Response.json({ error: lockResult.error.message }, { status: lockResult.error.status });
        }
        const ticket = lockResult.ticket!;

        // Build prompt from ticket context
        const prompt = [
            `Work on ticket ${ticket.id}: ${ticket.title}`,
            '',
            ticket.description ? `Description: ${ticket.description}` : '',
            `Priority: ${ticket.priority}`,
            `Status: ${ticket.status}`,
            `Type: ${ticket.ticketType}`,
            '',
            ticket.comments.length > 0
                ? `Recent comments:\n${ticket.comments.slice(-5).map(c => `[${c.author}]: ${c.content.slice(0, 200)}`).join('\n')}`
                : '',
            '',
            'After completing work, summarize what you changed.',
        ].filter(Boolean).join('\n');

        // Generate command based on mode
        let command: string;
        if (mode === 'claude-code') {
            // AD-128: the official `@anthropic-ai/claude-code` package exposes a
            // bin named `claude` (not `claude-code`). Using `-p <pkg> claude`
            // tells npx explicitly which package to fetch and which bin to run,
            // regardless of whatever stale `claude` (or the unrelated `claude-code`
            // npm package) may be on PATH.
            const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
            command = `npx --yes -p @anthropic-ai/claude-code@latest claude "${escapedPrompt}"`;
        } else {
            // Just echo the prompt for manual use
            command = `echo "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
        }

        // Send command to terminal via WebSocket
        // We'll use a simple HTTP endpoint that the terminal server can expose
        try {
            const response = await fetch('http://localhost:3112/execute', {
                method: 'POST',
                // AD-204: forward the session token to the terminal server.
                headers: { 'Content-Type': 'application/json', ...terminalAuthHeaders() },
                body: JSON.stringify({ command, ticketId, projectId: projectId ?? undefined, runId }),
            });

            if (!response.ok) {
                throw new Error(`Terminal server responded with ${response.status}`);
            }
            await withFeedbackLock(projectId, () => {
                const data = readFeedback(projectId);
                // AD-269: prompt sent ≠ running. Keep the lease 'dispatching'
                // until the agent claims; it self-expires if no claim arrives.
                markRunSent(data, runId, new Date().toISOString());
                writeFeedback(data, projectId);
            });
        } catch (err) {
            console.error('[ADHDev] POST /api/run-terminal terminal-server fallback:', err);
            await withFeedbackLock(projectId, () => {
                const data = readFeedback(projectId);
                markRunFailed(data, runId, new Date().toISOString(), 'Terminal server not available. Run the command manually in your terminal.');
                writeFeedback(data, projectId);
            });
            // Fallback: return the command for manual execution
            return Response.json({
                success: false,
                command,
                error: 'Terminal server not available. Run the command manually in your terminal.',
                ticketId
            });
        }

        return Response.json({
            success: true,
            command,
            ticketId,
            message: 'Command sent to terminal'
        });
    } catch (err) {
        console.error('[ADHDev] POST /api/run-terminal error:', err);
        return Response.json({ error: String(err) }, { status: 500 });
    }
}
