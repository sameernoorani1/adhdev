import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getActiveProject, getProjectBoardPath, initProjectDir, getProjectById } from './registry';
import { ensureAdhdevProtocol, getDefaultExecutionContract, buildInlineContractNotice, type AdhdevExecutionContract } from './protocol';
import { ACTIVE_RUN_STATUSES, normalizeRuns, sweepStaleRuns } from './runs';

function getFeedbackPath(projectId?: string | null): string {
    const project = getProjectById(projectId) || getActiveProject();
    if (project) return getProjectBoardPath(project);
    // Fallback: use CWD (for dev / before any project is registered)
    const fallback = path.join(process.cwd(), '.adhdev', 'board.json');
    if (!fs.existsSync(path.dirname(fallback))) {
        initProjectDir(process.cwd());
    }
    return fallback;
}

// ─── Types ──────────────────────────────────────────────────────────
export interface AgentRulesWorkflow {
    allowedTransitions: Record<string, string[]>;
    instructions: string;
    requiresPlanComment?: boolean;
    requiresHumanApproval?: boolean;
}

export interface AgentRules {
    version: number;
    global: {
        forbiddenStatuses: string[];
        sessionStart: string[];
        commentRules: string[];
    };
    workflows: Record<string, AgentRulesWorkflow>;
    statusInstructions: Record<string, string>;
}

export interface FeedbackTicket {
    id: string;
    title: string;
    contractVersion?: number;
    _executionContract?: string;
    description: string;
    status: string;
    priority: string;
    missionId?: string;
    wave?: string;
    session?: string;
    ticketType: string;
    aiAddressable: boolean;
    reporter: string;
    createdByType?: 'human' | 'ai' | 'system';
    // AD-186: when a ticket is spawned from a Brain Dump message, this
    // points back to the source `m-xxx` chat-message id. Drives the
    // "Sameer via chat" reporter attribution + the click-to-open behavior.
    sourceMessageId?: string;
    images: { url: string; filename: string; isImage?: boolean; size?: number; uploadedAt?: string }[];
    tags: string[];
    reopenCount: number;
    comments: {
        id: string;
        author: string;
        authorType: string;
        content: string;
        images: { url: string; filename: string }[];
        createdAt: string;
    }[];
    activity: {
        action: string;
        by: string;
        byType: string;
        at: string;
        from?: string;
        to?: string;
        targetAgent?: string;
        reason?: string;
    }[];
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
    execution?: TicketExecution;
    // AD-180: first-class ticket-to-ticket relations. See lib/feedback/relations.ts.
    // AD-193: `relates` dropped — see relations.ts for the canonical kind union.
    relations?: { kind: 'parent' | 'subtask' | 'duplicate-of' | 'blocks' | 'blocked-by'; ticketId: string }[];
}

export interface TicketExecution {
    runId: string;
    actor: string;
    actorType: 'ai' | 'human';
    status: 'in_progress' | 'done' | 'blocked';
    startedAt: string;
    updatedAt: string;
    completedAt?: string | null;
    plan?: string;
    summary?: string;
    filesTouched: string[];
    verification: string[];
    result?: 'success' | 'blocked';
    blocker?: string | null;
    batchId?: string;
    // AD-240: git HEAD SHA captured when the run started; ground-truth diff
    // baseline. Optional because runs that started before AD-240 shipped
    // won't have it — the PATCH handler falls back to agent self-report
    // when this is missing.
    startedRef?: string;
    // AD-240: 'git-diff' when filesTouched was overwritten by git ground-truth
    // at done-time; 'agent' when the agent's self-report was kept (e.g. project
    // not in git, or no startedRef captured). The UI can use this to label
    // the file list honestly.
    filesTouchedSource?: 'git-diff' | 'agent';
}

export interface FeedbackBatch {
    id: string;
    name: string;
    ticketIds: string[];
    createdAt: string;
    source: 'manual' | 'ai';
    reviewState?: 'suggested' | 'accepted';
    rationale?: string;
    // Run-batch fields
    mode?: string;
    execution?: string;
    target?: string;
    status?: string;
    startedAt?: string;
    updatedAt?: string;
}

