import { describe, expect, it } from 'vitest';
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
});
