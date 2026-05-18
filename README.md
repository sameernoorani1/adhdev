# ADHDev

**The human context window is the real bottleneck.**

ADHDev is the board that holds what your brain can't — when you're shipping software with AI. You queue work. The AI does it. You review. The board keeps everything straight.

![ADHDev board](assets/board-screenshot.png)

## Quick start

```bash
npm install -g adhdev-board
adhdev init
adhdev start
```

The board opens at `localhost:3111` and `.adhdev/` is created in your project. That's it.

## What it does

Four things your brain drops when an AI is doing the work:

**Memory.** What the AI did yesterday is preserved — ticket by ticket, comment by comment, file by file. Open a ticket and you see the whole history. No re-explaining where you left off.

**Sequencing.** Work runs in the right order, not in random order. Tickets have status. Reopens get priority. The board enforces a queue so you're not picking what to look at next every five minutes.

**Verification.** The AI doesn't get to mark its own homework. An agent can flip a ticket to *done* — but only you can move it to *reviewed*. And every "files touched" claim is ground-truthed against `git diff`. Not the agent's word.

**Chronology.** Reopens get the full history, no backwards-guessing. If a fix didn't hold, the agent picks up the ticket with every prior comment loaded — yours and the AI's — so it knows what was tried and what failed.

## While the AI works, you keep working

You queue the next ticket. Review the last one. Look at the bug from yesterday. The agent doesn't need you holding its hand. The board manages itself. You don't have to sit and watch.

## Who it's for

- People shipping software with AI who don't think of themselves as engineers — product folks, designers, founders, indie builders.
- People using Claude Code or another agent CLI who want work tracked without writing JIRA tickets by hand.
- Anyone tired of "the AI said done, but it isn't."

## Who it's not for

- Engineers running ten parallel agents with git worktrees. You're already past this; you don't need it.
- Enterprise compliance shops. No SSO, no audit log infrastructure, no SOC2.
- Line-by-line code reviewers. The board surfaces what changed and what the AI claimed. If you read every byte of every commit anyway, this adds friction without value.

## Requirements

- Node.js 18+
- [Claude Code](https://docs.anthropic.com/claude/docs/claude-code) for the one-click Run button. The board works without it — you just trigger your agent however you usually do.
- Windows, macOS, or Linux

## Local-first

Your data stays in your repo. No accounts. No cloud. No telemetry about how you use the board.

One exception: the app checks for new versions on startup so we can ship security fixes. That check is a single GET to a static manifest file. No user data, no board content, no analytics. Set `ADHDEV_NO_UPDATE_CHECK=1` to turn it off entirely.

## Free vs paid

ADHDev's local product is free. Forever.

A hosted cloud tier is on the roadmap for teams that want a shared board across machines. The cloud tier is purely additive. It does not gate any feature that exists in the local product today.

| Feature | OSS (free) | Cloud (coming) |
|---|:---:|:---:|
| Local Kanban board | ✅ | ✅ |
| Run tickets through your agent CLI | ✅ | ✅ |
| Codebase auto-scan, draft tickets | ✅ | ✅ |
| Per-project local storage (`.adhdev/`) | ✅ | ✅ |
| Multi-machine sync | — | ✅ |
| Team boards, shared projects | — | ✅ |
| Hosted runs (no local agent needed) | — | ✅ |

## Links

- [GitHub Issues](https://github.com/sameernoorani1/adhdev/issues)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Self-hosting from source](SELF_HOSTING.md)

## License

[AGPL-3.0-or-later](LICENSE) — see [LICENSING.md](LICENSING.md) for the dual-licensing setup (open-source + commercial available).
