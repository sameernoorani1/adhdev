// AD-280: version check + feature flag delivery for the npm CLI distribution.
//
// Fetches a static JSON manifest, compares against the running version, decides
// whether to block startup, nudge the user, or stay silent. Writes the feature
// flags to ~/.adhdev/features.json for the running Next server to read.
//
// All network behavior is best-effort: any failure (timeout, parse error, DNS,
// non-200) fails open. The app must work fully offline.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

export const DEFAULT_MANIFEST_URL = 'https://adhdev.dev/version.json';
export const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_CACHE_PATH = join(homedir(), '.adhdev', 'manifest-cache.json');
const DEFAULT_FEATURES_PATH = join(homedir(), '.adhdev', 'features.json');

// Hardcoded defaults — used when no manifest is available.
// All flags default to false so absence-of-manifest never lights up a feature.
export function defaultFeatures() {
    return {
        cloud_sync: false,
        team_boards: false,
        ai_meta_planner: false,
        hosted_runs: false,
    };
}

// Returns -1 if a < b, 0 if equal, 1 if a > b. Accepts plain semver "X.Y.Z" with
// optional "-prerelease" suffix. Prerelease versions compare lower than the
// equivalent stable version (0.1.1-rc.1 < 0.1.1).
export function compareVersions(a, b) {
    if (a === b) return 0;
    const splitNumber = (v) => {
        const [main, pre] = String(v).split('-', 2);
        const parts = main.split('.').map(n => Number.parseInt(n, 10) || 0);
        while (parts.length < 3) parts.push(0);
        return { parts, pre: pre || null };
    };
    const A = splitNumber(a);
    const B = splitNumber(b);
    for (let i = 0; i < 3; i++) {
        if (A.parts[i] !== B.parts[i]) return A.parts[i] < B.parts[i] ? -1 : 1;
    }
    // Same main parts: stable > prerelease.
    if (A.pre === B.pre) return 0;
    if (A.pre === null) return 1;
    if (B.pre === null) return -1;
    return A.pre < B.pre ? -1 : 1;
}

function ensureParentDir(filePath) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readCachedManifest(cachePath, ttlMs, now = Date.now()) {
    try {
        if (!existsSync(cachePath)) return null;
        const raw = JSON.parse(readFileSync(cachePath, 'utf-8'));
        if (!raw || typeof raw !== 'object') return null;
        if (typeof raw.fetchedAt !== 'number') return null;
        if (now - raw.fetchedAt > ttlMs) return null;
        return raw.manifest || null;
    } catch {
        return null;
    }
}

export function writeCachedManifest(cachePath, manifest, now = Date.now()) {
    try {
        ensureParentDir(cachePath);
        writeFileSync(cachePath, JSON.stringify({ fetchedAt: now, manifest }, null, 2), 'utf-8');
    } catch {
        // Cache write failure is non-fatal.
    }
}

export function writeFeatureFlags(featuresPath, features) {
    try {
        ensureParentDir(featuresPath);
        writeFileSync(featuresPath, JSON.stringify(features, null, 2), 'utf-8');
    } catch {
        // Feature-flag write failure is non-fatal.
    }
}

// Returns the parsed manifest object, or null on any failure. Hard 3s timeout
// by default. Caller is responsible for caching.
export async function fetchManifest(url, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') return null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, {
            signal: ac.signal,
            headers: { 'Accept': 'application/json' },
        });
        if (!res || !res.ok) return null;
        const data = await res.json();
        if (!data || typeof data !== 'object') return null;
        return data;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// Main entry point. Returns:
//   { action: 'continue', features }
//   { action: 'nudge',    features, message }
//   { action: 'block',    features, message }
//
// Caller decides whether to exit on 'block'. Action 'nudge' should print the
// message and continue. Action 'continue' is silent.
export async function checkVersion({
    currentVersion,
    manifestUrl = process.env.ADHDEV_MANIFEST_URL || DEFAULT_MANIFEST_URL,
    noUpdateCheck = process.env.ADHDEV_NO_UPDATE_CHECK === '1',
    cachePath = DEFAULT_CACHE_PATH,
    featuresPath = DEFAULT_FEATURES_PATH,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    now = Date.now(),
} = {}) {
    // Honor explicit opt-out: no network request, write default features so
    // the running server still has something to read.
    if (noUpdateCheck) {
        const features = defaultFeatures();
        writeFeatureFlags(featuresPath, features);
        return { action: 'continue', features };
    }

    // Try cache first.
    let manifest = readCachedManifest(cachePath, cacheTtlMs, now);

    if (!manifest) {
        manifest = await fetchManifest(manifestUrl, timeoutMs, fetchImpl);
        if (manifest) writeCachedManifest(cachePath, manifest, now);
    }

    // No manifest available → fail open silently.
    if (!manifest) {
        const features = defaultFeatures();
        writeFeatureFlags(featuresPath, features);
        return { action: 'continue', features };
    }

    const features = { ...defaultFeatures(), ...(manifest.features || {}) };
    writeFeatureFlags(featuresPath, features);

    // Killswitch — block regardless of version.
    if (manifest.killswitch === true) {
        return {
            action: 'block',
            features,
            message: (manifest.messages && manifest.messages.killswitch)
                || 'ADHDev is temporarily unavailable. Please try again later.',
        };
    }

    // Below minimum supported → block with upgrade instructions.
    if (manifest.minimum_supported
        && compareVersions(currentVersion, manifest.minimum_supported) < 0) {
        const download = manifest.download || {};
        const upgradeLine = download.npm
            ? `npm install -g ${download.npm}`
            : 'npm install -g adhdev-board@latest';
        const base = (manifest.messages && manifest.messages.force_update)
            || `This version of adhdev-board (${currentVersion}) is below the minimum supported version (${manifest.minimum_supported}). Please upgrade to continue.`;
        return {
            action: 'block',
            features,
            message: `${base}\n  Upgrade:  ${upgradeLine}`,
        };
    }

    // Below latest → soft nudge, continue.
    if (manifest.latest
        && compareVersions(currentVersion, manifest.latest) < 0) {
        const download = manifest.download || {};
        const upgradeLine = download.npm
            ? `npm install -g ${download.npm}`
            : 'npm install -g adhdev-board@latest';
        const base = (manifest.messages && manifest.messages.update_available)
            || `A newer version of adhdev-board is available (${manifest.latest}; you have ${currentVersion}).`;
        return {
            action: 'nudge',
            features,
            message: `${base}\n  Upgrade:  ${upgradeLine}`,
        };
    }

    return { action: 'continue', features };
}
