// AD-240: ground-truth filesTouched via `git diff --stat` shellout.
//
// Until this ticket the only source of execution.filesTouched was the agent's
// self-report on the completion PATCH. AD-218 (in flight) softens the
// marketing copy from "structured receipt" to "the agent's claimed summary"
// because that self-report could be fabricated. The honest fix is to
// ground-truth the claim: when the run starts, capture HEAD SHA in
// execution.startedRef; when the AI flips status to done, diff against that
// baseline and overwrite filesTouched with the actual changed-files list.
//
// All git invocations use `spawnSync` array-form args (no `shell: true`) per
// AD-238. Failures are silent — if the project isn't a git repo, or git
// errors out, the agent's self-report is left in place.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const GIT_TIMEOUT_MS = 5000;

function isGitRepo(projectPath: string): boolean {
    try {
        return fs.existsSync(path.join(projectPath, '.git'));
    } catch {
        return false;
    }
}

/**
 * Capture the current HEAD SHA of the project's git repo. Returns null if
 * the project isn't a git repo or git itself isn't reachable. Used as the
 * baseline for the diff at run-completion time.
 */
export function getCurrentGitSha(projectPath: string): string | null {
    if (!isGitRepo(projectPath)) return null;
    const r = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: projectPath,
        timeout: GIT_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (r.status !== 0) return null;
    const sha = (r.stdout || '').toString().trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null;
}

/**
 * Return the list of files changed between `baselineSha` and the current
 * working tree (committed changes + staged + unstaged + untracked).
 *
 * Returns null when:
 *   - the project isn't a git repo
 *   - the baseline SHA is missing (run started before AD-240 shipped)
 *   - the baseline SHA can't be resolved (force-push / branch reset)
 *   - git itself errors out
 *
 * In any of those cases the caller should fall back to the agent's
 * self-reported filesTouched.
 */
export function getDiffFiles(projectPath: string, baselineSha: string | null | undefined): string[] | null {
    if (!baselineSha || !isGitRepo(projectPath)) return null;

    // Verify the baseline still exists (a force-push / reset --hard would orphan it).
    const verify = spawnSync('git', ['cat-file', '-e', baselineSha], {
        cwd: projectPath,
        timeout: GIT_TIMEOUT_MS,
        stdio: ['ignore', 'ignore', 'ignore'],
    });
    if (verify.status !== 0) return null;

    // 1. Committed + staged + unstaged tracked-file changes since baseline.
    //    `--name-only` keeps the output to one path per line. Triple-dot
    //    isn't needed — we want everything-since-baseline reachable from HEAD
    //    plus working-tree changes, so plain `<baseline>` does the right
    //    thing against the working tree.
    const tracked = spawnSync('git', ['diff', '--name-only', baselineSha], {
        cwd: projectPath,
        timeout: GIT_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 2. Untracked files (new files the agent created that aren't in any commit yet).
    //    `git status --porcelain` lines for untracked files start with `?? `.
    const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd: projectPath,
        timeout: GIT_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
    });

    const files = new Set<string>();

    if (tracked.status === 0) {
        for (const line of (tracked.stdout || '').toString().split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed) files.add(trimmed);
        }
    } else {
        // Diff against the baseline failed — caller should treat as null.
        return null;
    }

    if (status.status === 0) {
        for (const line of (status.stdout || '').toString().split(/\r?\n/)) {
            // Untracked: lines are `?? path/to/file`. Renames are `R  old -> new`
            // (we already get the new path from the tracked diff above).
            if (line.startsWith('?? ')) {
                const file = line.slice(3).trim();
                if (file) files.add(file);
            }
        }
    }

    // Sort for deterministic ordering — small quality-of-life win when the
    // list is rendered in the ticket detail view.
    return Array.from(files).sort();
}
