import { NextRequest, NextResponse } from 'next/server';
import { readFeedback, writeFeedback, checkAdmin } from '@/lib/feedback/core';

function getProjectId(request: NextRequest): string | null {
    return request.headers.get('x-adhdev-project');
}

// GET — return all batches
export async function GET(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    const data = readFeedback(getProjectId(request));
    return NextResponse.json(data.batches || []);
}

// POST — create one or more batches
// Body: { batches: [{ name, ticketIds, source, rationale? }] } or single { name, ticketIds, source, rationale? }
export async function POST(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    const body = await request.json();
    const projectId = getProjectId(request);
    const data = readFeedback(projectId);
    if (!data.batches) data.batches = [];

    const incoming = Array.isArray(body.batches) ? body.batches : [body];
    const created = [];

    let nextNum = data.batches.length > 0
        ? Math.max(...data.batches.map(x => {
            const m = x.id.match(/batch-(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        })) + 1
        : 1;

    for (const b of incoming) {
        if (!b.name || !Array.isArray(b.ticketIds) || b.ticketIds.length === 0) {
            return NextResponse.json(
                { error: 'Each batch requires name (string) and ticketIds (non-empty array)' },
                { status: 400 }
            );
        }
        const batch = {
            id: `batch-${nextNum}`,
            name: b.name,
            ticketIds: b.ticketIds,
            createdAt: new Date().toISOString(),
            source: b.source || 'ai' as const,
            reviewState: b.reviewState || ((b.source || 'ai') === 'ai' ? 'suggested' : 'accepted'),
            rationale: b.rationale || undefined,
        };
        data.batches.push(batch);
        created.push(batch);
        nextNum++;
    }

    writeFeedback(data, projectId);
    return NextResponse.json({ created }, { status: 201 });
}

// DELETE — clear all batches, or delete one by ?id=batch-N
export async function DELETE(request: NextRequest) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    const id = request.nextUrl.searchParams.get('id');
    const projectId = getProjectId(request);
    const data = readFeedback(projectId);
    if (!data.batches) data.batches = [];

    if (id) {
        data.batches = data.batches.filter(b => b.id !== id);
    } else {
        data.batches = [];
    }

    writeFeedback(data, projectId);
    return NextResponse.json({ ok: true });
}
