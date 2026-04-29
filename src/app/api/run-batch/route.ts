import { NextRequest } from 'next/server';
import { executeRunPrompt } from '@/lib/feedback/runExecution';

/**
 * POST /api/run-batch
 * Compatibility wrapper for running multiple tickets through the same coding-agent flow.
 */
export async function POST(request: NextRequest) {
    try {
        const { ticketIds, mode = 'claude-code', execution = 'sequential', target = 'terminal' } = await request.json();

        if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
            return Response.json({ error: 'Required: ticketIds array' }, { status: 400 });
        }

        const result = await executeRunPrompt(ticketIds);
        return Response.json({
            ...result,
            mode,
            execution,
            target,
        }, { status: result.success ? 200 : 409 });
    } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
    }
}
