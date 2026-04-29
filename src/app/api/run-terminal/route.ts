import { NextRequest } from 'next/server';
import { readFeedback, writeFeedback, resolveTicketById } from '@/lib/feedback/core';

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
        const data = readFeedback(projectId);
        const resolved = resolveTicketById(data, ticketId);
        if (!resolved.ok) return Response.json({ error: resolved.error }, { status: resolved.status || 404 });

        const ticket = resolved.ticket!;

        // Mark ticket as in-progress
        const now = new Date().toISOString();
        const idx = resolved.index!;
        data.tickets[idx].comments = [
            ...(data.tickets[idx].comments || []),
            {
                id: `c-${Date.now().toString(36)}`,
                author: mode === 'claude-code' ? 'Claude Code' : 'Terminal',
                authorType: 'ai',
                content: `**Claiming ticket.** Terminal run declared for ${ticket.id}. Will inspect the ticket, work the request, and post a completion update here.`,
                images: [],
                createdAt: now,
            },
        ];
        data.tickets[idx].execution = {
            runId: `run-${Date.now().toString(36)}`,
            actor: mode === 'claude-code' ? 'Claude Code' : 'Terminal',
            actorType: 'ai',
            status: 'in_progress',
            startedAt: now,
            updatedAt: now,
            filesTouched: [],
            verification: [],
        };
        if (!data.tickets[idx].activity) data.tickets[idx].activity = [];
        data.tickets[idx].activity.push({
            action: 'claimed',
            by: mode === 'claude-code' ? 'Claude Code' : 'Terminal',
            byType: 'ai',
            at: now
        });
        data.tickets[idx].activity.push({
            action: 'execution_started',
            by: mode === 'claude-code' ? 'Claude Code' : 'Terminal',
            byType: 'ai',
            at: now
        });
        data.tickets[idx].updatedAt = now;
        writeFeedback(data, projectId);

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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command, ticketId, projectId: projectId ?? undefined }),
            });

            if (!response.ok) {
                throw new Error(`Terminal server responded with ${response.status}`);
            }
        } catch (err) {
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
        return Response.json({ error: String(err) }, { status: 500 });
    }
}
