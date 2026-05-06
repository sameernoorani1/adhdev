#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve, basename } from 'path';
import { execSync, spawn } from 'child_process';
import { homedir } from 'os';
import readline from 'readline';

const args = process.argv.slice(2);
const command = args[0];

// AD-134: minimal interactive prompt. Resolves to the user's trimmed input, or
// `fallback` when the user just hits Enter (mirrors `npm init` UX).
function prompt(question, fallback) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || '').trim() || fallback || '');
    });
  });
}

// AD-134: probe for a usable Claude Code install. Never blocks init — just
// prints a copy-paste upgrade/install hint so the user can repair in one step.
function probeClaudeVersion() {
  try {
    const out = execSync('claude --version', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = out.match(/(\d+)\.(\d+)/);
    const major = m ? parseInt(m[1], 10) : 0;
    if (major >= 2) {
      console.log(`  ✓ Claude Code detected: ${out}`);
    } else {
      console.log('\n  ⚠ Claude Code version looks outdated:');
      console.log(`      ${out}`);
      console.log('    Upgrade in one step:');
      console.log('      npm i -g @anthropic-ai/claude-code@latest');
    }
  } catch {
    console.log('\n  ℹ Claude Code not found on PATH.');
    console.log('    The board works with any coding agent, but the Run button is wired');
    console.log('    for Claude Code. Install (optional but recommended):');
    console.log('      npm i -g @anthropic-ai/claude-code@latest');
  }
}

const LOGO = `
  ╔═══════════════════════════════╗
  ║        A D H D e v            ║
  ║   AI Agent Control Plane      ║
  ╚═══════════════════════════════╝
`;

// ─── Registry (multi-project) ───────────────────────────────────────

const ADHDEV_HOME = join(homedir(), '.adhdev');
const REGISTRY_PATH = join(ADHDEV_HOME, 'registry.json');

function ensureHome() {
  if (!existsSync(ADHDEV_HOME)) mkdirSync(ADHDEV_HOME, { recursive: true });
}

function readRegistry() {
  ensureHome();
  if (!existsSync(REGISTRY_PATH)) return { projects: [], activeProjectId: null };
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
}

function writeRegistry(registry) {
  ensureHome();
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

function registerProject(projectPath, name, prefix) {
  const absPath = resolve(projectPath);
  const registry = readRegistry();

  const existing = registry.projects.find(p => p.path === absPath);
  if (existing) {
    registry.activeProjectId = existing.id;
    writeRegistry(registry);
    return { project: existing, isNew: false };
  }

  const id = `proj-${Date.now().toString(36)}`;
  const project = {
    id,
    name: name || basename(absPath),
    path: absPath,
    addedAt: new Date().toISOString(),
    prefix: prefix || 'AD',
  };

  registry.projects.push(project);
  registry.activeProjectId = id;
  writeRegistry(registry);
  return { project, isNew: true };
}

// ─── Project Directory Setup ────────────────────────────────────────

function buildSeedTickets(prefix, now) {
  // AD-135: three seed tickets that teach the core loop. ticketType: "onboarding"
  // lets the UI render a guided-step badge (AD-136) and the server auto-resolves
  // the "create your first real ticket" seed on first non-onboarding ticket creation.
  const mk = (n, fields) => ({
    id: `${prefix}-00${n}`,
    reporter: 'ADHDev',
    images: [],
    tags: ['onboarding'],
    reopenCount: 0,
    comments: [],
    activity: [{ action: 'created', by: 'ADHDev', byType: 'system', at: now, snapshot: { title: fields.title } }],
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    missionId: '',
    wave: '',
    session: '',
    ...fields,
  });
  return [
    mk(1, {
      title: 'Meet Claude',
      description: "Your first ticket. Click Run on this card — Claude Code picks it up, writes a comment back, and moves this ticket to done. That's the whole loop.\n\nWhen Claude runs this, comment back with '✅ Onboarding acknowledged' and move to done.",
      status: 'todo',
      priority: 'high',
      ticketType: 'onboarding',
      aiAddressable: true,
    }),
    mk(2, {
      title: 'Create your first real ticket',
      description: 'Try it yourself. Hit the + button (or press N) and write a ticket for something you actually want AI help with — a bug, a tweak, a refactor. This step auto-completes the moment you create any non-onboarding ticket.',
      status: 'todo',
      priority: 'medium',
      ticketType: 'onboarding',
      aiAddressable: false,
    }),
    mk(3, {
      title: 'Try the Discuss flow',
      description: "Not every ticket is for implementation — some are for thinking.\n\nThis is a `discussion` ticket: click Run and Claude will reply with a plan/answer rather than changing code. Use this pattern for architecture calls, product questions, and scope decisions.\n\n**Question to get you started:** What's the first real mission you want to ship with ADHDev? Sketch the goal, the risks, and the first batch.",
      status: 'todo',
      priority: 'medium',
      ticketType: 'discussion',
      aiAddressable: true,
    }),
  ];
}

function initProjectDir(projectRoot, prefix = 'AD', seed = true) {
  const adhdevDir = join(projectRoot, '.adhdev');
  if (!existsSync(adhdevDir)) mkdirSync(adhdevDir, { recursive: true });

  const boardPath = join(adhdevDir, 'board.json');
  const isNew = !existsSync(boardPath);
  if (isNew) {
    const now = new Date().toISOString();
    const tickets = seed ? buildSeedTickets(prefix, now) : [
      {
        id: `${prefix}-001`,
        title: 'Welcome to ADHDev',
        description: "This is your AI agent control plane. Here's how to get started:\n\n1. Drag this ticket to To Do to try the Kanban board\n2. Click on any ticket to open the detail view\n3. Add a comment to track your thinking\n4. Create new tickets with the + button or press N\n5. Use Ctrl+F to search across all tickets\n\nWhen you connect an AI agent (Claude Code, etc.), you can trigger runs directly from the board and watch responses stream in.",
        status: 'backlog',
        priority: 'medium',
        ticketType: 'normal',
        aiAddressable: false,
        reporter: 'ADHDev',
        images: [],
        tags: ['getting-started'],
        reopenCount: 0,
        comments: [],
        activity: [{ action: 'created', by: 'ADHDev', byType: 'human', at: now, snapshot: { title: 'Welcome to ADHDev' } }],
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
      },
    ];
    const board = {
      nextId: tickets.length + 1,
      columns: {
        backlog: { label: 'Backlog', aiInstruction: 'Review, comment with analysis, suggest priority.' },
        todo: { label: 'To Do', aiInstruction: 'Fix the issue (or post plan for discussions).' },
        reopen: { label: 'Reopen', aiInstruction: 'PRIORITY FIX. Previous attempt failed. Read all comments.' },
        done: { label: 'Done', aiInstruction: 'Do nothing. Awaiting human review.' },
        reviewed: { label: 'Reviewed', aiInstruction: 'Do nothing. Never touch.' },
        observe: { label: 'Observe', aiInstruction: 'Do nothing. Monitoring.' },
        deferred: { label: 'Deferred', aiInstruction: 'Do nothing. Postponed.' },
      },
      tickets,
      batches: [],
    };
    writeFileSync(boardPath, JSON.stringify(board, null, 2) + '\n');
  }

  const configPath = join(adhdevDir, 'config.json');
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify({ prefix, agents: ['Claude Code'] }, null, 2) + '\n');
  }

  const protocolPath = join(projectRoot, 'ADHDEV.md');
  if (!existsSync(protocolPath)) {
    writeFileSync(protocolPath, buildAdhdevProtocol(prefix), 'utf-8');
  }

  const uploadsDir = join(adhdevDir, 'uploads');
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

  return isNew;
}

