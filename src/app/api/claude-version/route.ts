import { NextResponse } from 'next/server';
import { spawn } from 'child_process';

/**
 * AD-128: one-shot probe of the user's installed `claude` binary so the board
 * can flag a broken or outdated install and suggest the correct upgrade path.
 *
 * Response shape:
 *   { ok: true, version: "2.0.5", outdated: false }
 *   { ok: true, version: "1.0.128", outdated: true }           // any 1.x
 *   { ok: false, error: "not_found" | "spawn_failed" | ... }
 */
export async function GET() {
    try {
        const { version, error } = await probeClaudeVersion();
        if (!version) {
            return NextResponse.json({ ok: false, error: error || 'unknown' });
        }
        const major = parseInt(version.split('.')[0] || '0', 10);
        const outdated = Number.isFinite(major) && major < 2;
        return NextResponse.json({ ok: true, version, outdated });
    } catch (err) {
        console.error('[ADHDev] GET /api/claude-version error:', err);
        return NextResponse.json({ ok: false, error: String(err) });
    }
}

function probeClaudeVersion(): Promise<{ version: string | null; error: string | null }> {
    return new Promise(resolve => {
        // AD-238: drop `shell: true` (DEP0190 + command-injection surface).
        // On Windows the `claude` shim is `claude.cmd`; we resolve to it
        // explicitly so spawn doesn't fail to find it without shell PATHEXT
        // resolution.
        const claudeCmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';
        let child;
        try {
            child = spawn(claudeCmd, ['--version'], {
                windowsHide: true,
            });
        } catch (err) {
            console.error('[ADHDev] GET /api/claude-version probe spawn error:', err);
            resolve({ version: null, error: 'spawn_failed' });
            return;
        }

        let out = '';
        let err = '';
        const timer = setTimeout(() => {
            try { child.kill(); } catch {}
            resolve({ version: null, error: 'timeout' });
        }, 4000);

        child.stdout?.on('data', d => { out += d.toString(); });
        child.stderr?.on('data', d => { err += d.toString(); });
        child.on('error', () => {
            clearTimeout(timer);
            resolve({ version: null, error: 'not_found' });
        });
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0 && !out) {
                resolve({ version: null, error: err.slice(0, 200) || `exit_${code}` });
                return;
            }
            const match = (out + err).match(/(\d+\.\d+\.\d+[-\w.]*)/);
            resolve({ version: match?.[1] || null, error: match ? null : 'parse_failed' });
        });
    });
}
