# Contributing to ADHDev

Thanks for considering a contribution. ADHDev is small and moves fast — this guide is short so it stays accurate.

## Local setup

```bash
git clone https://github.com/sameernoorani1/adhdev.git
cd adhdev
npm install
npm run dev:full
```

The board opens at `localhost:3111`. It runs against the `.adhdev/` directory in this repo.

## Filing issues

Bugs, feature requests, weird behaviour — all live at [GitHub Issues](https://github.com/sameernoorani1/adhdev/issues). When filing, please include:

- What you expected vs what actually happened
- Steps to reproduce (or a screenshot if it's UI)
- Your OS and Node version

## Submitting a pull request

- Branch from `main`.
- Run `npm run lint && npx tsc --noEmit && npm test && npm run build` — all four must pass clean before review.
- If your change relates to an existing ticket on the project board, leave a comment on that ticket instead of opening a new one in parallel.
- Small, focused PRs land faster than sweeping refactors.

## Code of conduct

Be kind. Argue ideas, not people. Full text in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Contributor License Agreement

ADHDev is dual-licensed (AGPL-3.0-or-later open-source + commercial license for companies that need different terms — see [LICENSING.md](LICENSING.md)). For that to keep working, all external contributions need to come in under a Contributor License Agreement: you keep the copyright to what you wrote, but you grant Sameer (the project owner) a license broad enough to re-license the project under commercial terms when needed.

The full text is in [CLA.md](CLA.md). The PR template has a checkbox to confirm you've read and agreed.

If you're a first-time contributor and the CLA is a blocker, open an issue or email **sameernoorani@gmail.com** and we'll figure it out.
