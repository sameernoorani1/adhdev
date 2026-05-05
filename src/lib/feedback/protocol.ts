import fs from 'fs';
import path from 'path';

export const ADHDEV_PROTOCOL_FILENAME = 'ADHDEV.md';
export const ADHDEV_EXECUTION_CONTRACT_VERSION = 1;

export interface AdhdevExecutionContract {
    version: number;
    mustReadFullTicketEntry: boolean;
    mustReadCommentsAndActivity: boolean;
    mustCommentPlan: boolean;
    mustCommentCompletion: boolean;
    mustRespondToMentions: boolean;
    mustKeepStatusAccurate: boolean;
    allowedAgentStatuses: string[];
    doneRequires: string[];
}

export function getDefaultExecutionContract(): AdhdevExecutionContract {
    return {
        version: ADHDEV_EXECUTION_CONTRACT_VERSION,
        mustReadFullTicketEntry: true,
        mustReadCommentsAndActivity: true,
        mustCommentPlan: true,
        mustCommentCompletion: true,
        mustRespondToMentions: true,
        mustKeepStatusAccurate: true,
        allowedAgentStatuses: ['todo', 'reopen', 'done'],
        doneRequires: ['ai_comment', 'execution_summary', 'files_touched', 'verification', 'success_result'],
    };
}

// AD-146: canonical place to read the user's preferred display name. Lets an
// agent address the user by whatever name the project's config.json declares.
// AD-200: default is the neutral 'You' (was 'Sameer' historically).
export const DEFAULT_USER_DISPLAY_NAME = 'You';

export function readUserDisplayName(projectRoot: string): string {
    try {
        const configPath = path.join(projectRoot, '.adhdev', 'config.json');
        if (!fs.existsSync(configPath)) return DEFAULT_USER_DISPLAY_NAME;
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const name = typeof parsed?.userDisplayName === 'string' ? parsed.userDisplayName.trim() : '';
        return name || DEFAULT_USER_DISPLAY_NAME;
    } catch {
        return DEFAULT_USER_DISPLAY_NAME;
    }
}

export function buildExecutionContractText(
    contract: AdhdevExecutionContract = getDefaultExecutionContract(),
    userName: string = DEFAULT_USER_DISPLAY_NAME,
): string {
    return [
        `Execution contract v${contract.version}:`,
        '- Read the full ticket entry before acting.',
        '- Read all comments and activity on the ticket before acting.',
        '- Add or update an AI plan comment before implementation.',
        '- Keep status and execution state accurate while working.',
        `- Reply in comments to ${userName}'s mentions on the ticket.`,
        '- Add an AI completion or blocker comment before ending.',
        `- AI may only set statuses: ${contract.allowedAgentStatuses.join(', ')}.`,
        `- Done requires: ${contract.doneRequires.join(', ')}.`,
        // AD-146: address the user by name, not as "human" / "user" / "reporter".
        `- Address the user as "${userName}" in comments and terminal output — never as "human", "user", or "reporter".`,
        '- Add this acknowledgement to the ADHDev Ack Block in the ticket and terminal summary both: ✅ ACK: Embedded Contract Read.',
    ].join('\n');
}

/** Short inline contract string embedded in every ticket so any AI reading the ticket sees it */
export function buildInlineContractNotice(
    contract: AdhdevExecutionContract = getDefaultExecutionContract(),
    userName: string = DEFAULT_USER_DISPLAY_NAME,
): string {
    return `⚠️ AI EXECUTION CONTRACT v${contract.version} — MANDATORY. Before acting on this ticket: (1) Read ADHDEV.md in the project root (2) Read the FULL ticket entry including all comments and activity (3) Post a plan comment before implementation (4) Keep status and execution state accurate (5) Reply to ${userName}'s @mentions in comments (6) Post completion comment with summary, files_touched, verification (7) AI may only set status: ${contract.allowedAgentStatuses.join(', ')} (8) Done requires: ${contract.doneRequires.join(', ')} (9) Address the user as "${userName}" — never as "human"/"user" (10) Include in your Ack Block: ✅ ACK: Embedded Contract Read + ✅ ACK: ADHDev.MD Read`;
}

