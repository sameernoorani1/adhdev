# ADHDev

AI Agent Control Plane for developers. Track, trigger, and review AI coding work from a single Kanban board.

## Quick Start

```bash
npx adhdev init    # Initialize in your project
npx adhdev start   # Open the board at localhost:3111
```

`adhdev init` creates `.adhdev/` plus `ADHDEV.md`, the shared operating protocol for humans and AI agents in the project.

## What it does

- **Kanban board** for tracking AI agent work (backlog → todo → done → reviewed)
- **One-click Run** — trigger Claude Code on any ticket from the board
- **Live streaming** — watch AI responses flow into ticket comments
- **Agent rules** — enforce transition gates (AI can't skip human review)
- **Structured receipts** — every completed run records a **verified file list** (sourced from `git diff` against the run's baseline ref; falls back to agent self-report only when the project isn't a git repo, with the source labeled honestly), alongside an agent-claimed summary and verification notes
- **File-based storage** — everything lives in `.adhdev/` in your project

## For Claude Code users

ADHDev integrates with Claude Code via:
- **Agent SDK** — run Claude Code programmatically from the board
- **Hooks** — capture CLI activity back into tickets
- **Agent Brief API** — `GET /api/agent-brief` returns prioritized work queue

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tickets` | GET | Full board data |
| `/api/tickets` | POST | Create ticket |
| `/api/tickets` | PATCH | Update ticket |
| `/api/tickets` | DELETE | Delete ticket |
| `/api/tickets/:id/comments` | POST | Add comment |
| `/api/upload` | POST | Upload file |
| `/api/agent-claim` | POST | AI claims a ticket |
| `/api/agent-brief` | GET | Prioritized work queue |
| `/api/run` | POST | Trigger Claude Code on a ticket |