export interface FeedbackRun {
    runId: string;
    projectId?: string | null;
    ticketIds: string[];
    status: 'dispatching' | 'running' | 'finishing' | 'done' | 'blocked' | 'failed' | 'interrupted' | 'stale';
    source?: 'ui-run' | 'agent-claim' | 'terminal-run';
    terminalSessionId?: string | null;
    agent: string;
    startedAt: string;
    updatedAt: string;
    lastHeartbeatAt?: string | null;
    dispatchResult?: string | null;
    completedAt?: string | null;
    failure?: string | null;
    blocker?: string | null;
    startedRef?: string;
}

export interface SessionActivityEntry {
    type: string;
    sessionId: string;
    ticketId?: string | null;
    tool?: string;
    action?: string;
    detail?: string;
    file?: string | null;
    error?: string | null;
    cwd?: string | null;
    at: string;
}

export interface MissionDecision {
    id: string;
    content: string;
    author: string;
    createdAt: string;
}

export interface FeedbackMission {
    id: string;
    title: string;
    status: 'draft' | 'planning' | 'approved' | 'in_progress' | 'blocked' | 'done' | 'archived';
    summary: string;
    goal: string;
    context: string;
    proposedPlan: string;
    agreedPlan: string;
    successCriteria: string;
    notes: string;
    createdAt: string;
    updatedAt: string;
    decisionLog: MissionDecision[];
}

export interface FeedbackData {
    nextId: number;
    columns: Record<string, { label: string; aiInstruction: string }>;
    tickets: FeedbackTicket[];
    missions?: FeedbackMission[];
    agentRules?: AgentRules;
    executionContract?: AdhdevExecutionContract;
    batches?: FeedbackBatch[];
    sessionActivity?: SessionActivityEntry[];
    activeRuns?: FeedbackRun[];
}

export interface TicketLookupResult {
    ok: boolean;
    index?: number;
    ticket?: FeedbackTicket;
    error?: string;
    status?: number;
}

// ─── File I/O ───────────────────────────────────────────────────────
function isAiOrigin(ticket: Partial<FeedbackTicket>): boolean {
    const reporter = String(ticket.reporter || '').toLowerCase();
    const firstActivity = Array.isArray(ticket.activity) ? ticket.activity[0] : null;
    return reporter === 'ai'
        || reporter === 'system'
        || reporter.includes('claude')
        || reporter.includes('codex')
        || reporter.includes('chatgpt')
        || reporter.includes('openai')
        || firstActivity?.byType === 'ai'
        || firstActivity?.byType === 'system'
        || String(firstActivity?.by || '').toLowerCase() === 'system';
}

function normalizeComment(comment: FeedbackTicket['comments'][number]): FeedbackTicket['comments'][number] {
    const raw = comment as Record<string, unknown>;
    // Migrate alternative field names → content (some agents use 'text', 'body', or 'message')
    const content = typeof raw.content === 'string' ? raw.content
        : typeof raw.text === 'string' ? (raw.text as string)
        : typeof raw.body === 'string' ? (raw.body as string)
        : typeof raw.message === 'string' ? (raw.message as string)
        : '';
    return {
        id: comment.id || `c-${Date.now().toString(36)}`,
        author: comment.author || 'Unknown',
        authorType: comment.authorType || 'human',
        content,
        images: Array.isArray(comment.images) ? comment.images : [],
        createdAt: comment.createdAt || new Date().toISOString(),
    };
}