export function buildAdhdevProtocol(prefix = 'AD', userName: string = DEFAULT_USER_DISPLAY_NAME): string {
    return `# ADHDev Protocol

This file is the project operating protocol for ADHDev. Humans and AI coding agents should follow it when planning, discussing, executing, and updating work.

## Purpose

ADHDev is the control plane for planning and tracking AI-assisted software work. The board is not only a task list; it is the shared system of record for work state, discussion, execution, and review.

## The User

- This project is run by **${userName}**. In comments, terminal output, and summaries, address them as "${userName}" — not as "human", "user", or "reporter".
- The user's display name comes from \`.adhdev/config.json\` (\`userDisplayName\`). If someone else forks this board, that field is the source of truth.

## Source Of Truth

- Board state: \`.adhdev/board.json\`
- Project protocol: \`${ADHDEV_PROTOCOL_FILENAME}\`
- Uploaded artifacts: \`.adhdev/uploads/\`

Agents should read \`${ADHDEV_PROTOCOL_FILENAME}\` and \`.adhdev/board.json\` before acting.
When \`.adhdev/board.json\` is large, do not read it blindly in full. Resolve only the relevant ticket, mission, or batch entries, or use targeted search/offset reads.
For any specific referenced ticket, read the full ticket entry including its comments and activity before acting.

## Core Objects

- Mission: a strategic body of work with goal, context, plan, decisions, and linked tickets.
- Wave: a planned sequence or tranche of work.
- Batch: a focused execution grouping of tickets that should be worked in one coherent pass.
- Ticket: a concrete unit of work tracked on the board.
- Session: an actual human or agent working session.

## IDs

- Ticket IDs use the \`${prefix}\` prefix.
- Mission IDs use the \`MS-\` prefix.

## Ticket Workflow

Primary statuses:

- \`backlog\`: needs review or prioritization
- \`todo\`: ready for execution
- \`reopen\`: previous attempt failed or needs follow-up
- \`done\`: implementation complete, awaiting human review
- \`reviewed\`: human-reviewed and closed
- \`observe\`: monitoring state
- \`deferred\`: intentionally postponed

Rules:

- AI agents may only move tickets to \`todo\`, \`reopen\`, or \`done\`.
- Humans own \`reviewed\`, \`observe\`, and \`deferred\`.
- No ticket should move to \`done\` without an AI comment explaining what was changed.
- Reopened tickets should be treated as priority follow-up work.

## Commenting Rules

- Comment before implementation with a plan.
- Comment after implementation with summary, files touched, and verification.
- If a human mentions an AI in comments, agents should respond in comments rather than silently changing state.
- Comments should capture reasoning, not only outcomes.

## Execution Contract

Every ticket carries a hidden ADHDev execution contract. For any ticket you work on, that contract is mandatory:

${buildExecutionContractText(getDefaultExecutionContract(), userName)
    .split('\n')
    .map(line => `- ${line.replace(/^- /, '')}`)
    .join('\n')}

### Receipt model — what's verified vs claimed

Done-time execution metadata is a **structured receipt** of the run. Not every field carries the same weight; agents and reviewers should treat them differently:

- **\`filesTouched\` — verified file list.** When the project is a git repo, the API ground-truths this on the AI's PATCH-to-done by running \`git diff\` against the baseline ref captured at run-start. The agent's self-reported list is replaced. \`execution.filesTouchedSource = 'git-diff'\` labels the verified case; \`'agent'\` labels the fallback (non-git project, missing baseline, or git failure).
- **\`summary\` — agent-claimed.** Free-form prose. Not verified; trust calibrated to the agent's track record.
- **\`verification\` — agent-claimed.** "Ran tsc clean", "vitest passing", "tested in browser" — these are agent claims about checks they ran. Useful as breadcrumbs; not ground-truthed by ADHDev.
- **\`result\` — agent-claimed.** \`success\` / \`blocked\` / etc. The flag the agent set on itself.

Reviewers reading a Done ticket can lean on the **file list** as the structured / verified portion of the receipt and treat the rest as the agent's claimed account, to be spot-checked.

## Chat Run Protocol

The Brain Dump (\`.adhdev/chat.json\`) is a capture queue for raw thoughts. **Run Chat** triggers triage — board routing only, not engineering. Engineering on any spawned ticket happens later when that ticket is run.

For each chat message with \`status === 'unaddressed'\`, follow this decision order — *exhaust earlier options before reaching for "create new"*:

1. **Extends an existing OPEN ticket?** → \`COMMENT\` (drop a comment on the relevant ticket) or \`EDIT\` (PATCH description / fields).
2. **Re-surfaces a previously-shipped ticket** (\`status: done\`) — i.e. the message reports the bug recurring, the feature regressed, or the fix didn't hold? → \`REOPEN\`: PATCH the ticket from \`done\` to \`reopen\`, AND post a comment that explicitly surfaces the **evidence**: source chat msg id (e.g. \`m-abc123\`), the quoted symptom, any attached screenshot, and what changed since the prior fix. Reopening **without evidence** is a redundant respawn dressed up as a state change — don't do that. **Only \`done\` is reopenable by AI.** \`reviewed\` / \`observe\` / \`deferred\` stay human-owned: if a chat message clearly relates to a \`reviewed\` ticket, post a COMMENT on that ticket flagging the recurrence + evidence and let Sameer decide whether to re-open.
3. **Belongs with another message already triaged this run?** → \`MERGE\`: append the bullet/context to the ticket already created for the sibling message; do not spawn a duplicate.
4. **Direct follow-up to a specific existing ticket?** → \`SUB-TASK\`: create with \`relations: [{kind: 'subtask', ticketId: '<parent>'}]\` so the parent's Linked panel surfaces it. Inverse is auto-mirrored — never set both sides.
5. **Sibling of new tickets being spawned in this same run?** → set \`subtask\` of the originating epic on each (so they share a parent and the Linked panel groups them) — *not* a flat list of disconnected new tickets.
6. **None of the above?** → \`CREATE\` standalone, but only after explicitly considering 1-5.
7. **Vague / revisit later?** → \`noted\`.

**Tag taxonomy is closed.** Allowed values: \`bug\`, \`feature\`, \`polish\`, \`perf\`, \`infra\`, \`ai\`. The API rejects anything else on POST/PATCH with a 400. Tags describe *type*, not surface (use the title for surface) and not roadmap phase (that lives in \`wave\`/\`missionId\`).

**Relation kinds:** \`parent\`, \`subtask\`, \`duplicate-of\`, \`blocks\`, \`blocked-by\`. \`parent\`↔\`subtask\` and \`blocks\`↔\`blocked-by\` are auto-mirrored — set one side only.
2. Take the action via \`POST\` / \`PATCH /api/feedback\`. Carry over any attached images from the chat message into the ticket's images. On every affected ticket, post a one-line breadcrumb comment naming the source chat message id (e.g. \`Created from chat message m-abc123\`).
3. Reply on the chat message: \`POST /api/chat\` with \`parentMessageId\`, \`authorType: "ai"\`, one-line content (e.g. \`Created ${prefix}-201\`, \`Edited ${prefix}-152\`, \`Merged into ${prefix}-180\`, \`Noted — will revisit\`).
4. Mark the source message addressed: \`PATCH /api/chat\` with \`status: "addressed"\` and an \`actions\` entry recording what you did.

When all messages are processed, post a single closing \`system\` summary to chat: \`POST /api/chat\` with \`authorType: "system"\`, content like \`✅ Triage complete: N message(s).\`

Do not open source files during triage — these are product feedback messages, not engineering tasks.

## Mission Rules

Create a mission when work needs:

- shared planning
- architectural discussion
- multiple linked tickets
- decision logging
- progress tracked as a coordinated body of work

Each mission should maintain:

- summary
- goal
- context
- proposed plan
- agreed plan
- success criteria
- notes
- decision log

## Waves, Batches, Sessions

- Use waves to represent planned sequence.
- Use batches to group tickets that should be executed in one focused coding pass.
- Use sessions to represent actual work windows or agent runs.

Batching criteria:

- shared code area
- dependency order
- context-switch cost
- verification overlap
- risk concentration
- reasonable size

Do not group unrelated tickets just to make batch sizes equal.

## Run And Discuss Modes

- Run Ticket / Run Batch: execution mode. The agent should work the ticket(s).
- Discuss Mission: planning mode. The agent should refine plan, risks, and sequencing without starting implementation unless explicitly told to.

## Expected Updates

After meaningful work, update ADHDev:

- ticket status
- comments
- mission plan or decisions when relevant
- batches if planning changed

Humans and AI should keep the board current enough that another person or agent can resume without hidden context.

## Ack Marker

At the end of the terminal summary and in the ticket update, if you read this file, add this acknowledgement to the ADHDev Ack Block:

- \`✅ ACK: ADHDev.MD Read\`
`;
}