function buildAdhdevProtocol(prefix = 'AD') {
  return `# ADHDev Protocol

This file is the shared operating protocol for ADHDev in this project. Humans and AI coding agents should follow it when planning, discussing, executing, and updating work.

## Source Of Truth

- Board state: \`.adhdev/board.json\`
- Project protocol: \`ADHDEV.md\`
- Uploaded artifacts: \`.adhdev/uploads/\`

Agents should read \`ADHDEV.md\` and \`.adhdev/board.json\` before acting.

## Core Objects

- Mission: a strategic body of work with goal, context, plan, decisions, and linked tickets
- Wave: a planned sequence or tranche of work
- Batch: a focused execution grouping of tickets that should be worked in one coherent pass
- Ticket: a concrete unit of work tracked on the board
- Session: an actual human or agent working session

## IDs

- Ticket IDs use the \`${prefix}\` prefix
- Mission IDs use the \`MS-\` prefix

## Workflow Rules

- \`backlog\`: needs review or prioritization
- \`todo\`: ready for execution
- \`reopen\`: previous attempt failed or needs follow-up
- \`done\`: implementation complete, awaiting human review
- \`reviewed\`: human-reviewed and closed
- \`observe\`: monitoring state
- \`deferred\`: intentionally postponed

- AI agents may only move tickets to \`todo\`, \`reopen\`, or \`done\`
- Humans own \`reviewed\`, \`observe\`, and \`deferred\`
- No ticket should move to \`done\` without an AI comment explaining what was changed
- Reopened tickets should be treated as priority work

## Commenting Rules

- Comment before implementation with a plan
- Comment after implementation with summary, files touched, and verification
- If a human mentions an AI in comments, agents should respond in comments rather than silently changing state

## Ack Marker

To debug whether instructions actually landed, AI should append explicit acknowledgement lines at the end of its plan and completion comments:

- \`ADHDEV ACK: Prompt Guidance Read\`
- \`ADHDEV ACK: ADHDEV.md Read\`
- \`ADHDEV ACK: Embedded Contract Read\`
- Only include a line for a source that was actually received or read

At the end of the terminal/chat summary, AI should also include a short guidance receipt block:

- \`ADHDev Guidance Sources\`
- Only list sources actually received or read during the session
- \`✅ Prompt Guidance\`
- \`✅ ADHDev MD File\`
- \`✅ Embedded Contract\`

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

- Use waves for planned sequence
- Use batches for focused execution groupings
- Use sessions for actual work windows or agent runs

Batching criteria:

- shared code area
- dependency order
- context-switch cost
- verification overlap
- risk concentration
- reasonable size

## Run And Discuss Modes

- Run Ticket / Run Batch: execution mode
- Discuss Mission: planning mode unless explicitly asked to implement

## Expected Updates

After meaningful work, update ADHDev:

- ticket status
- comments
- mission plan or decisions when relevant
- batches if planning changed
`;
}

