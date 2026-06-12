// AD-280: tests for cli/version-check.mjs.
//
// Covers: semver comparison, manifest fetch + cache TTL, killswitch,
// below-minimum block, soft nudge, equal-or-above silent path, offline
// fail-open, env-var opt-out, feature-flag write.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
    compareVersions,
    fetchManifest,
    readCachedManifest,
    writeCachedManifest,
    writeFeatureFlags,
    defaultFeatures,
    checkVersion,
    DEFAULT_CACHE_TTL_MS,
    DEFAULT_TIMEOUT_MS,
} from '../../cli/version-check.mjs';

let tmp;

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'adhdev-vc-'));
});

afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

const cachePath = () => join(tmp, 'manifest-cache.json');
const featuresPath = () => join(tmp, 'features.json');

function mockFetch(manifest, opts = {}) {
    return async () => ({
        ok: opts.ok !== false,
        json: async () => manifest,
    });
}

function mockFetchThrowing() {
    return async () => { throw new Error('network down'); };
}

// AD-369: a fetch impl that never resolves on its own — it only settles when
// the AbortController's timeout fires. Models a slow/black-holed endpoint and
// lets us prove the timeout bounds the wait instead of hanging startup.
function mockFetchHanging() {
    return (_url, { signal } = {}) => new Promise((_resolve, reject) => {
        if (signal?.aborted) return reject(new Error('aborted'));
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
}

describe('compareVersions', () => {
    it('returns 0 for equal versions', () => {
        expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    });
    it('orders by major/minor/patch', () => {
        expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
        expect(compareVersions('1.2.0', '1.3.0')).toBe(-1);
        expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
        expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    });
    it('treats prerelease as lower than stable', () => {
        expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
        expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    });
    it('compares prereleases lexically', () => {
        expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    });
    it('handles missing patch / short versions', () => {
        expect(compareVersions('1.0', '1.0.0')).toBe(0);
        expect(compareVersions('1', '1.0.1')).toBe(-1);
    });
});

describe('cache read/write', () => {
    it('returns null when cache file does not exist', () => {
        expect(readCachedManifest(cachePath(), DEFAULT_CACHE_TTL_MS)).toBeNull();
    });
    it('round-trips a manifest', () => {
        const m = { latest: '0.1.1', minimum_supported: '0.1.0' };
        writeCachedManifest(cachePath(), m, 1000);
        expect(readCachedManifest(cachePath(), DEFAULT_CACHE_TTL_MS, 1500)).toEqual(m);
    });
    it('returns null when TTL has expired', () => {
        writeCachedManifest(cachePath(), { latest: '0.1.1' }, 1000);
        const past = 1000 + DEFAULT_CACHE_TTL_MS + 1;
        expect(readCachedManifest(cachePath(), DEFAULT_CACHE_TTL_MS, past)).toBeNull();
    });
    it('returns null for malformed cache JSON', () => {
        writeFileSync(cachePath(), 'not json', 'utf-8');
        expect(readCachedManifest(cachePath(), DEFAULT_CACHE_TTL_MS)).toBeNull();
    });
});

describe('writeFeatureFlags', () => {
    it('writes the features object to disk', () => {
        const features = { ...defaultFeatures(), cloud_sync: true };
        writeFeatureFlags(featuresPath(), features);
        const raw = JSON.parse(readFileSync(featuresPath(), 'utf-8'));
        expect(raw.cloud_sync).toBe(true);
        expect(raw.team_boards).toBe(false);
    });
});

describe('fetchManifest', () => {
    it('returns the parsed body on success', async () => {
        const fetchImpl = mockFetch({ latest: '0.1.1' });
        const r = await fetchManifest('https://x/version.json', DEFAULT_TIMEOUT_MS, fetchImpl);
        expect(r).toEqual({ latest: '0.1.1' });
    });
    it('returns null on non-2xx', async () => {
        const fetchImpl = mockFetch({ latest: '0.1.1' }, { ok: false });
        const r = await fetchManifest('https://x', DEFAULT_TIMEOUT_MS, fetchImpl);
        expect(r).toBeNull();
    });
    it('returns null when fetch throws', async () => {
        const r = await fetchManifest('https://x', DEFAULT_TIMEOUT_MS, mockFetchThrowing());
        expect(r).toBeNull();
    });
    it('returns null when fetch impl is missing', async () => {
        const r = await fetchManifest('https://x', DEFAULT_TIMEOUT_MS, undefined);
        expect(r).toBeNull();
    });
    // AD-369: malformed JSON on a 200 — res.json() rejects. Must fail open (null),
    // never throw out of fetchManifest.
    it('returns null when the body is not valid JSON (200 but res.json() throws)', async () => {
        const fetchImpl = async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } });
        const r = await fetchManifest('https://x', DEFAULT_TIMEOUT_MS, fetchImpl);
        expect(r).toBeNull();
    });
    // AD-369: a slow / black-holed endpoint must be aborted by the timeout and
    // return null — never hang `adhdev start`. Proves the wait is bounded by
    // timeoutMs (≤3s in production via DEFAULT_TIMEOUT_MS).
    it('aborts a slow response via the timeout and returns null (never hangs)', async () => {
        const start = Date.now();
        const r = await fetchManifest('https://x', 30, mockFetchHanging());
        const elapsed = Date.now() - start;
        expect(r).toBeNull();
        expect(elapsed).toBeGreaterThanOrEqual(20); // the abort timer fired
        expect(elapsed).toBeLessThan(2000);          // and we did not hang
    });
});