// AD-168 reopen: comment timestamp hygiene. The POST /api/feedback/{id}/comments
// route already overwrites body.createdAt with a server `now` (line 71 of that
// route), so any comment that lands via the API has full millisecond precision.
// But agents can — and Gemini did — bypass the API and edit board.json by hand,
// at which point they tend to pick round numbers like "10:00:00.000Z". This pass
// runs at normalize-time on every read and enforces three invariants:
//   1. createdAt parses to a valid Date.
//   2. createdAt is monotonically non-decreasing across the comments array.
//   3. createdAt has millisecond precision when the original is a "fudged" round
//      AI timestamp (`.000Z` and seconds === 0), so the timeline doesn't show
//      identical-looking pile-ups for things that were obviously written later.
// We never invent earlier times — we only push fudged AI timestamps forward to
// `prev + 1ms` so order is preserved without claiming false precision.
export function fixupCommentTimestamps(
    comments: FeedbackTicket['comments'],
    ticketCreatedAt: string | undefined,
): FeedbackTicket['comments'] {
    if (!Array.isArray(comments) || comments.length === 0) return comments;
    const ticketStart = (() => {
        const t = ticketCreatedAt ? Date.parse(ticketCreatedAt) : NaN;
        return Number.isFinite(t) ? t : Date.now();
    })();
    let prevMs = ticketStart - 1;
    return comments.map(comment => {
        const raw = comment.createdAt;
        let parsed = raw ? Date.parse(raw) : NaN;
        const looksFudged = typeof raw === 'string'
            && raw.endsWith('.000Z')
            && /T\d{2}:\d{2}:00\.000Z$/.test(raw)
            && comment.authorType === 'ai';
        if (!Number.isFinite(parsed)) parsed = prevMs + 1;
        if (parsed <= prevMs) parsed = prevMs + 1;
        // When an AI hand-edits board.json with a round timestamp (e.g.
        // 10:00:00.000Z), rewrite it to "1 second after the previous
        // comment". The post-rewrite seconds component is non-zero, so the
        // regex no longer matches and the next read leaves it alone —
        // idempotent. Real server-generated timestamps almost never land on
        // exactly :MM:00.000Z, so the false-positive rate is negligible.
        if (looksFudged) parsed = prevMs + 1000;
        prevMs = parsed;
        const next = new Date(parsed).toISOString();
        return next === raw ? comment : { ...comment, createdAt: next };
    });
}

function normalizeTicket(ticket: FeedbackTicket): FeedbackTicket {
    const tags = Array.from(new Set((Array.isArray(ticket.tags) ? ticket.tags : [])
        .map(tag => String(tag || '').trim().toLowerCase())
        .filter(Boolean)));

    if (isAiOrigin(ticket) && !tags.includes('ai')) {
        tags.unshift('ai');
    }

    const contractVersion = ticket.contractVersion || getDefaultExecutionContract().version;
    // AD-211: _executionContract is computed at read-time (see readFeedback)
    // and stripped before persistence (see writeFeedback) so the field stops
    // creating noisy board.json diffs whenever the contract notice changes.
    // We preserve any inline value through normalize so callers that mutate
    // a ticket and inspect it after writeFeedback still see the field on the
    // in-memory copy.
    return {
        id: ticket.id,
        title: ticket.title,
        contractVersion,
        ...(ticket._executionContract ? { _executionContract: ticket._executionContract } : {}),
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        missionId: ticket.missionId || '',
        wave: ticket.wave || '',
        session: ticket.session || '',
        ticketType: ticket.ticketType,
        aiAddressable: ticket.aiAddressable,
        reporter: ticket.reporter,
        images: Array.isArray(ticket.images) ? ticket.images : [],
        tags,
        reopenCount: ticket.reopenCount ?? 0,
        comments: Array.isArray(ticket.comments) ? fixupCommentTimestamps(ticket.comments.map(normalizeComment), ticket.createdAt) : [],
        activity: Array.isArray(ticket.activity) ? ticket.activity : [],
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        resolvedAt: ticket.resolvedAt ?? null,
        execution: ticket.execution,
        // AD-180: preserve first-class ticket relations through the normalize
        // pass. Without this, normalizeTicket would drop the field on every
        // read/write because the spread above is shape-explicit.
        relations: Array.isArray(ticket.relations) ? ticket.relations : undefined,
    };
}

export function readFeedback(projectId?: string | null): FeedbackData {
    const feedbackPath = getFeedbackPath(projectId);
    const dir = path.dirname(feedbackPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(feedbackPath)) {
        // Auto-create empty board
        initProjectDir(path.dirname(dir));
    }
    ensureAdhdevProtocol(path.dirname(dir));
    const raw = fs.readFileSync(feedbackPath, 'utf-8');
    const data = normalizeFeedbackData(JSON.parse(raw));
    // AD-211: enrich with _executionContract at read-time so API responses
    // still expose the inline contract to agents, while the persisted file
    // (see writeFeedback) stays free of it.
    const contractNotice = buildInlineContractNotice(getDefaultExecutionContract());
    if (Array.isArray(data.tickets)) {
        for (const ticket of data.tickets) {
            ticket._executionContract = contractNotice;
        }
    }
    return data;
}