// ─── Claude Code Hooks Configuration ────────────────────────────────

function configureClaudeHooks(projectRoot) {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  let settings = {};

  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, 'utf-8')); } catch { settings = {}; }
  }

  if (!settings.hooks) settings.hooks = {};

  const boardUrl = 'http://localhost:3111/api/hooks/activity';
  const marker = '__ adhdev __';

  // Check if already configured
  const alreadyConfigured = JSON.stringify(settings.hooks).includes(marker);
  if (alreadyConfigured) {
    console.log('  ✓ Claude Code hooks already configured');
    return;
  }

  // Add PostToolUse hook — captures file edits, commands, searches
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];
  settings.hooks.PostToolUse.push({
    matcher: '',
    hooks: [{
      type: 'http',
      url: boardUrl,
      timeout: 5,
      statusMessage: marker,
    }],
  });

  // Add SessionStart hook
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
  settings.hooks.SessionStart.push({
    matcher: '',
    hooks: [{
      type: 'http',
      url: boardUrl,
      timeout: 5,
      statusMessage: marker,
    }],
  });

  // Add Stop hook
  if (!settings.hooks.Stop) settings.hooks.Stop = [];
  settings.hooks.Stop.push({
    matcher: '',
    hooks: [{
      type: 'http',
      url: boardUrl,
      timeout: 5,
      statusMessage: marker,
    }],
  });

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log('  ✓ Configured Claude Code hooks in .claude/settings.json');
  console.log('    Hooks: PostToolUse, SessionStart, Stop → ADHDev board');
}

// ─── Commands ───────────────────────────────────────────────────────

