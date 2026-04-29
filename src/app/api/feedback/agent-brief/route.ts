import { NextResponse } from 'next/server';
import { readFeedback, getDefaultAgentRules, checkAdmin } from '@/lib/feedback/core';
import { prioritizeTickets } from '@/lib/feedback/prioritize';

export async function GET(request: Request) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const { searchParams } = new URL(request.url);
        const agent = (searchParams.get('agent') || '').toLowerCase();
        const data = readFeedback();
        const rules = data.agentRules || getDefaultAgentRules();
        const { workQueue, summary } = prioritizeTickets(data.tickets, rules, agent || undefined);

        return NextResponse.json({
            generatedAt: new Date().toISOString(),
            agentRules: rules,
            workQueue,
            summary,
        });
    } catch {
        return NextResponse.json({ error: 'Failed to generate agent brief' }, { status: 500 });
    }
}
