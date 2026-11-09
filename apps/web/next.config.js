const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@devimpact/shared'],
  // Self-contained server bundle for the Docker image (OPS-05).
  output: 'standalone',
  experimental: {
    // Trace files from the monorepo root so workspace packages end up in the standalone output.
    outputFileTracingRoot: path.join(__dirname, '../../'),
  },
  // Linting runs once for the whole monorepo via the root `npm run lint` (flat config).
  eslint: { ignoreDuringBuilds: true },
};

module.exports = nextConfig;
