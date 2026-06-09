import { NextRequest, NextResponse } from 'next/server';
import { readFeedback, writeFeedback, withFeedbackLock, type SessionActivityEntry } from '@/lib/feedback/core';

/**
 * POST /api/hooks/activity
 *
 * Receives Claude Code hook events (PostToolUse, SessionStart, Stop, Notification)
 * and logs them to the active project's board.
 *
 * If a ticket ID is found in the session context (via tool_input or a header),
 * the activity is attached to that ticket. Otherwise it goes to a session-level log.
 *
 * Input: Claude Code hook JSON (piped from stdin or HTTP hook)
 */

interface HookPayload {
    session_id?: string;
    hook_event_name?: string;
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_result?: unknown;
    tool_error?: string | null;
    cwd?: string;
    // Custom header for ticket association
    ticket_id?: string;
}

// Extract useful summary from a tool use event
function summarizeToolUse(payload: HookPayload): { action: string; detail: string; file?: string } {
    const tool = payload.tool_name || 'unknown';
    const input = payload.tool_input || {};

    switch (tool) {
        case 'Write':
            return { action: 'file_created', detail: `Created ${input.file_path}`, file: input.file_path as string };
        case 'Edit':
            return { action: 'file_edited', detail: `Edited ${input.file_path}`, file: input.file_path as string };
        case 'Read':
            return { action: 'file_read', detail: `Read ${input.file_path}`, file: input.file_path as string };
        case 'Bash': {
            const cmd = (input.command as string) || '';
            const short = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
            return { action: 'command_run', detail: `Ran: ${short}` };
        }
        case 'Grep':
            return { action: 'search', detail: `Searched for "${input.pattern}"` };
        case 'Glob':
            return { action: 'search', detail: `Found files matching "${input.pattern}"` };
        default:
            return { action: 'tool_use', detail: `Used ${tool}` };
    }
}

// Try to find a ticket ID from the session context
function findTicketId(payload: HookPayload, headerTicketId?: string): string | null {
    // Explicit header takes priority
    if (headerTicketId) return headerTicketId;
    // Check if payload has it
    if (payload.ticket_id) return payload.ticket_id;
    return null;
}

export async function POST(request: NextRequest) {
    try {
        const payload: HookPayload = await request.json();
        const headerTicketId = request.headers.get('x-adhdev-ticket') || undefined;
        const eventName = payload.hook_event_name || 'unknown';

        return await withFeedbackLock(null, () => {
        const data = readFeedback();
        const now = new Date().toISOString();
        const sessionId = payload.session_id || 'unknown';

        if (!data.sessionActivity) data.sessionActivity = [];
        const sessionActivity = data.sessionActivity;

        if (eventName === 'PostToolUse' || eventName === 'PostToolUseFailure') {
            const summary = summarizeToolUse(payload);
            const ticketId = findTicketId(payload, headerTicketId);

            const entry: SessionActivityEntry = {
                type: 'tool_use',
                sessionId,
                ticketId: ticketId || null,
                tool: payload.tool_name,
                action: summary.action,
                detail: summary.detail,
                file: summary.file || null,
                error: eventName === 'PostToolUseFailure' ? (payload.tool_error || 'Failed') : null,
                at: now,
            };

            // If we have a ticket, also add to the ticket's activity
            if (ticketId) {
                const ticket = data.tickets.find(t => t.id === ticketId);
                if (ticket) {
                    if (!ticket.activity) ticket.activity = [];
                    ticket.activity.push({
                        action: summary.action,
                        by: 'Claude Code',
                        byType: 'ai',
                        at: now,
                    });

                    // Track files touched in execution metadata.
                    // AD-247: heartbeat-ONLY. Hook activity records file
                    // edits onto an *already-running* execution; it no longer
                    // creates a fresh in_progress execution on a ticket that
                    // has none. Sameer's spec on AD-232 / AD-244: Running
                    // state must come from the UI Run button alone — hooks
                    // are a side-channel signal and shouldn't promote.
                    if (summary.file && (summary.action === 'file_created' || summary.action === 'file_edited')) {
                        if (ticket.execution?.status === 'in_progress') {
                            if (!ticket.execution.filesTouched.includes(summary.file)) {
                                ticket.execution.filesTouched.push(summary.file);
                            }
                            ticket.execution.updatedAt = now;
                        }
                    }

                    ticket.updatedAt = now;
                }
            }

            sessionActivity.push(entry);

        } else if (eventName === 'SessionStart') {
            sessionActivity.push({
                type: 'session_start',
                sessionId,
                cwd: payload.cwd || null,
                at: now,
            });

        } else if (eventName === 'Stop') {
            sessionActivity.push({
                type: 'session_stop',
                sessionId,
                at: now,
            });

        } else if (eventName === 'Notification') {
            sessionActivity.push({
                type: 'notification',
                sessionId,
                detail: typeof payload.tool_result === 'string' ? payload.tool_result : JSON.stringify(payload.tool_result),
                at: now,
            });
        }

        // Keep session activity bounded (last 500 entries)
        if (sessionActivity.length > 500) {
            sessionActivity.splice(0, sessionActivity.length - 500);
        }

        writeFeedback(data);

        return NextResponse.json({ received: true, event: eventName });
        });
    } catch (err) {
        console.error('[ADHDev] POST /api/hooks/activity error:', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

// GET — return recent session activity (for the activity feed UI)
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '50', 10);
        const ticketId = searchParams.get('ticket') || undefined;
        const sessionId = searchParams.get('session') || undefined;
        const actionType = searchParams.get('action') || undefined;

        const data = readFeedback();
        let activity: SessionActivityEntry[] = data.sessionActivity || [];

        // Filters
        if (ticketId) activity = activity.filter(a => a.ticketId === ticketId);
        if (sessionId) activity = activity.filter(a => a.sessionId === sessionId);
        if (actionType) activity = activity.filter(a => a.action === actionType || a.type === actionType);

        // Return newest first, limited
        const result = activity.slice(-limit).reverse();

        return NextResponse.json({ activity: result, total: activity.length });
    } catch (err) {
        console.error('[ADHDev] GET /api/hooks/activity error:', err);
        return NextResponse.json({ activity: [], total: 0 });
    }
}