async function init() {
  console.log(LOGO);
  // First positional arg after "init" is the path; skip flags like --name=, -y, etc.
  const positional = args.slice(1).find(a => !a.startsWith('-'));
  const projectRoot = resolve(positional || '.');

  // AD-134: flags still work (CI / scripted installs). Interactive prompts only
  // kick in when the user didn't pass the relevant flag and we have a TTY.
  const nameFlag = args.find(a => a.startsWith('--name='))?.split('=')[1];
  const prefixFlag = args.find(a => a.startsWith('--prefix='))?.split('=')[1];
  const noSeedFlag = args.includes('--no-seed');
  const noStartFlag = args.includes('--no-start');
  const yesFlag = args.includes('--yes') || args.includes('-y');
  const interactive = process.stdin.isTTY && !yesFlag;

  let name = nameFlag;
  let prefix = prefixFlag;
  let seed = !noSeedFlag;

  if (interactive && !nameFlag) {
    name = await prompt(`  Project name [${basename(projectRoot)}]: `, basename(projectRoot));
  }

  if (interactive && !prefixFlag) {
    while (true) {
      const raw = await prompt('  Ticket prefix [AD]: ', 'AD');
      if (/^[A-Z]{1,6}$/.test(raw)) { prefix = raw; break; }
      console.log('    Prefix must be 1–6 uppercase letters (e.g. AD, FOO).');
    }
  }
  if (!prefix) prefix = 'AD';

  if (interactive && !noSeedFlag) {
    const raw = await prompt('  Seed with onboarding tickets? [Y/n]: ', 'Y');
    seed = !/^n/i.test(raw);
  }

  console.log(`\n  Initializing ADHDev in ${projectRoot}...\n`);

  const isNew = initProjectDir(projectRoot, prefix, seed);
  const { project, isNew: isNewReg } = registerProject(projectRoot, name, prefix);

  if (isNew) {
    console.log('  ✓ Created .adhdev/board.json (with welcome ticket)');
    console.log('  ✓ Created .adhdev/config.json');
    console.log('  ✓ Created .adhdev/uploads/');
    console.log('  ✓ Created ADHDEV.md');
  } else {
    console.log('  ✓ .adhdev/ already exists');
  }

  // AD-134: extend .adhdev/config.json with the fields the onboarding rollout
  // needs (projectId, prefix, createdAt, seeded, onboardingState, onboardingEvents).
  // AD-onboard-3/-4/-5 will read/write this; AD-onboard-2 will write the seed
  // content itself. Write-once for timestamps — never overwrite existing values.
  try {
    const configPath = join(projectRoot, '.adhdev', 'config.json');
    const existing = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : {};
    const now = new Date().toISOString();
    const updated = {
      ...existing,
      projectId: existing.projectId || project.id,
      prefix,
      createdAt: existing.createdAt || project.addedAt || now,
      seeded: typeof existing.seeded === 'boolean' ? existing.seeded : seed,
      agents: existing.agents || ['Claude Code'],
      onboardingState: {
        welcomeSeen: false,
        coachMarks: {},
        checklistDismissed: false,
        ...(existing.onboardingState || {}),
      },
      onboardingEvents: {
        initAt: now,
        ...(existing.onboardingEvents || {}),
      },
    };
    writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n');
  } catch (err) {
    console.log(`  ⚠ Could not update .adhdev/config.json: ${err.message}`);
  }

  if (isNewReg) {
    console.log(`  ✓ Registered project "${project.name}" in ~/.adhdev/registry.json`);
  } else {
    console.log(`  ✓ Project "${project.name}" already registered (set as active)`);
  }

  // Add to .gitignore
  const gitignorePath = join(projectRoot, '.gitignore');
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    if (!content.includes('.adhdev/uploads')) {
      writeFileSync(gitignorePath, content.trimEnd() + '\n.adhdev/uploads/\n');
      console.log('  ✓ Added .adhdev/uploads/ to .gitignore');
    }
  }

  // Configure Claude Code hooks if .claude/ exists
  const claudeDir = join(projectRoot, '.claude');
  if (existsSync(claudeDir)) {
    configureClaudeHooks(projectRoot);
  } else {
    console.log('\n  ℹ No .claude/ directory found. To enable CLI capture:');
    console.log('    mkdir .claude && adhdev init');
  }

  // AD-134: Claude Code version probe (non-blocking, hint-only).
  probeClaudeVersion();

  // AD-134: surface the cohabitation hint if this is a Node project.
  const pkgJsonPath = join(projectRoot, 'package.json');
  if (existsSync(pkgJsonPath)) {
    console.log('\n  ℹ Tip: add `"adhdev:dev": "adhdev"` to package.json scripts to');
    console.log('    launch the board alongside your own dev server.');
  }

  const registry = readRegistry();
  if (registry.projects.length > 1) {
    console.log(`\n  You have ${registry.projects.length} projects registered:`);
    registry.projects.forEach(p => {
      const active = p.id === registry.activeProjectId ? ' ●' : '  ';
      console.log(`  ${active} ${p.name} — ${p.path}`);
    });
  }

  // AD-134: seamless first-run — start the board and open the browser unless
  // --no-start was passed (useful for CI / scripted setups).
  if (noStartFlag) {
    console.log('\n  Done! Run `adhdev` to open the board.\n');
    return;
  }
  console.log('\n  Starting the board…\n');
  await start();
}

