import { NextRequest, NextResponse } from 'next/server';
import { readSessionToken } from '@/lib/feedback/sessionToken';

// AD-204: hand the terminal-server session token to same-origin browser code
// so the WebSocket connection in TerminalPane can carry `?token=<value>` on
// connect. Same-origin gate: only requests from `localhost:3111` /
// `127.0.0.1:3111` are answered. The Next.js server itself is bound to
// 127.0.0.1 (cli/index.mjs), so the network surface is already small — this
// is the second line of defense.

const ALLOWED_ORIGINS = new Set([
    'http://localhost:3111',
    'http://127.0.0.1:3111',
]);

export async function GET(request: NextRequest) {
    const origin = request.headers.get('origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }
    const token = readSessionToken();
    if (!token) {
        return NextResponse.json({ error: 'Token not yet available — terminal server may be starting' }, { status: 503 });
    }
    return NextResponse.json({ token }, {
        headers: { 'Cache-Control': 'no-store' },
    });
}
