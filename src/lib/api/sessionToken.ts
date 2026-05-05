// AD-204: browser-side accessor for the terminal-server session token. The
// token is fetched once via /api/session-token (Next.js reads it from
// ~/.adhdev/session-token) and cached for the page session. Required by:
//   - direct fetches to http://localhost:3112/* (ui-context, reset-history)
//   - the terminal WebSocket upgrade (?token=<value>)
//
// The Next.js endpoint refuses to hand out the token to non-localhost origins,
// and the terminal server itself is bound to 127.0.0.1, so the token only
// leaks if the user's own browser running on the user's own machine asks for
// it -- which is the trust boundary we already accept for a local-first tool.

let cached: Promise<string | null> | null = null;

export function getSessionToken(): Promise<string | null> {
    if (cached) return cached;
    cached = fetch('/api/session-token', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then((d: { token: string } | null) => d?.token || null)
        .catch(() => null);
    return cached;
}

// Force-refresh: drop the cached token Promise so the next getSessionToken()
// call re-fetches from /api/session-token. Wired into the 401-retry path in
// fetchWithAdhdevToken below and into the WS reconnection path in
// TerminalPane (an upgrade rejection during handshake counts as the WS-tier
// equivalent of a 401).
export function invalidateSessionToken(): void {
    cached = null;
}

export async function withAdhdevToken(headers: HeadersInit = {}): Promise<Record<string, string>> {
    const token = await getSessionToken();
    const base = headers as Record<string, string>;
    return token ? { ...base, 'x-adhdev-token': token } : { ...base };
}

// AD-204 follow-up: call any localhost:3112 endpoint with the current token,
// and on a 401 (token rotated, e.g. terminal server restarted) drop the cache
// and retry exactly once with a fresh token. Open browser tabs no longer need
// a manual reload to recover.
export async function fetchWithAdhdevToken(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const headers = await withAdhdevToken(init.headers ?? {});
    const res = await fetch(input, { ...init, headers });
    if (res.status !== 401) return res;
    invalidateSessionToken();
    const retryHeaders = await withAdhdevToken(init.headers ?? {});
    return fetch(input, { ...init, headers: retryHeaders });
}
