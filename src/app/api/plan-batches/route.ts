import { NextRequest, NextResponse } from 'next/server';
import { executeAgentPrompt } from '@/lib/feedback/runExecution';
import { buildBatchPlanningPrompt } from '@/lib/feedback/runPrompt';

export async function POST(request: NextRequest) {
    try {
        const { mode = 'full', ticketIds } = await request.json();
        const normalizedMode = mode === 'incremental' ? 'incremental' : 'full';
        const normalizedTicketIds = Array.isArray(ticketIds)
            ? ticketIds.map((id: unknown) => String(id).trim()).filter(Boolean)
            : [];

        const prompt = buildBatchPlanningPrompt(normalizedMode, normalizedTicketIds);
        const result = await executeAgentPrompt(prompt);

        return NextResponse.json({
            ...result,
            mode: normalizedMode,
            ticketIds: normalizedTicketIds,
        }, { status: result.success ? 200 : 409 });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
