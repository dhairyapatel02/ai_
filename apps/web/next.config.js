const path = require('node:path');

const dotenv = require('dotenv');
const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

// Next.js only reads apps/web/.env*; also load the monorepo root .env (shared by all apps).
// Already-set variables (shell, CI, Docker, apps/web/.env*) win; nothing is overridden.
dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });

const monorepoRoot = path.join(__dirname, '../../');

/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => ({
  reactStrictMode: true,
  poweredByHeader: false,
  // E2E runs `next dev` next to a production build (`next start`); separate build dirs keep the
  // dev server from overwriting the production output.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@devimpact/shared'],
  // Next's dev MCP endpoint writes every browser/server log line to .next/dev/logs; with the
  // monorepo Turbopack root that write is picked up by the watcher and `next dev` reloads in a
  // loop (seen in P09 with a custom distDir and again in P10). The app doesn't use it.
  experimental: { mcpServer: false },
  // Self-contained server bundle for the Docker image (OPS-05). Only enabled there, because
  // `next start` (local, CI) doesn't support standalone output.
  output: process.env.NEXT_OUTPUT_STANDALONE === 'true' ? 'standalone' : undefined,
  // Trace files from the monorepo root so workspace packages end up in the standalone output.
  outputFileTracingRoot: monorepoRoot,
  // Turbopack (default bundler in Next 16) resolves hoisted workspace packages from the root.
  // Production builds bundle `@devimpact/shared` from its ESM TypeScript source (not the CommonJS
  // dist/ the API uses), so unused schemas tree-shake out of the client bundles (P10 performance,
  // PERF-07). Not in `next dev`: there the alias puts the dev server into a Fast Refresh reload loop.
  turbopack: {
    root: monorepoRoot,
    ...(phase === PHASE_DEVELOPMENT_SERVER
      ? {}
      : { resolveAlias: { '@devimpact/shared': '../../packages/shared/src/index.ts' } }),
  },
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
});

module.exports = nextConfig;
