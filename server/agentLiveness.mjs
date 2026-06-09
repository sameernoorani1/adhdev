// AD-318: positive, process-based coding-agent liveness signal.
//
// This REPLACES the old text/scrollback detection (detectAgentOutput marker
// matching, detectAgentCommand typed-command matching, restoreAgentFromTail
// scrollback seeding). The rule is now simple and forgeable-proof:
//
//   An agent is "running" iff a known agent-CLI process is actually ALIVE as a
//   descendant of the session's shell PID — never because terminal text mentions
//   an agent name.
//
// Identity ("which agent") comes from the launch marker (the agent-hint the
// launcher sends), confirmed against the descendant's real command line. So
// typing "hi claude" into a bare cmd.exe can no longer flip the badge: there is
// no claude process under the shell.
//
// FAIL SAFE: any probe error / timeout / empty result resolves to
//   { active:false, name:null, pid:null }
// We NEVER fall back to text heuristics (that is the trail AD-318 must not extend).
//
// Windows note (Win11 26200): we use `Get-CimInstance Win32_Process` via
// powershell, NOT the deprecated/absent `wmic`. The agent CLIs install as global
// npm packages and run as `node <pkg>/cli.js` — there is no `claude.exe`. So the
// match is on the package signature in the process CommandLine, not an image name.

import { spawn } from 'node:child_process';

export const PROBE_TIMEOUT_MS = 4000;