async function isPortInUse(port) {
  return new Promise((resolve) => {
    import('net').then(({ default: net }) => {
      const server = net.createServer();
      server.once('error', (err) => {
        resolve(err.code === 'EADDRINUSE');
      });
      server.once('listening', () => {
        server.close();
        resolve(false);
      });
      server.listen(port);
    });
  });
}

async function start() {
  console.log(LOGO);

  const registry = readRegistry();
  if (registry.projects.length === 0) {
    // AD-239: prompt before silently initializing in cwd. If the user runs
    // `adhdev` from the wrong folder by mistake (Desktop, home dir, etc.),
    // we'd otherwise pollute that folder with .adhdev/ + use the folder's
    // basename as the project name. One Y/n confirmation + an optional name
    // override is cheap insurance.
    const cwd = process.cwd();
    const defaultName = basename(cwd);
    const interactive = process.stdin.isTTY && !args.includes('--yes') && !args.includes('-y');

    if (interactive) {
      const proceed = await prompt(`  Initialize ADHDev in ${cwd}? Project name will be "${defaultName}". (Y/n): `, 'Y');
      if (/^n/i.test(String(proceed).trim())) {
        console.log('  Aborted. Run `adhdev init` from inside a project directory to start.\n');
        process.exit(0);
      }
      const customName = await prompt(`  Custom project name (Enter to keep "${defaultName}"): `, defaultName);
      console.log('');
      initProjectDir(cwd);
      registerProject(cwd, String(customName).trim() || defaultName);
    } else {
      // No TTY or --yes flag → non-interactive auto-init (preserves the
      // CI / scripted-install path).
      console.log('  No projects registered. Initializing current directory...\n');
      initProjectDir(cwd);
      registerProject(cwd);
    }
  }

  const active = registry.projects.find(p => p.id === registry.activeProjectId) || registry.projects[0];
  if (active) {
    console.log(`  Active project: ${active.name} (${active.path})`);
  }

  const port = 3111;
  const termPort = 3112;

  // Check if ports are already in use — if board port is taken, just open browser
  const boardInUse = await isPortInUse(port);
  if (boardInUse) {
    console.log(`  ✓ Board already running on http://localhost:${port}`);
    console.log('  Opening browser...\n');
    try {
      const openCmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      execSync(`${openCmd} http://localhost:${port}`, { stdio: 'ignore' });
    } catch { /* fine */ }
    return;
  }

  const pkgDir = findPackageDir();
  if (!pkgDir) {
    console.log('  Error: Cannot find ADHDev package.\n');
    process.exit(1);
  }

  // Start terminal WebSocket server (background, skip if already running)
  const terminalScript = join(pkgDir, 'server', 'terminal.mjs');
  let termChild = null;
  const termInUse = await isPortInUse(termPort);
  if (existsSync(terminalScript) && !termInUse) {
    termChild = spawn('node', [terminalScript], {
      cwd: active?.path || process.cwd(),
      env: { ...process.env, TERMINAL_PORT: String(termPort), ADHDEV_CWD: active?.path || process.cwd() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    termChild.stdout.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.log(`  [terminal] ${msg}`);
    });
    termChild.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg && !msg.includes('ExperimentalWarning')) console.error(`  [terminal] ${msg}`);
    });
    console.log(`  ✓ Terminal server starting on ws://localhost:${termPort}`);
  }

  // Start Next.js board server
  // AD-182: auto-detect whether we're running from a source checkout (where
  // dev mode + HMR is wanted) vs an installed npm copy (where prod mode is
  // wanted to avoid Next dev's monotonic memory growth — see AD-171).
  // `.git/` is the discriminator: present in source checkouts, never present
  // in published tarballs (`npm pack` excludes it). The published package
  // ships a prebuilt `.next/` via the `files` allowlist + `prepack` script
  // in package.json, so `next start` has something to serve.
  const isSourceCheckout = existsSync(join(pkgDir, '.git'));
  const hasPrebuild = existsSync(join(pkgDir, '.next', 'BUILD_ID'));
  const useProd = !isSourceCheckout && hasPrebuild;
  // AD-201: bind to 127.0.0.1 so the dev/prod server is not reachable from the
  // wider network. The terminal server is similarly bound (server/terminal.mjs).
  const nextArgs = useProd
    ? ['next', 'start', '-H', '127.0.0.1', '-p', String(port)]
    : ['next', 'dev', '-H', '127.0.0.1', '-p', String(port)];
  console.log(`  ✓ Board starting on http://localhost:${port} (${useProd ? 'prod' : 'dev'} mode)\n`);

  // AD-238 (third pass): on Windows, `npx` is `npx.cmd`. Node's
  // `child_process.spawn` cannot execute `.cmd` / `.bat` files directly
  // (throws EINVAL), and the prior fix that set `shell: true` re-triggered
  // DEP0190 (Node's deprecation of "args concatenated, not escaped" under
  // shell mode). The right shape on Windows is to invoke `cmd.exe /c npx`
  // explicitly: cmd.exe is an `.exe` so spawn runs it without any implicit
  // shell wrapping, `/c` makes it execute the remaining tokens as a
  // command, and the array form keeps each arg as its own array element.
  // No `shell` option, no DEP0190, no EINVAL.
  //
  // The other spawn site in this file (`spawn('node', [terminalScript], …)`)
  // stays array-form / no-shell — `node` is an `.exe` on every platform.
  const isWin = process.platform === 'win32';
  const spawnCmd = isWin ? 'cmd.exe' : 'npx';
  const spawnArgs = isWin ? ['/c', 'npx', ...nextArgs] : nextArgs;
  const nextChild = spawn(spawnCmd, spawnArgs, {
    cwd: pkgDir,
    env: { ...process.env, PORT: String(port) },
    stdio: 'inherit',
  });

  // Auto-open browser once ready — single attempt via polling
  let opened = false;
  let checking = false;
  const http = await import('http');
  const openInterval = setInterval(() => {
    if (opened || checking) return;
    checking = true;
    const req = http.default.get(`http://localhost:${port}/api/projects`, (res) => {
      checking = false;
      if (opened) return;
      if (res.statusCode === 200) {
        opened = true;
        clearInterval(openInterval);
        try {
          const openCmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
          execSync(`${openCmd} http://localhost:${port}`, { stdio: 'ignore' });
        } catch { /* fine */ }
      }
    });
    req.on('error', () => { checking = false; });
    req.end();
  }, 2000);
  setTimeout(() => clearInterval(openInterval), 30000);

  // Clean shutdown — kill both processes
  const cleanup = () => {
    clearInterval(openInterval);
    termChild?.kill();
    nextChild.kill();
    process.exit(0);
  };

  nextChild.on('error', (err) => { console.error('Failed:', err.message); cleanup(); });
  nextChild.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

