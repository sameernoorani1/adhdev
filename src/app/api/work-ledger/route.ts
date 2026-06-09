import { NextRequest, NextResponse } from 'next/server';
import { readFeedback } from '@/lib/feedback/core';
import { detectUntrackedWork } from '@/lib/feedback/workLedger';

// AD-338: surface the work-ledger — code changes the activity hooks recorded
// with no ticket trail. The board polls this to show an "untracked work" flag,
// making a missing trail visible instead of silently lost.
export async function GET(request: NextRequest) {
    try {
        const projectId = request.headers.get('x-adhdev-project');
        const data = readFeedback(projectId);
        return NextResponse.json(detectUntrackedWork(data.sessionActivity));
    } catch (err) {
        console.error('[ADHDev] GET /api/work-ledger error:', err);
        return NextResponse.json({ untrackedCount: 0, untrackedFiles: [], bySession: [] });
    }
}
