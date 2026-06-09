import { NextResponse } from 'next/server';
import { readFeedback, resolveTicketById, checkAdmin } from '@/lib/feedback/core';
import { readPendingMentions } from '@/lib/feedback/pendingMentions';

export async function GET(request: Request) {
    const auth = await checkAdmin();
    if (!auth.authorized) return auth.error!;

    try {
        const { searchParams } = new URL(request.url);
        const agent = (searchParams.get('agent') || '').toLowerCase();
        const data = readFeedback();
        const pending = readPendingMentions()
            .filter((mention) => !agent || mention.targetAgent === agent || mention.targetAgent === 'ai')
            .map((mention) => {
                const resolved = resolveTicketById(data, mention.ticketId);
                const ticket = resolved.ok ? resolved.ticket : null;
                return ticket ? {
                    id: ticket.id,
                    title: ticket.title,
                    status: ticket.status,
                    targetAgent: mention.targetAgent,
                    mentionComment: {
                        author: 'human',
                        content: mention.excerpt,
                        createdAt: mention.mentionedAt,
                    },
                } : null;
            })
            .filter(Boolean);

        return NextResponse.json({
            hasPending: pending.length > 0,
            count: pending.length,
            tickets: pending,
        });
    } catch (err) {
        console.error('[ADHDev] GET /api/feedback/pending-mentions error:', err);
        return NextResponse.json({ error: 'Failed to check pending mentions' }, { status: 500 });
    }
}