// Per agent: a matcher over a LOWERCASED process command line. Ordered most-
// specific first. The package-path signatures (`@anthropic-ai/claude-code`,
// `@openai/codex`, `@google/gemini-cli`) are the reliable anchors; the binary-
// name fallbacks cover non-npm installs (aider via pip, cursor-agent/continue
// as native binaries). Disambiguation by the launch marker keeps these tight.
export const AGENT_MATCHERS = [
    {
        name: 'Claude Code',
        test: (cl) =>
            cl.includes('@anthropic-ai/claude-code') ||
            cl.includes('@anthropic-ai\\claude-code') ||
            /[\\/ ]claude(-code)?(\.js|\.cmd|\.ps1)?(\s|"|$)/.test(cl),
    },
    {
        name: 'Codex',
        test: (cl) =>
            cl.includes('@openai/codex') ||
            cl.includes('@openai\\codex') ||
            /[\\/ ]codex(\.js|\.cmd|\.ps1|\.exe)?(\s|"|$)/.test(cl),
    },
    {
        name: 'Gemini CLI',
        test: (cl) =>
            cl.includes('@google/gemini-cli') ||
            cl.includes('@google\\gemini-cli') ||
            cl.includes('gemini-cli') ||
            /[\\/ ]gemini(\.js|\.cmd|\.ps1)?(\s|"|$)/.test(cl),
    },
    {
        name: 'Aider',
        test: (cl) =>
            /[\\/ ]aider(\.exe)?(\s|"|$)/.test(cl) ||
            cl.includes('aider_chat') ||
            cl.includes('aider-chat'),
    },
    {
        name: 'Cursor Agent',
        test: (cl) => cl.includes('cursor-agent'),
    },
    {
        name: 'Continue',
        test: (cl) => /[\\/ ](continue|cn)(\.exe|\.cmd|\.ps1)?(\s|"|$)/.test(cl),
    },
];

// ─── Pure parsers (unit-tested) ──────────────────────────────────────

// Parse the output of:
//   Get-CimInstance Win32_Process |
//     Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json
// ConvertTo-Json emits a bare object (not an array) when there is exactly one
// row, so we normalise both shapes.
export function parseWindowsProcesses(jsonText) {
    let arr;
    try {
        arr = JSON.parse(String(jsonText || ''));
    } catch {
        return [];
    }
    if (!Array.isArray(arr)) arr = arr ? [arr] : [];
    return arr
        .map((p) => ({
            pid: Number(p.ProcessId),
            ppid: Number(p.ParentProcessId),
            command: String(p.CommandLine || ''),
        }))
        .filter((p) => Number.isInteger(p.pid) && p.pid > 0);
}

// Parse the output of `ps -eo pid=,ppid=,args=` — three columns, args is the
// rest of the line (may contain spaces).
export function parseUnixProcesses(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => {
            const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
            if (!m) return null;
            return { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] };
        })
        .filter((p) => p && Number.isInteger(p.pid) && p.pid > 0);
}

// BFS the ppid tree to collect every descendant pid of rootPid (EXCLUSIVE of
// rootPid itself — the shell is never the agent).
export function collectDescendantPids(processes, rootPid) {
    const root = Number(rootPid);
    const childrenByPpid = new Map();
    for (const p of processes) {
        if (!childrenByPpid.has(p.ppid)) childrenByPpid.set(p.ppid, []);
        childrenByPpid.get(p.ppid).push(p.pid);
    }
    const result = new Set();
    const queue = [root];
    while (queue.length) {
        const cur = queue.shift();
        for (const child of childrenByPpid.get(cur) || []) {
            if (child !== root && !result.has(child)) {
                result.add(child);
                queue.push(child);
            }
        }
    }
    return result;
}

// Find a known agent among the descendants of shellPid. When `expectedName`
// (from the launch marker) is provided, ONLY that agent's matcher is used — this
// is the disambiguation that keeps the broad fallbacks from cross-matching.
// Returns { name, pid } or null.
export function matchAgentInProcesses(processes, shellPid, expectedName) {
    const descendants = collectDescendantPids(processes, shellPid);
    if (descendants.size === 0) return null;
    const byPid = new Map(processes.map((p) => [p.pid, p]));
    const matchers = expectedName
        ? AGENT_MATCHERS.filter((m) => m.name === expectedName)
        : AGENT_MATCHERS;
    if (matchers.length === 0) return null;
    // Deterministic order: lowest pid first.
    for (const pid of [...descendants].sort((a, b) => a - b)) {
        const proc = byPid.get(pid);
        const cl = (proc?.command || '').toLowerCase();
        if (!cl) continue;
        for (const m of matchers) {
            if (m.test(cl)) return { name: m.name, pid };
        }
    }
    return null;
}

// ─── OS probe (thin; fail-safe; left for live verification) ──────────

function runProcessList() {
    return new Promise((resolve) => {
        const isWin = process.platform === 'win32';
        const cmd = isWin ? 'powershell.exe' : 'ps';
        const args = isWin
            ? [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
            ]
            : ['-eo', 'pid=,ppid=,args='];

        let out = '';
        let settled = false;
        const done = (val) => {
            if (settled) return;
            settled = true;
            resolve(val);
        };

        let child;
        try {
            child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        } catch {
            done(null);
            return;
        }
        const killer = setTimeout(() => {
            try { child.kill(); } catch { /* ignore */ }
            done(null);
        }, PROBE_TIMEOUT_MS);
        child.stdout.on('data', (d) => { out += d.toString(); });
        child.on('error', () => { clearTimeout(killer); done(null); });
        child.on('exit', () => { clearTimeout(killer); done(out); });
    });
}

// Probe the OS for a live agent under `shellPid`. `expectedName` (launch marker)
// disambiguates which agent we expect. Always resolves to a safe shape; never
// throws, never reads terminal text.
export async function probeAgentLiveness(shellPid, expectedName) {
    const safe = { active: false, name: null, pid: null };
    const pidNum = Number(shellPid);
    if (!Number.isInteger(pidNum) || pidNum <= 0) return safe;

    const raw = await runProcessList();
    if (raw == null) return safe; // probe failed → fail safe

    const processes = process.platform === 'win32'
        ? parseWindowsProcesses(raw)
        : parseUnixProcesses(raw);
    if (processes.length === 0) return safe;

    const match = matchAgentInProcesses(processes, pidNum, expectedName || null);
    if (!match) return safe;
    return { active: true, name: match.name, pid: match.pid };
}

// AD-341 turn-end signal: is the agent actively running a tool/command right
// now? A coding agent that's mid-turn shells out (bash, node, build, test, git)
// — those show up as live DESCENDANT processes of the agent pid. An agent idle
// at its prompt (turn finished) has none. This is the discriminator that lets
// the run close on turn-end without waiting for the agent process to exit
// (interactive agents like Claude stay alive the whole session).
//
// FAIL SAFE: any probe error resolves to `true` (assume busy) so a probe glitch
// never causes a premature close mid-work — the conservative direction here.
export async function probeAgentBusy(agentPid) {
    const pidNum = Number(agentPid);
    if (!Number.isInteger(pidNum) || pidNum <= 0) return false;
    const raw = await runProcessList();
    if (raw == null) return true; // probe failed → assume busy (don't false-close)
    const processes = process.platform === 'win32'
        ? parseWindowsProcesses(raw)
        : parseUnixProcesses(raw);
    if (processes.length === 0) return true;
    return collectDescendantPids(processes, pidNum).size > 0;
}

// Cheap liveness check for an already-known agent PID. `process.kill(pid, 0)`
// sends no signal — it only tests existence. EPERM means the process exists but
// we lack permission (still alive); ESRCH means it's gone.
export function isPidAlive(pid) {
    const pidNum = Number(pid);
    if (!Number.isInteger(pidNum) || pidNum <= 0) return false;
    try {
        process.kill(pidNum, 0);
        return true;
    } catch (e) {
        return Boolean(e) && e.code === 'EPERM';
    }
}
