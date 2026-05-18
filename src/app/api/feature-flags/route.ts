// AD-280: feature flag delivery to the running Next server.
//
// Reads ~/.adhdev/features.json (written by the CLI's version-check on
// startup) and returns the flags as JSON. Falls back to a hardcoded
// all-false defaults object if the file is missing or malformed.

import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DEFAULTS = {
    cloud_sync: false,
    team_boards: false,
    ai_meta_planner: false,
    hosted_runs: false,
};

const FEATURES_PATH = join(homedir(), '.adhdev', 'features.json');

export async function GET() {
    if (!existsSync(FEATURES_PATH)) {
        return NextResponse.json({ features: { ...DEFAULTS }, source: 'defaults' });
    }
    try {
        const raw = JSON.parse(readFileSync(FEATURES_PATH, 'utf-8'));
        if (!raw || typeof raw !== 'object') {
            return NextResponse.json({ features: { ...DEFAULTS }, source: 'defaults' });
        }
        return NextResponse.json({ features: { ...DEFAULTS, ...raw }, source: 'manifest' });
    } catch {
        return NextResponse.json({ features: { ...DEFAULTS }, source: 'defaults' });
    }
}