// AD-307 reopen: async sibling of `readFeedback`. Same shape, but `readFile`
// is non-blocking so a 2.6 MB board doesn't freeze the event loop during a
// heartbeat. Bootstrap helpers (`mkdirSync`, `existsSync`, `initProjectDir`,
// `ensureAdhdevProtocol`) stay sync because they're one-time first-run paths
// — the hot per-beat cost is the actual `readFile`, which is now async.
export async function readFeedbackAsync(projectId?: string | null): Promise<FeedbackData> {
    const feedbackPath = getFeedbackPath(projectId);
    const dir = path.dirname(feedbackPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(feedbackPath)) {
        initProjectDir(path.dirname(dir));
    }
    ensureAdhdevProtocol(path.dirname(dir));
    const raw = await fs.promises.readFile(feedbackPath, 'utf-8');
    const data = normalizeFeedbackData(JSON.parse(raw));
    const contractNotice = buildInlineContractNotice(getDefaultExecutionContract());
    if (Array.isArray(data.tickets)) {
        for (const ticket of data.tickets) {
            ticket._executionContract = contractNotice;
        }
    }
    return data;
}

// AD-209: per-project async lock around read-modify-write. Two PATCHes racing
// the same board would each `readFeedback`, mutate, then `writeFeedback` —
// last writer wins, first writer's changes silently lost. The single-process
// Next.js dev server doesn't need OS-level locks; chaining promises in a Map
// is enough. Different projectIds get independent chains.
const feedbackLocks = new Map<string, Promise<unknown>>();

// AD-232: Next.js-side sweep that mirrors server/terminal.mjs's
// recoverStaleInProgressTickets. Normalizes execution.status when it has
// drifted out of sync with ticket.status (mascot animation reads
// execution.status directly without a freshness gate, so stuck records
// keep otters dancing forever). Mutates the data in place. Returns true
// if anything changed.
//
// Two normalizations:
//   - ticket.status ∈ {done, reviewed} AND execution=in_progress
//       → execution.status='done', completedAt set, result='success'.
//         The work is done (status says so); the data was just out of
//         sync (auto-claim race after a status=done flip, or a hard
//         server crash mid-run).
//   - ticket.status ∈ {backlog, todo, reopen, deferred, observe} AND
//     execution=in_progress AND updatedAt staler than STALE_RUN_MS
//       → execution.status='blocked' with a 'Recovered: stale in_progress
//         without active session' blocker. Same shape terminal.mjs uses.
const STALE_RUN_MS = 5 * 60 * 1000;
const TERMINAL_STATUSES = new Set(['done', 'reviewed']);
const ACTIVE_WORK_STATUSES = new Set(['in_progress']);

export function sweepStaleExecutions(data: FeedbackData): boolean {
    if (!Array.isArray(data?.tickets)) return false;
    const now = new Date().toISOString();
    const nowMs = Date.now();
    let changed = false;
    const runsChanged = sweepStaleRuns(data, now);
    const liveRunTicketIds = new Set<string>();
    if (Array.isArray(data.activeRuns)) {
        for (const run of data.activeRuns) {
            if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
            for (const id of run.ticketIds || []) liveRunTicketIds.add(String(id || '').toUpperCase());
        }
    }
    for (const ticket of data.tickets) {
        const exec = ticket.execution;
        if (!exec || exec.status !== 'in_progress') continue;

        if (TERMINAL_STATUSES.has(ticket.status)) {
            ticket.execution = {
                ...exec,
                status: 'done',
                completedAt: exec.completedAt || now,
                result: exec.result || 'success',
                updatedAt: now,
            };
            ticket.updatedAt = now;
            changed = true;
            continue;
        }

        if (!ACTIVE_WORK_STATUSES.has(ticket.status)) {
            if (liveRunTicketIds.has(String(ticket.id || '').toUpperCase())) continue;
            const updatedAtMs = exec.updatedAt ? new Date(exec.updatedAt).getTime() : 0;
            if (Number.isFinite(updatedAtMs) && nowMs - updatedAtMs > STALE_RUN_MS) {
                ticket.execution = {
                    ...exec,
                    status: 'blocked',
                    blocker: exec.blocker || 'Recovered: stale in_progress without active session.',
                    updatedAt: now,
                };
                ticket.updatedAt = now;
                changed = true;
            }
        }
    }
    return runsChanged || changed;
}

