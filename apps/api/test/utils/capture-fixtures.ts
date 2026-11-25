/**
 * Captures API responses of the seeded demo user into a web fixtures folder (view tests). Usage
 * (after `npm run db:seed` and `npm run build --workspace=apps/api`):
 *   npx tsx apps/api/test/utils/capture-fixtures.ts apps/web/test/fixtures-p13 /me /integrations …
 * Starts a local JWKS server, runs the built API on :4100 against it and signs a token for the
 * demo user. Never calls a provider: list endpoints only read the database.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { loadEnvFiles } from '../../src/config/load-env';
import { createPrismaClient } from '../../src/prisma/create-client';
import { signTestToken, startJwksServer } from './auth';

async function main() {
  loadEnvFiles();
  const [outDir, ...paths] = process.argv.slice(2);
  if (!outDir || paths.length === 0) throw new Error('usage: capture-fixtures <outDir> <path>…');
  const prisma = createPrismaClient();
  const demo = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@devimpact.dev' } });
  const integrations = await prisma.integration.findMany({ where: { userId: demo.id } });
  const idOf = (provider: string) => integrations.find((i) => i.provider === provider)?.id ?? '';
  const issue = await prisma.issue.findFirst({
    where: { userId: demo.id, status: 'DONE' },
    orderBy: { completedAt: 'desc' },
  });
  await prisma.$disconnect();

  const jwks = await startJwksServer();
  const api = spawn('node', [path.resolve(__dirname, '../../dist/main.js')], {
    env: {
      ...process.env,
      API_PORT: '4100',
      PORT: '4100',
      AUTH_JWKS_URL: jwks.url,
      AUTH_JWT_ISSUER: 'http://localhost:3000',
      AUTH_JWT_AUDIENCE: 'devimpact-api',
      RUN_WORKER_IN_API: 'false',
      RATE_LIMIT_DEFAULT_PER_MINUTE: '3000',
      GITLAB_CLIENT_ID: 'fixture',
      GITLAB_CLIENT_SECRET: 'fixture',
      JIRA_CLIENT_ID: 'fixture',
      JIRA_CLIENT_SECRET: 'fixture',
      LINEAR_CLIENT_ID: 'fixture',
      LINEAR_CLIENT_SECRET: 'fixture',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch('http://127.0.0.1:4100/api/health/live')).ok) break;
      } catch {
        // starting
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const token = signTestToken(demo.id, { expiresIn: 600 });
    mkdirSync(outDir, { recursive: true });
    for (const raw of paths) {
      const name = raw.slice(0, raw.indexOf('='));
      const p = raw.slice(raw.indexOf('=') + 1);
      const resolved = p
        .replace('{gitlab}', idOf('GITLAB'))
        .replace('{jira}', idOf('JIRA'))
        .replace('{linear}', idOf('LINEAR'))
        .replace('{github}', idOf('GITHUB'))
        .replace('{issue}', issue?.id ?? '');
      const res = await fetch(`http://127.0.0.1:4100/api${resolved}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as { success?: boolean; data?: unknown; meta?: unknown };
      if (!res.ok) throw new Error(`${resolved} → ${res.status} ${JSON.stringify(body)}`);
      const { success: _ok, ...rest } = body;
      writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(rest, null, 2)}\n`);
      console.log(`${name} ← ${resolved}`);
    }
  } finally {
    api.kill();
    await jwks.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