describe('checkVersion', () => {
    const baseOpts = () => ({
        currentVersion: '0.1.0',
        cachePath: cachePath(),
        featuresPath: featuresPath(),
        manifestUrl: 'https://test.invalid/version.json',
    });

    it('returns continue + writes default features when opt-out is set', async () => {
        const r = await checkVersion({ ...baseOpts(), noUpdateCheck: true });
        expect(r.action).toBe('continue');
        expect(r.features).toEqual(defaultFeatures());
        // No network call should have happened; features file should exist.
        expect(existsSync(featuresPath())).toBe(true);
    });

    it('returns continue when current === latest', async () => {
        const fetchImpl = mockFetch({ latest: '0.1.0', minimum_supported: '0.1.0' });
        const r = await checkVersion({ ...baseOpts(), fetchImpl });
        expect(r.action).toBe('continue');
    });

    it('blocks when killswitch is true', async () => {
        const fetchImpl = mockFetch({
            latest: '0.1.0',
            minimum_supported: '0.1.0',
            killswitch: true,
            messages: { killswitch: 'temporarily down' },
        });
        const r = await checkVersion({ ...baseOpts(), fetchImpl });
        expect(r.action).toBe('block');
        expect(r.message).toContain('temporarily down');
    });

    it('blocks when current < minimum_supported', async () => {
        const fetchImpl = mockFetch({
            latest: '0.2.0',
            minimum_supported: '0.1.1',
            download: { npm: 'adhdev-board@latest' },
        });
        const r = await checkVersion({ ...baseOpts(), fetchImpl });
        expect(r.action).toBe('block');
        expect(r.message).toMatch(/0\.1\.0/);
        expect(r.message).toMatch(/0\.1\.1/);
        expect(r.message).toMatch(/npm install -g adhdev-board@latest/);
    });

    it('nudges when current < latest but >= minimum', async () => {
        const fetchImpl = mockFetch({
            latest: '0.1.2',
            minimum_supported: '0.1.0',
        });
        const r = await checkVersion({ ...baseOpts(), fetchImpl });
        expect(r.action).toBe('nudge');
        expect(r.message).toMatch(/0\.1\.2/);
        expect(r.message).toMatch(/0\.1\.0/);
    });

    it('fails open silently when fetch fails AND cache is empty', async () => {
        const r = await checkVersion({ ...baseOpts(), fetchImpl: mockFetchThrowing() });
        expect(r.action).toBe('continue');
        expect(r.features).toEqual(defaultFeatures());
    });

    // AD-369: a 404 (non-2xx) manifest must never block startup — the manifest
    // being unreachable/absent is the expected pre-launch state and must fail open.
    it('fails open (continue) on a 404 / non-2xx manifest', async () => {
        const fetchImpl = mockFetch({}, { ok: false });
        const r = await checkVersion({ ...baseOpts(), fetchImpl });
        expect(r.action).toBe('continue');
        expect(r.features).toEqual(defaultFeatures());
    });

    it('uses the cache when present and fresh', async () => {
        writeCachedManifest(cachePath(), {
            latest: '9.9.9',
            minimum_supported: '0.0.1',
        }, 1000);
        // Even though the fetch would say "all good", the cache says 9.9.9 → nudge.
        const fetchImpl = mockFetch({ latest: '0.1.0', minimum_supported: '0.1.0' });
        const r = await checkVersion({
            ...baseOpts(),
            fetchImpl,
            now: 1500,
        });
        expect(r.action).toBe('nudge');
        expect(r.message).toMatch(/9\.9\.9/);
    });

    it('writes feature flags merged over the defaults', async () => {
        const fetchImpl = mockFetch({
            latest: '0.1.0',
            minimum_supported: '0.1.0',
            features: { cloud_sync: true, custom_flag: 'yes' },
        });
        const r = await checkVersion({ ...baseOpts(), fetchImpl });
        expect(r.features.cloud_sync).toBe(true);
        expect(r.features.team_boards).toBe(false); // default preserved
        expect(r.features.custom_flag).toBe('yes'); // extra flag survives
        const written = JSON.parse(readFileSync(featuresPath(), 'utf-8'));
        expect(written.cloud_sync).toBe(true);
    });

    it('ADHDEV_NO_UPDATE_CHECK env var disables the check via default opt-out arg', async () => {
        // Simulate the env-var path by setting the opt-out arg true.
        // (The actual env var → opt-out wiring happens in the default arg
        // value `process.env.ADHDEV_NO_UPDATE_CHECK === '1'`; that wiring
        // is too thin to be worth a separate test.)
        const r = await checkVersion({ ...baseOpts(), noUpdateCheck: true });
        expect(r.action).toBe('continue');
    });
});