const CLAUDE_MD_ADHDEV_MARKER = '<!-- adhdev-protocol -->';

function buildClaudeMdAdhdevBlock(): string {
    return `${CLAUDE_MD_ADHDEV_MARKER}
## ADHDev Protocol (auto-injected)

> **MANDATORY:** Read \`ADHDEV.md\` in the project root before acting on any ticket.
> It defines the execution contract, workflow rules, and acknowledgement requirements.
> Every ticket carries a \`contractVersion\` and \`_executionContract\` field — read them.

- Board data: \`.adhdev/board.json\`
- Protocol: \`ADHDEV.md\`
- API base: \`http://localhost:3111/api/feedback\`
${CLAUDE_MD_ADHDEV_MARKER}`;
}

function ensureClaudeMdReference(projectRoot: string) {
    const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
    const block = buildClaudeMdAdhdevBlock();

    if (!fs.existsSync(claudeMdPath)) {
        // No CLAUDE.md — create one with just the ADHDev block
        fs.writeFileSync(claudeMdPath, block + '\n', 'utf-8');
        return;
    }

    const existing = fs.readFileSync(claudeMdPath, 'utf-8');

    if (existing.includes(CLAUDE_MD_ADHDEV_MARKER)) {
        // Already has the block — update it in place
        const markerRegex = new RegExp(
            `${CLAUDE_MD_ADHDEV_MARKER}[\\s\\S]*?${CLAUDE_MD_ADHDEV_MARKER}`,
        );
        const updated = existing.replace(markerRegex, block);
        if (updated !== existing) {
            fs.writeFileSync(claudeMdPath, updated, 'utf-8');
        }
        return;
    }

    // CLAUDE.md exists but has no ADHDev block — append it
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    fs.writeFileSync(claudeMdPath, existing + separator + block + '\n', 'utf-8');
}

export function ensureAdhdevProtocol(projectRoot: string, prefix = 'AD') {
    const protocolPath = path.join(projectRoot, ADHDEV_PROTOCOL_FILENAME);
    const userName = readUserDisplayName(projectRoot);
    const nextContent = buildAdhdevProtocol(prefix, userName);
    const existingContent = fs.existsSync(protocolPath)
        ? fs.readFileSync(protocolPath, 'utf-8')
        : null;

    if (existingContent !== nextContent) {
        fs.writeFileSync(protocolPath, nextContent, 'utf-8');
    }

    // TODO: re-enable after testing — ensureClaudeMdReference(projectRoot);

    return protocolPath;
}

export function readAdhdevProtocol(projectRoot: string): string | null {
    const protocolPath = path.join(projectRoot, ADHDEV_PROTOCOL_FILENAME);
    if (!fs.existsSync(protocolPath)) return null;
    return fs.readFileSync(protocolPath, 'utf-8');
}