function add() {
  const projectPath = resolve(args[1] || '.');
  if (!existsSync(projectPath)) {
    console.log(`  Error: Path does not exist: ${projectPath}`);
    process.exit(1);
  }

  const name = args.find(a => a.startsWith('--name='))?.split('=')[1];
  initProjectDir(projectPath);
  const { project, isNew } = registerProject(projectPath, name);

  if (isNew) {
    console.log(`  ✓ Added "${project.name}" (${projectPath})`);
  } else {
    console.log(`  ✓ "${project.name}" already registered (set as active)`);
  }
}

function list() {
  const registry = readRegistry();
  if (registry.projects.length === 0) {
    console.log('  No projects registered. Run `adhdev init` in a project directory.');
    return;
  }
  console.log(LOGO);
  console.log('  Projects:\n');
  registry.projects.forEach(p => {
    const active = p.id === registry.activeProjectId ? ' ●' : '  ';
    const boardPath = join(p.path, '.adhdev', 'board.json');
    let ticketCount = 0;
    try {
      const data = JSON.parse(readFileSync(boardPath, 'utf-8'));
      ticketCount = data.tickets?.length || 0;
    } catch { /* ignore */ }
    console.log(`  ${active} ${p.name.padEnd(20)} ${String(ticketCount).padStart(3)} tickets   ${p.path}`);
  });
  console.log('');
}

