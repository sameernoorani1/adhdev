/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow images from local uploads
  images: {
    remotePatterns: [],
  },
  // AD-181 reopen: hide Next.js's dev-tools "N" overlay (the floating
  // bottom-right widget that was flagged in testing). It's a Next-built-in debugging UI
  // that only renders in dev mode; users on prod (post-AD-182) never see
  // it. Disabling here removes it for the dev session too.
  devIndicators: false,
  // AD-170: do NOT watch .adhdev/ for HMR. Every heartbeat write to
  // board.json (every ~5s during an active run), every comment POST, every
  // execution PATCH would otherwise trip Fast Refresh and remount the React
  // tree. That's why typing in inputs cleared mid-keystroke, why ticket
  // clicks didn't register, and why "Cannot read properties of null
  // (reading 'removeChild')" kept stacking — the tree was being torn down
  // and rebuilt under the user's cursor. Same goes for terminal-history,
  // uploads, and the temp scratch dir.
  webpack: (config, { dev }) => {
    if (dev) {
      // webpack's array form of watchOptions.ignored only accepts non-empty
      // strings, so we can't splat in Next's default (a RegExp). Restate the
      // usual ignores explicitly and append ours.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/.next/**',
          '**/.adhdev/**',
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