// AD-232: per-project sweep rate-limit. The /api/feedback GET hits often
// (page load, polling); sweeping on every request would burn IO. 30 s
// is short enough that stuck states clear within one polling cycle and
// long enough that the cost is negligible.
const SWEEP_INTERVAL_MS = 30 * 1000;
const lastSweepAt = new Map<string, number>();

export function shouldSweepNow(projectId: string | null | undefined): boolean {
    const key = projectId ?? '__default__';
    const last = lastSweepAt.get(key) ?? 0;
    if (Date.now() - last < SWEEP_INTERVAL_MS) return false;
    lastSweepAt.set(key, Date.now());
    return true;
}

export async function withFeedbackLock<T>(
    projectId: string | null | undefined,
    fn: () => T | Promise<T>,
): Promise<T> {
    const key = projectId ?? '__default__';
    const previous = feedbackLocks.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    // tail never rejects, so the next waiter chains even if fn threw.
    const tail: Promise<unknown> = next.catch(() => undefined);
    feedbackLocks.set(key, tail);
    tail.then(() => {
        if (feedbackLocks.get(key) === tail) feedbackLocks.delete(key);
    });
    return next;
}

// AD-175: write-temp-then-rename so a kill mid-flush leaves the existing
// board.json intact instead of a half-written file. The rename is atomic on
// POSIX, and on Windows fs.renameSync replaces the destination atomically as
// long as both paths are on the same filesystem (the tmp lives next to the
// target, so they are).
// AD-307: Windows AV / Search Indexer briefly opens board.json during writes,
// so fs.renameSync('.tmp' -> 'board.json') intermittently throws EPERM/EBUSY.
// The throw both fails that heartbeat AND blocks the per-project lock chain,
// piling up queued requests until the renderer crashes. Retry on transient
// codes with bounded sync sleeps — budget short enough not to starve the lock.
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'EEXIST']);
const RENAME_MAX_ATTEMPTS = 6;
const RENAME_RETRY_MS = 50;

function syncSleep(ms: number) {
    try {
        const buf = new Int32Array(new SharedArrayBuffer(4));
        Atomics.wait(buf, 0, 0, ms);
    } catch {
        const end = Date.now() + ms;
        while (Date.now() < end) { /* fallback spin */ }
    }
}

function renameWithRetry(src: string, dest: string) {
    for (let attempt = 0; attempt < RENAME_MAX_ATTEMPTS; attempt++) {
        try {
            fs.renameSync(src, dest);
            return;
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code || '';
            if (!RETRYABLE_RENAME_CODES.has(code) || attempt === RENAME_MAX_ATTEMPTS - 1) {
                throw err;
            }
            syncSleep(RENAME_RETRY_MS);
        }
    }
}

// AD-307 reopen: async sibling of renameWithRetry. The heartbeat handler
// fires every 10 s during a run, and `fs.renameSync` (plus `writeFileSync`
// upstream) blocks the entire Node event loop — so a ~2 s write on Windows
// during AV scan freezes *all* in-flight HTTP requests, not just same-project
// ones. The async path yields to the event loop between attempts and during
// the rename itself, so cross-project UI stays responsive.
async function renameWithRetryAsync(src: string, dest: string) {
    for (let attempt = 0; attempt < RENAME_MAX_ATTEMPTS; attempt++) {
        try {
            await fs.promises.rename(src, dest);
            return;
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code || '';
            if (!RETRYABLE_RENAME_CODES.has(code) || attempt === RENAME_MAX_ATTEMPTS - 1) {
                throw err;
            }
            await new Promise(resolve => setTimeout(resolve, RENAME_RETRY_MS));
        }
    }
}

