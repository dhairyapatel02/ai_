import path from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The Prisma CLI runs with cwd = apps/api, so load the monorepo root .env explicitly (OPS-07).
// Variables already set in the environment (CI, Docker) always win.
loadDotenv({ path: path.resolve(__dirname, '.env'), quiet: true });
loadDotenv({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
