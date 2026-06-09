// AD-346: CSRF / confused-deputy perimeter for the board API.
//
// The board API on :3111 runs state-changing endpoints (/api/install-claude,
// /api/launch-agent, /api/run-terminal, /api/feedback, /api/chat, ...) that,
// before this, accepted a POST from any origin with no checks. That let any web
// page the user visited fire cross-origin requests at the local board — a
// classic confused-deputy / CSRF vector (e.g. trigger `npm i -g`, or plant a
// ticket then dispatch the agent on it). A text/plain body skips the CORS
// preflight, but the browser STILL attaches an `Origin` header to any
// cross-origin POST and page JS cannot suppress it — so an origin allowlist
// reliably blocks the attack.
//
// This middleware runs on the Edge runtime (header-only, no fs), so it does the
// origin / Sec-Fetch-Site gate. The token check for non-browser callers (no
// Origin header) lives in `checkAdmin` on the Node side, which can read the
// session-token file. GET requests are never gated here so the agent can curl
// read endpoints without a token.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const ALLOWED_ORIGINS = new Set([
    'http://localhost:3111',
    'http://127.0.0.1:3111',
]);

/**
 * Pure, Edge-safe decision: should this request be rejected (403) at the
 * perimeter? Returns a reason string to reject, or null to allow.
 *
 * Only state-changing methods are gated. A request with no `Origin` header is
 * allowed through here (it is a non-browser caller — agent CLI / curl — which
 * the Node-side token guard authenticates); the point of this layer is to stop
 * a *browser* on another origin, which is forced to send `Origin`.
 */
export function csrfRejectReason(
    method: string,
    origin: string | null,
    secFetchSite: string | null,
): string | null {
    if (!STATE_CHANGING.has(method.toUpperCase())) return null;

    // A browser always attaches Origin to a cross-origin request (even a
    // text/plain "simple" POST that skips preflight). Reject any origin we
    // don't own.
    if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
        return `cross-origin request blocked (origin: ${origin})`;
    }

    // Defense in depth: Sec-Fetch-Site is browser-set and not forgeable by page
    // JS. The board UI is same-origin, so anything other than same-origin/none
    // on a state-changing request is not a legitimate board action.
    if (secFetchSite !== null && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
        return `cross-site request blocked (sec-fetch-site: ${secFetchSite})`;
    }

    return null;
}

export function middleware(request: NextRequest): NextResponse {
    const reason = csrfRejectReason(
        request.method,
        request.headers.get('origin'),
        request.headers.get('sec-fetch-site'),
    );
    if (reason) {
        return NextResponse.json({ error: `Forbidden: ${reason}` }, { status: 403 });
    }
    return NextResponse.next();
}

// Gate every API route. The middleware itself no-ops on GET and on same-origin
// requests, so reads and normal board actions are unaffected; only cross-origin
// state-changing requests are rejected.
export const config = {
    matcher: '/api/:path*',
};
