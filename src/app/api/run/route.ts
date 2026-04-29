import { NextRequest } from 'next/server';
import { executeRunPrompt } from '@/lib/feedback/runExecution';
import { recordOnboardingEvent } from '@/lib/feedback/onboardingEvents';

/**
 * POST /api/run
 * Sends a minimal prompt to the currently running coding agent.
 *
 * Body: { ticketId?: string, ticketIds?: string[] }
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const ticketIds = Array.isArray(body.ticketIds)
            ? body.ticketIds
            : body.ticketId
                ? [body.ticketId]
                : [];

        if (ticketIds.length === 0) {
            return Response.json({ error: 'Required: ticketId or ticketIds' }, { status: 400 });
        }

        // AD-139: pass the board-view project so Run resolves tickets from the
        // board the user is actually viewing, not the registry's active project.
        const projectId = request.headers.get('x-adhdev-project');
        const result = await executeRunPrompt(ticketIds, projectId);
        // AD-138: record first successful run (write-once).
        if (result.success) {
            recordOnboardingEvent('firstRunAt', projectId);
        }
        return Response.json(result, { status: result.success ? 200 : 409 });
    } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
    }
}
