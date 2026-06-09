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
        // AD-238 (third pass): on Windows, `claude` is `claude.cmd`. The
        // earlier "drop shell: true" fix made this throw EINVAL on a fresh
        // Windows install (`spawn` can't run `.cmd` without a shell), and
        // adding `shell: true` brings DEP0190 back. The clean shape is to
        // run `cmd.exe /c claude --version` — cmd.exe is an `.exe` so
        // spawn launches it without any implicit shell, `/c` makes it
        // execute the rest as a command, args stay in array form. No
        // `shell` option, no DEP0190, no EINVAL.
        const isWin = process.platform === 'win32';
        const spawnCmd = isWin ? 'cmd.exe' : 'claude';
        const spawnArgs = isWin ? ['/c', 'claude', '--version'] : ['--version'];
        let child;
        try {
            child = spawn(spawnCmd, spawnArgs, {
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
