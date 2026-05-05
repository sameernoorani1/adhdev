# ADHDev

The AI agent control plane for developers who don't want to babysit their agents.

![ADHDev board](assets/board-screenshot.png)

## Quick start

```bash
npm install -g adhdev-board
adhdev init
adhdev start
```

The board opens at `localhost:3111` and `.adhdev/` is created in your project. That's it.

## What it does

- **Tracks every agent run as a ticket.** Run, comment, status, files touched, verification — everything an AI did to your codebase, on a Kanban board you control.
- **Auto-populates from your codebase on first run.** `adhdev init` scans for actionable signals — TODO/FIXME comments, broken tests, dead code — and lands them as draft tickets you can promote or trash.
- **One-click Run on Claude Code.** Trigger an agent from any ticket; the board captures comments, ground-truthed file lists (via `git diff`), and the agent's verification claims automatically.
- **Local-first.** Your board lives in `.adhdev/board.json` in your project. No accounts, no cloud, no telemetry.

## Requirements

- Node.js 18+
- [Claude Code](https://docs.anthropic.com/claude/docs/claude-code) for one-click Run (the board itself works without it)
- Windows, macOS, or Linux

## What's free vs paid

ADHDev is 100% free and open-source today. A hosted tier is on the roadmap for teams that want a shared board across machines.

| Feature                              | OSS (free) | Cloud (coming soon) |
|--------------------------------------|:----------:|:-------------------:|
| Local Kanban board                   |     ✅     |          ✅         |
| Run tickets through Claude Code      |     ✅     |          ✅         |
| Codebase auto-scan / draft tickets   |     ✅     |          ✅         |
| Per-project local storage (.adhdev/) |     ✅     |          ✅         |
| Multi-machine sync                   |      —     |          ✅         |
| Team boards / shared projects        |      —     |          ✅         |
| Hosted runs (no local agent)         |      —     |          ✅         |

## Links

- [GitHub Issues](https://github.com/sameernoorani1/adhdev/issues)
- [Contributing](CONTRIBUTING.md)
- Docs site — coming soon

## License

[Apache 2.0](LICENSE)
