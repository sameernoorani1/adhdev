# Self-hosting ADHDev

You can run ADHDev directly from source instead of installing the npm package. This is the path for:

- People who want to inspect or modify the code before running it.
- Privacy-conscious users who don't want any third-party install layer.
- Contributors developing the project.

## Requirements

- Node.js 18 or newer
- Git
- Windows, macOS, or Linux

## Steps

```bash
git clone https://github.com/sameernoorani1/adhdev.git
cd adhdev
npm install
npm run dev:full
```

That's it. The board opens at `http://localhost:3111`. The terminal server runs alongside on `localhost:3112`.

Your project data lives in `./.adhdev/` — the same shape as the installed package writes. If you want to point ADHDev at a different project directory, you can:

```bash
cd /path/to/your/other/project
node /path/to/cloned/adhdev/cli/index.mjs start
```

## Production-style local run

`npm run dev:full` is the developer mode (hot reload, source maps). For a slimmer self-hosted run:

```bash
npm install
npm run build
npm start
```

This serves the compiled production bundle. Lower memory, no rebuild on file changes.

## Updating

```bash
git pull
npm install
```

Re-run whichever start command you use.

## Disabling the update check

The packaged CLI checks for new versions on startup via a static manifest. The from-source path does NOT do this — there's no version manifest to compare against when you're running on `main`. So this is moot for self-hosters; nothing leaves your machine.

## What you give up by self-hosting

Nothing functional. Every feature works the same. The only difference is you handle updates yourself (`git pull`) instead of `npm install -g adhdev-board`.

## Reporting issues

If you find a bug while self-hosting, please mention "self-hosted" in the issue so we can rule out npm-install-specific paths during triage.
