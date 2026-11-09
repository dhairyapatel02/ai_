const path = require('node:path');

const dotenv = require('dotenv');

// Next.js only reads apps/web/.env*; also load the monorepo root .env (shared by all apps).
// Already-set variables (shell, CI, Docker, apps/web/.env*) win; nothing is overridden.
dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@devimpact/shared'],
  // Self-contained server bundle for the Docker image (OPS-05). Only enabled there, because
  // `next start` (local, CI) doesn't support standalone output.
  output: process.env.NEXT_OUTPUT_STANDALONE === 'true' ? 'standalone' : undefined,
  experimental: {
    // Trace files from the monorepo root so workspace packages end up in the standalone output.
    outputFileTracingRoot: path.join(__dirname, '../../'),
  },
  // Linting runs once for the whole monorepo via the root `npm run lint` (flat config).
  eslint: { ignoreDuringBuilds: true },
};

module.exports = nextConfig;
