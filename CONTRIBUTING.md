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

Be kind. Argue ideas, not people.

## License

By contributing, you agree your work ships under [Apache 2.0](LICENSE). No CLA required.
