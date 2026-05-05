// AD-204: shared accessor for the terminal-server session token. The token is
// generated and persisted by server/terminal.mjs at boot (see
// getOrCreateSessionToken there). Both processes read the same file so the
// Next.js side can forward `x-adhdev-token` on every server-to-server fetch.
//
// Read at request time rather than process boot — the terminal server may not
// have written the file yet on first cold start, and re-reading is cheap
// (single small file on local disk).

import fs from 'fs';
import os from 'os';
import path from 'path';

export const SESSION_TOKEN_PATH = path.join(os.homedir(), '.adhdev', 'session-token');

export function readSessionToken(): string | null {
    try {
        if (!fs.existsSync(SESSION_TOKEN_PATH)) return null;
        const raw = fs.readFileSync(SESSION_TOKEN_PATH, 'utf-8').trim();
        return /^[0-9a-f]{64}$/i.test(raw) ? raw : null;
    } catch {
        return null;
    }
}

export function terminalAuthHeaders(): Record<string, string> {
    const token = readSessionToken();
    return token ? { 'x-adhdev-token': token } : {};
}
