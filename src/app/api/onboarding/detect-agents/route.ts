import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';

// §5.4 follow-up: probe whether each recognised coding-agent CLI is installed
// on this machine. Wizard Step 2 + the board's agent-status panel use this to
// show "✓ Installed" vs "Install" affordances per row instead of dumping a
// 6-row CLI-paste wall on every user.
//
// We probe by running `<runCommand> --version` for each agent. The probe
// itself is platform-aware: on Windows, agents like `claude.cmd` / `codex.cmd`
// are .cmd shims that Node's spawn can't execute directly, so we route them
// through `cmd.exe /c` (same shape as AD-238's claude-version probe). On
// macOS/Linux, the binary names resolve directly.
//
// Args are passed array-form (no `shell: true`) per AD-238 to dodge DEP0190.
// Response: { agents: { [id]: { installed: boolean, version: string|null } } }

const PROBE_TIMEOUT_MS = 2500;

const AGENTS: Array<{ id: string; runCommand: string; versionFlag: string }> = [
    { id: 'Claude Code',  runCommand: 'claude',       versionFlag: '--version' },
    { id: 'Codex',        runCommand: 'codex',        versionFlag: '--version' },
    { id: 'Gemini CLI',   runCommand: 'gemini',       versionFlag: '--version' },
    { id: 'Aider',        runCommand: 'aider',        versionFlag: '--version' },
    { id: 'Cursor Agent', runCommand: 'cursor-agent', versionFlag: '--version' },
    { id: 'Continue',     runCommand: 'continue',     versionFlag: '--version' },
];

function externalPathEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
    const pathSep = process.platform === 'win32' ? ';' : ':';
    env[pathKey] = String(env[pathKey] || '')
        .split(pathSep)
        .filter(entry => !entry.replace(/\\/g, '/').toLowerCase().includes('/node_modules/.bin'))
        .join(pathSep);
    return env;
}

function probe(runCommand: string, versionFlag: string): Promise<{ installed: boolean; version: string | null }> {
    return new Promise((resolve) => {
        const isWin = process.platform === 'win32';
        const cmd = isWin ? 'cmd.exe' : runCommand;
        const args = isWin ? ['/c', runCommand, versionFlag] : [versionFlag];

        let stdout = '';
        let settled = false;
        const finish = (installed: boolean, version: string | null) => {
            if (settled) return;
            settled = true;
            resolve({ installed, version });
        };

        let child;
        try {
            child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: externalPathEnv() });
        } catch {
            finish(false, null);
            return;
        }
        const killer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } finish(false, null); }, PROBE_TIMEOUT_MS);
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.on('error', () => { clearTimeout(killer); finish(false, null); });
        child.on('exit', (code) => {
            clearTimeout(killer);
            if (code !== 0) {
                finish(false, null);
                return;
            }
            const m = stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
            finish(true, m ? m[1] : stdout.trim().slice(0, 40) || null);
        });
    });
}

export async function GET() {
    try {
        const entries = await Promise.all(AGENTS.map(async a => {
            const r = await probe(a.runCommand, a.versionFlag);
            return [a.id, r] as const;
        }));
        const agents: Record<string, { installed: boolean; version: string | null }> = {};
        for (const [id, r] of entries) agents[id] = r;
        return NextResponse.json({ agents });
    } catch (err) {
        console.error('[ADHDev] GET /api/onboarding/detect-agents error:', err);
        return NextResponse.json({ error: 'probe_failed' }, { status: 500 });
    }
}
