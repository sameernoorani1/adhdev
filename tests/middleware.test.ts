import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { csrfRejectReason, ALLOWED_ORIGINS } from '@/middleware';
import { tokenGuardReason } from '@/lib/feedback/core';

// AD-346: CSRF / confused-deputy perimeter.

describe('csrfRejectReason — edge origin/Sec-Fetch gate', () => {
    it('never gates read (GET) requests', () => {
        expect(csrfRejectReason('GET', 'https://evil.example', 'cross-site')).toBeNull();
    });

    it('rejects a cross-origin state-changing POST (a text/plain "simple" POST still carries Origin)', () => {
        expect(csrfRejectReason('POST', 'https://evil.example', null)).toMatch(/cross-origin/);
    });

    it('rejects cross-site via Sec-Fetch-Site even when Origin is absent', () => {
        expect(csrfRejectReason('POST', null, 'cross-site')).toMatch(/cross-site/);
        expect(csrfRejectReason('DELETE', null, 'same-site')).toMatch(/cross-site/);
    });

    it('allows same-origin board actions', () => {
        expect(csrfRejectReason('POST', 'http://localhost:3111', 'same-origin')).toBeNull();
        expect(csrfRejectReason('PATCH', 'http://127.0.0.1:3111', 'same-origin')).toBeNull();
    });

    it('passes a no-Origin non-browser caller through the edge (the token gate authenticates it)', () => {
        expect(csrfRejectReason('POST', null, null)).toBeNull();
    });

    it('rejects an opaque "Origin: null" (sandboxed iframe / data: URL) — the string "null" is NOT the absent header', () => {
        // request.headers.get('origin') returns the STRING "null" for a sandboxed
        // iframe, vs JS null when the header is truly absent. The string must be
        // rejected (not in the allowlist); only a genuinely-absent Origin defers
        // to the Node token gate.
        expect(csrfRejectReason('POST', 'null', null)).toMatch(/cross-origin/);
    });

    it('exposes the localhost allowlist', () => {
        expect(ALLOWED_ORIGINS.has('http://localhost:3111')).toBe(true);
        expect(ALLOWED_ORIGINS.has('http://127.0.0.1:3111')).toBe(true);
    });
});

describe('tokenGuardReason — node token gate for no-Origin callers', () => {
    const TOKEN = 'a'.repeat(64);

    it('never gates read (GET) requests', () => {
        expect(tokenGuardReason('GET', null, null, TOKEN)).toBeNull();
    });

    it('allows requests that carry an Origin (the edge middleware already gated those)', () => {
        expect(tokenGuardReason('POST', 'http://localhost:3111', null, TOKEN)).toBeNull();
    });

    it('rejects a no-Origin state-changing request with no token', () => {
        expect(tokenGuardReason('POST', null, null, TOKEN)).toMatch(/session token/);
    });

    it('rejects a no-Origin state-changing request with the wrong token', () => {
        expect(tokenGuardReason('PATCH', null, 'b'.repeat(64), TOKEN)).toMatch(/session token/);
    });

    it('accepts a no-Origin state-changing request with the valid token', () => {
        expect(tokenGuardReason('POST', null, TOKEN, TOKEN)).toBeNull();
    });

    it('degrades to allow when no server token is configured (no lockout)', () => {
        expect(tokenGuardReason('POST', null, null, null)).toBeNull();
    });

    it('defers a string "null" Origin to the edge (only a genuinely-absent Origin is token-gated)', () => {
        // A request with an opaque "null" string Origin was already rejected by
        // the edge middleware; the token gate only owns the JS-null (header
        // absent) case, so it must not re-evaluate or accidentally allow it.
        expect(tokenGuardReason('POST', 'null', null, TOKEN)).toBeNull();
    });
});

// AD-346 regression guard: the bug this caught — git-init was left ungated while
// its 3 RCE siblings were gated. Reading the route sources and asserting the gate
// is wired is a threat-model test (the routes MUST be gated), not an
// implementation-detail check.
describe('every state-changing RCE route wires checkAdmin(request)', () => {
    const RCE_ROUTES = [
        'src/app/api/launch-agent/route.ts',
        'src/app/api/install-claude/route.ts',
        'src/app/api/install-agent/route.ts',
        'src/app/api/run-terminal/route.ts',
        'src/app/api/onboarding/git-init/route.ts',
    ];

    it.each(RCE_ROUTES)('%s gates its POST behind checkAdmin(request)', (rel) => {
        const src = readFileSync(join(process.cwd(), rel), 'utf-8');
        expect(src).toMatch(/checkAdmin\(request\)/);
    });
});
