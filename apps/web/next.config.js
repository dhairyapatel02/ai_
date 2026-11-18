const path = require('node:path');

const dotenv = require('dotenv');

// Next.js only reads apps/web/.env*; also load the monorepo root .env (shared by all apps).
// Already-set variables (shell, CI, Docker, apps/web/.env*) win; nothing is overridden.
dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });

const monorepoRoot = path.join(__dirname, '../../');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // E2E runs `next dev` next to a production build (`next start`); separate build dirs keep the
  // dev server from overwriting the production output.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@devimpact/shared'],
  // Self-contained server bundle for the Docker image (OPS-05). Only enabled there, because
  // `next start` (local, CI) doesn't support standalone output.
  output: process.env.NEXT_OUTPUT_STANDALONE === 'true' ? 'standalone' : undefined,
  // Trace files from the monorepo root so workspace packages end up in the standalone output.
  outputFileTracingRoot: monorepoRoot,
  // Turbopack (default bundler in Next 16) resolves hoisted workspace packages from the root.
  turbopack: { root: monorepoRoot },
  // Transitional v0.1 routes → IA routes (design/IA.md §2). Removed once nothing links to them.
  async redirects() {
    return [
      { source: '/connect', destination: '/settings/integrations', permanent: false },
      { source: '/settings', destination: '/settings/profile', permanent: false },
      { source: '/resume', destination: '/documents/new/resume', permanent: false },
      { source: '/appraisal', destination: '/documents/new/appraisal', permanent: false },
      { source: '/promotion', destination: '/documents/new/promotion', permanent: false },
    ];
  },
};

module.exports = nextConfig;