function switchProject() {
  const target = args[1];
  if (!target) { console.log('  Usage: adhdev switch <project-name>'); return; }

  const registry = readRegistry();
  const project = registry.projects.find(p => p.name.toLowerCase() === target.toLowerCase() || p.id === target);
  if (!project) {
    console.log(`  Project "${target}" not found. Run \`adhdev list\` to see projects.`);
    return;
  }

  registry.activeProjectId = project.id;
  writeRegistry(registry);
  console.log(`  ✓ Switched to "${project.name}"`);
}

function status() {
  const registry = readRegistry();
  const active = registry.projects.find(p => p.id === registry.activeProjectId) || registry.projects[0];

  if (!active) { console.log('  No projects. Run `adhdev init`.'); return; }

  const boardPath = join(active.path, '.adhdev', 'board.json');
  if (!existsSync(boardPath)) { console.log(`  No board data for "${active.name}".`); return; }

  const data = JSON.parse(readFileSync(boardPath, 'utf-8'));
  const tickets = data.tickets || [];

  // AD-138: read local onboarding telemetry from .adhdev/config.json
  const configPath = join(active.path, '.adhdev', 'config.json');
  let config = {};
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { /* ignore */ }
  }
  const events = config.onboardingEvents || {};

  console.log(LOGO);
  console.log(`  Project:    ${active.name}`);
  console.log(`  ID:         ${active.id}`);
  console.log(`  Prefix:     ${config.prefix || active.prefix || 'AD'}`);
  console.log(`  Path:       ${active.path}`);
  console.log(`  Config:     ${configPath}`);
  console.log(`  Tickets:    ${tickets.length}\n`);

  console.log('  Tickets by status:');
  const byStatus = {};
  tickets.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });
  Object.entries(byStatus).forEach(([s, c]) => console.log(`    ${s.padEnd(12)} ${c}`));

  // AD-138: onboarding funnel. Show each event or "— not yet".
  console.log('\n  Onboarding funnel:');
  const funnel = [
    ['initAt',              'Initialized             '],
    ['firstBoardViewAt',    'First board view        '],
    ['firstRunAt',          'First AI run            '],
    ['firstUserTicketAt',   'First real ticket       '],
    ['firstDoneAt',         'First ticket → done     '],
  ];
  funnel.forEach(([k, label]) => {
    const v = events[k];
    console.log(`    ${label} ${v ? v : '— not yet'}`);
  });

  if (events.initAt && events.firstRunAt) {
    const dt = new Date(events.firstRunAt) - new Date(events.initAt);
    if (Number.isFinite(dt) && dt >= 0) {
      const secs = Math.round(dt / 1000);
      const human = secs < 120 ? `${secs}s` : `${Math.round(secs / 60)}m`;
      console.log(`\n  Time-to-first-AI-run: ${human}`);
    }
  }

  // AD-138: reuse the same Claude Code probe as init.
  console.log('');
  probeClaudeVersion();
  console.log('');
}

function findPackageDir() {
  const selfDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  const pkgDir = resolve(selfDir, '..');
  if (existsSync(join(pkgDir, 'next.config.mjs'))) return pkgDir;
  try {
    const resolved = execSync('node -e "console.log(require.resolve(\'adhdev/package.json\'))"', { encoding: 'utf-8' }).trim();
    return resolve(resolved, '..');
  } catch { /* ignore */ }
  return pkgDir;
}

// ─── Main ───────────────────────────────────────────────────────────

function showHelp() {
  console.log(LOGO);
  console.log('  Usage: adhdev <command>\n');
  console.log('  Commands:');
  console.log('    init [path]     Initialize ADHDev in a project (default: current dir)');
  console.log('                    Prompts for project name, ticket prefix, and seed tickets.');
  console.log('                    Flags: --name=X --prefix=X --no-seed --no-start -y/--yes');
  console.log('    add <path>      Register an existing project');
  console.log('    list            Show all registered projects');
  console.log('    switch <name>   Switch active project');
  console.log('    status          Show active project summary');
  console.log('    help            Show this help');
  console.log('');
  console.log('  Run `adhdev` with no arguments to start the board.\n');
}

switch (command) {
  case 'init': init(); break;
  case 'add': add(); break;
  case 'list': case 'ls': list(); break;
  case 'switch': case 'use': switchProject(); break;
  case 'status': status(); break;
  case 'help': case '--help': case '-h': showHelp(); break;
  case undefined: start(); break;
  default:
    console.log(`  Unknown command: ${command}. Run 'adhdev help' for usage.`);
    process.exit(1);
}
