import { describe, expect, it } from 'vitest';
import {
    parseWindowsProcesses,
    parseUnixProcesses,
    collectDescendantPids,
    matchAgentInProcesses,
    isPidAlive,
} from '../../server/agentLiveness.mjs';

describe('agentLiveness — Windows process-list parsing (Get-CimInstance JSON)', () => {
    it('parses a multi-row ConvertTo-Json array', () => {
        const json = JSON.stringify([
            { ProcessId: 100, ParentProcessId: 4, CommandLine: 'C:\\Windows\\system32\\cmd.exe' },
            { ProcessId: 200, ParentProcessId: 100, CommandLine: '"C:\\Program Files\\nodejs\\node.exe" "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"' },
        ]);
        const procs = parseWindowsProcesses(json);
        expect(procs).toEqual([
            { pid: 100, ppid: 4, command: 'C:\\Windows\\system32\\cmd.exe' },
            { pid: 200, ppid: 100, command: '"C:\\Program Files\\nodejs\\node.exe" "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"' },
        ]);
    });

    it('normalises a single-row object (ConvertTo-Json drops the array)', () => {
        const json = JSON.stringify({ ProcessId: 100, ParentProcessId: 4, CommandLine: 'cmd.exe' });
        expect(parseWindowsProcesses(json)).toEqual([{ pid: 100, ppid: 4, command: 'cmd.exe' }]);
    });

    it('drops malformed rows and bad JSON without throwing', () => {
        expect(parseWindowsProcesses('not json')).toEqual([]);
        const procs = parseWindowsProcesses(JSON.stringify([{ ProcessId: 'x', ParentProcessId: 1, CommandLine: 'a' }]));
        expect(procs).toEqual([]);
    });
});

describe('agentLiveness — Unix process-list parsing (ps -eo pid=,ppid=,args=)', () => {
    it('parses pid/ppid/args lines, keeping spaces in args', () => {
        const out = [
            '  100     4 /bin/bash',
            '  200   100 node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js --foo',
            'garbage line',
        ].join('\n');
        expect(parseUnixProcesses(out)).toEqual([
            { pid: 100, ppid: 4, command: '/bin/bash' },
            { pid: 200, ppid: 100, command: 'node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js --foo' },
        ]);
    });
});

describe('agentLiveness — descendant tree walk', () => {
    const procs = [
        { pid: 100, ppid: 4, command: 'cmd.exe' },     // shell
        { pid: 200, ppid: 100, command: 'node a' },     // child of shell
        { pid: 300, ppid: 200, command: 'node b' },     // grandchild
        { pid: 999, ppid: 5, command: 'unrelated' },    // not under shell
    ];

    it('collects descendants exclusive of the root', () => {
        const d = collectDescendantPids(procs, 100);
        expect([...d].sort((a, b) => a - b)).toEqual([200, 300]);
        expect(d.has(100)).toBe(false);
        expect(d.has(999)).toBe(false);
    });

    it('returns empty for a shell with no children', () => {
        expect(collectDescendantPids(procs, 999).size).toBe(0);
    });
});

describe('agentLiveness — agent matching (the AD-318 fix)', () => {
    const shellPid = 100;
    const claudeProc = {
        pid: 200,
        ppid: 100,
        command: '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\me\\AppData\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"',
    };

    it('detects Claude Code running as node by package signature', () => {
        const procs = [{ pid: 100, ppid: 4, command: 'cmd.exe' }, claudeProc];
        expect(matchAgentInProcesses(procs, shellPid)).toEqual({ name: 'Claude Code', pid: 200 });
    });

    it('does NOT flip on a bare shell where the user merely typed agent names', () => {
        // The forgeable case from the reopen: "hi claude" typed into cmd.exe.
        // Typed text is NOT a process — there is no agent descendant.
        const procs = [{ pid: 100, ppid: 4, command: 'C:\\Windows\\system32\\cmd.exe' }];
        expect(matchAgentInProcesses(procs, shellPid)).toBeNull();
    });

    it('honours the launch marker: expecting Codex, a Claude descendant is not a match', () => {
        const procs = [{ pid: 100, ppid: 4, command: 'cmd.exe' }, claudeProc];
        expect(matchAgentInProcesses(procs, shellPid, 'Codex')).toBeNull();
    });

    it('matches the expected agent when the marker agrees', () => {
        const procs = [{ pid: 100, ppid: 4, command: 'cmd.exe' }, claudeProc];
        expect(matchAgentInProcesses(procs, shellPid, 'Claude Code')).toEqual({ name: 'Claude Code', pid: 200 });
    });

    it('detects Codex / Gemini / Aider by their signatures', () => {
        const mk = (cmd: string) => [
            { pid: 100, ppid: 4, command: 'cmd.exe' },
            { pid: 200, ppid: 100, command: cmd },
        ];
        expect(matchAgentInProcesses(mk('node /x/node_modules/@openai/codex/bin/codex.js'), 100)?.name).toBe('Codex');
        expect(matchAgentInProcesses(mk('node /x/node_modules/@google/gemini-cli/dist/index.js'), 100)?.name).toBe('Gemini CLI');
        expect(matchAgentInProcesses(mk('python /usr/bin/aider --model gpt'), 100)?.name).toBe('Aider');
    });

    it('ignores a matching command line that is NOT a descendant of the shell', () => {
        const procs = [
            { pid: 100, ppid: 4, command: 'cmd.exe' },
            { pid: 999, ppid: 5, command: 'node /x/@anthropic-ai/claude-code/cli.js' }, // sibling, not under shell
        ];
        expect(matchAgentInProcesses(procs, shellPid)).toBeNull();
    });
});

describe('agentLiveness — isPidAlive', () => {
    it('reports the current process as alive', () => {
        expect(isPidAlive(process.pid)).toBe(true);
    });
    it('reports an absurd pid as not alive, and guards bad input', () => {
        expect(isPidAlive(2147483646)).toBe(false);
        expect(isPidAlive(0)).toBe(false);
        expect(isPidAlive(NaN)).toBe(false);
        expect(isPidAlive(-1)).toBe(false);
    });
});
