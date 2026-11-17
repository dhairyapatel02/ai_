import Redis from 'ioredis';

import type { PrismaClient } from '@prisma/client';

/** Empties every application table. Call in `beforeEach` of integration tests. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;
  const tables = rows.map(({ tablename }) => `"${tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

/** Clears rate-limit counters, OAuth state nonces, AI event streams and test queues so tests don't affect each other. */
export async function resetRedisState(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true });
  try {
    await redis.connect();
    // `devimpact-test:*` = BullMQ keys of the test queue prefix (OPS-17).
    for (const pattern of [
      'devimpact:rl:*',
      'devimpact:oauth-state:*',
      'devimpact:metrics-pending:*',
      'devimpact:doc-events:*',
      'devimpact:doc-cancel:*',
      'devimpact:sse:*',
      'devimpact-test:*',
    ]) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) await redis.del(...keys);
    }
  } finally {
    redis.disconnect();
  }
}
