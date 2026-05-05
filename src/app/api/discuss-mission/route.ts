import { NextRequest, NextResponse } from 'next/server';
import { executeAgentPrompt } from '@/lib/feedback/runExecution';

export async function POST(request: NextRequest) {
    try {
        const { missionId } = await request.json();
        if (!missionId) {
            return NextResponse.json({ error: 'Required: missionId' }, { status: 400 });
        }

        const prompt = [
            `Discuss mission ${missionId}.`,
            'Read ADHDEV.md and .adhdev/board.json for the mission workflow rules, full mission details, linked tickets, current mission plan, decision log, and current board state.',
            'Help refine the plan, challenge weak assumptions, identify missing work, and recommend the next concrete steps.',
            'Do not start implementation unless explicitly asked. Focus on planning, architecture, sequencing, and risk.',
        ].join('\n');

        const result = await executeAgentPrompt(prompt);
        return NextResponse.json({
            ...result,
            missionId,
        }, { status: result.success ? 200 : 409 });
    } catch (err) {
        console.error('[ADHDev] POST /api/discuss-mission error:', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
