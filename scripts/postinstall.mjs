// Generates artifacts every workspace needs right after `npm install` / `npm ci`:
//   1. packages/shared/dist (CommonJS + .d.ts consumed by the API and the web app)
//   2. the Prisma client (types used by API code, tests and typecheck)
// Each step is skipped when its inputs aren't present (e.g. partial copies in Docker stages).
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const run = (command) => execSync(command, { stdio: 'inherit' });

if (existsSync('packages/shared/src/index.ts')) {
  run('npm run build --workspace=packages/shared');
}

if (existsSync('apps/api/prisma/schema.prisma') && existsSync('node_modules/prisma')) {
  run('npm run db:generate --workspace=apps/api');
}