export function writeFeedback(data: FeedbackData | Record<string, unknown>, projectId?: string | null) {
    const feedbackPath = getFeedbackPath(projectId);
    const normalized = isFeedbackData(data) ? normalizeFeedbackData(data) : data;
    // AD-211: strip _executionContract from the on-disk shape only; the
    // in-memory `data` keeps it so PATCH responses still carry the field.
    const persistShape = isFeedbackData(normalized as FeedbackData)
        ? {
            ...(normalized as FeedbackData),
            tickets: (normalized as FeedbackData).tickets.map(ticket => {
                const { _executionContract: _omit, ...rest } = ticket;
                return rest as FeedbackTicket;
            }),
        }
        : normalized;
    const payload = JSON.stringify(persistShape, null, 2) + '\n';
    const tmp = `${feedbackPath}.tmp-${process.pid}-${Date.now().toString(36)}`;
    try {
        fs.writeFileSync(tmp, payload, 'utf-8');
        renameWithRetry(tmp, feedbackPath);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch {}
        throw err;
    }
}

// AD-307 reopen: async write for the high-frequency heartbeat path. Same
// atomic temp-then-rename contract as `writeFeedback`, but yields to the
// event loop so other-project requests (project switch, image paste, board
// GETs on a different project) aren't blocked behind heartbeat I/O.
export async function writeFeedbackAsync(
    data: FeedbackData | Record<string, unknown>,
    projectId?: string | null,
): Promise<void> {
    const feedbackPath = getFeedbackPath(projectId);
    const normalized = isFeedbackData(data) ? normalizeFeedbackData(data) : data;
    const persistShape = isFeedbackData(normalized as FeedbackData)
        ? {
            ...(normalized as FeedbackData),
            tickets: (normalized as FeedbackData).tickets.map(ticket => {
                const { _executionContract: _omit, ...rest } = ticket;
                return rest as FeedbackTicket;
            }),
        }
        : normalized;
    const payload = JSON.stringify(persistShape, null, 2) + '\n';
    const tmp = `${feedbackPath}.tmp-${process.pid}-${Date.now().toString(36)}`;
    try {
        await fs.promises.writeFile(tmp, payload, 'utf-8');
        await renameWithRetryAsync(tmp, feedbackPath);
    } catch (err) {
        try { await fs.promises.unlink(tmp); } catch {}
        throw err;
    }
}

function isFeedbackData(data: FeedbackData | Record<string, unknown>): data is FeedbackData {
    return Array.isArray((data as FeedbackData).tickets);
}

export function parseTicketNumber(id: string): number | null {
    const match = id.match(/^(?:AD|VD)-(\d+)$/i);
    return match ? Number.parseInt(match[1], 10) : null;
}

export function formatTicketId(ticketNumber: number): string {
    return `AD-${String(ticketNumber).padStart(3, '0')}`;
}

export function getHighestTicketNumber(tickets: FeedbackTicket[]): number {
    return tickets.reduce((max, ticket) => {
        const parsed = parseTicketNumber(ticket.id);
        return parsed !== null ? Math.max(max, parsed) : max;
    }, 0);
}

export function getNextTicketNumber(data: FeedbackData): number {
    return Math.max(data.nextId || 1, getHighestTicketNumber(data.tickets) + 1);
}

export function allocateTicketId(data: FeedbackData): string {
    const nextNumber = getNextTicketNumber(data);
    data.nextId = nextNumber + 1;
    return formatTicketId(nextNumber);
}

export function normalizeFeedbackData(data: FeedbackData): FeedbackData {
    data.nextId = getNextTicketNumber(data);
    if (!Array.isArray(data.missions)) data.missions = [];
    if (!Array.isArray(data.batches)) data.batches = [];
    if (!Array.isArray(data.sessionActivity)) data.sessionActivity = [];
    data.activeRuns = normalizeRuns(data.activeRuns);
    data.executionContract = data.executionContract || getDefaultExecutionContract();
    if (Array.isArray(data.tickets)) {
        data.tickets = data.tickets.map(normalizeTicket);
    }
    return data;
}

export function resolveTicketById(data: FeedbackData, ticketId: string): TicketLookupResult {
    const matches: number[] = [];
    data.tickets.forEach((ticket, index) => {
        if (ticket.id === ticketId) matches.push(index);
    });

    if (matches.length === 0) {
        return {
            ok: false,
            status: 404,
            error: `Ticket ${ticketId} not found`,
        };
    }

    if (matches.length > 1) {
        return {
            ok: false,
            status: 409,
            error: `Ticket ${ticketId} is duplicated in .adhdev/board.json (${matches.length} matches). Repair the board data before updating this ticket.`,
        };
    }

    const index = matches[0];
    return {
        ok: true,
        index,
        ticket: data.tickets[index],
    };
}

// ─── Auth (standalone: no auth gate, always authorized) ─────────────
export async function checkAdmin(): Promise<{ authorized: boolean; error?: NextResponse }> {
    return { authorized: true };
}

// ─── Default Agent Rules ────────────────────────────────────────────
export function getDefaultAgentRules(): AgentRules {
    return {
        version: 1,
        global: {
            forbiddenStatuses: ['reviewed', 'observe', 'deferred'],
            sessionStart: [
                'Read .adhdev/board.json fresh — never use cached data.',
                'Process tickets where aiAddressable === true and status is reopen/todo.',
                'Reopen > todo. Within status: critical > high > medium > low. Within priority: oldest first (FIFO).',
                'reopenCount >= 2 boosts effective priority by one tier.',
                '@MENTION CHECK: Scan ALL ticket comments for @ai, @claude, @codex, or @chatgpt mentions. Reply to each with your answer via POST /api/feedback/{id}/comments. Discussion only — do NOT change status or start implementation for @mentions.',
            ],
            commentRules: [
                'HARD GATE: Before implementation, use POST /api/feedback/agent-claim to claim the ticket. This opens the live running state and auto-creates the plan comment. Do not rely on passive comments to start running state.',
                "Use authorType: 'ai' and your agent name in all API calls.",
                'Add activity entries for every status change.',
                'Never re-comment if your last comment is the most recent — POST /api/feedback/agent-claim returns 409 if stale.',
                'PLAN REQUIREMENT: Before working on any ticket, add a plan as a comment. Include: what you will change, which files, and your approach. For lengthy plans, summarize in the comment and reference the build plan. No ticket should be worked on without a plan in its comments.',
                'AI agents may only move tickets to todo, reopen, or done. Humans own reviewed/observe/deferred workflow states.',
            ],
        },
        workflows: {
            // 'normal' (and legacy 'issue') — standard ticket, AI can implement.
            // AD-255: `done → reopen` is now allowed so triage can re-surface a
            // closed ticket when a new chat report is clearly related to it.
            // The reopen must carry evidence in the comment (chat msg id,
            // screenshot, or quoted comment) — see ADHDEV.md Chat Run Protocol.
            // `reviewed` / `observe` / `deferred` stay human-owned via
            // forbiddenStatuses above.
            normal: {
                allowedTransitions: {
                    backlog: ['todo'],
                    todo: ['done'],
                    reopen: ['done'],
                    done: ['reopen'],
                    observe: [],
                    reviewed: [],
                },
                instructions: 'Analyze, fix, comment with root cause, move to done.',
            },
            issue: {
                allowedTransitions: {
                    backlog: ['todo'],
                    todo: ['done'],
                    reopen: ['done'],
                    done: ['reopen'],
                    observe: [],
                    reviewed: [],
                },
                instructions: 'Analyze, fix, comment with root cause, move to done.',
            },
            // 'discussion' (and legacy 'idea') — safety lock, no code changes
            discussion: {
                allowedTransitions: {
                    backlog: ['todo'],
                    todo: [],
                    reopen: [],
                    done: [],
                    observe: [],
                    reviewed: [],
                },
                instructions: 'Discussion only — no code changes. Post plan/analysis comment. Wait for human approval before any implementation.',
                requiresPlanComment: true,
                requiresHumanApproval: true,
            },
            idea: {
                allowedTransitions: {
                    backlog: ['todo'],
                    todo: [],
                    reopen: [],
                    done: [],
                    observe: [],
                    reviewed: [],
                },
                instructions: 'Discussion only — no code changes. Post plan/analysis comment. Wait for human approval before any implementation.',
                requiresPlanComment: true,
                requiresHumanApproval: true,
            },
        },
        statusInstructions: {
            backlog: 'Review, comment with analysis, suggest priority.',
            todo: 'Fix the issue (or post plan for ideas).',
            reopen: 'PRIORITY FIX. Previous attempt failed. Read all comments.',
            done: 'Do nothing. Awaiting human review.',
            observe: 'Do nothing. Monitoring.',
            reviewed: 'Do nothing. Never touch.',
        },
    };
}
