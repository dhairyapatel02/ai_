/**
 * Prints the sync schedule (ADR-0007): the hourly `sync-fanout` job scheduler in Redis and, per
 * ACTIVE GitHub integration, its daily slot and next scheduled sync. Read-only; never prints tokens.
 *
 *   npx tsx apps/api/prisma/scripts/inspect-sync-schedule.ts
 */
import { Queue } from 'bullmq';

import { validateEnv } from '../../src/config/env';
import { loadEnvFiles } from '../../src/config/load-env';
import { redisOptionsFromUrl } from '../../src/config/redis';
import { createPrismaClient } from '../../src/prisma/create-client';
import { nextSlotAfter } from '../../src/sync/sync-run.mapper';
import { SYNC_QUEUE } from '../../src/sync/sync.constants';

async function main() {
  loadEnvFiles();
  const env = validateEnv(process.env);
  const queue = new Queue(SYNC_QUEUE, {
    connection: redisOptionsFromUrl(env.REDIS_URL),
    prefix: env.QUEUE_PREFIX,
  });
  const prisma = createPrismaClient();
  try {
    const schedulers = await queue.getJobSchedulers();
    console.log(`Job schedulers on "${env.QUEUE_PREFIX}:${SYNC_QUEUE}":`);
    for (const s of schedulers)
      console.log(
        `  ${s.key}  pattern=${s.pattern ?? '-'}  next=${s.next ? new Date(s.next).toISOString() : '-'}`,
      );
    if (schedulers.length === 0)
      console.log('  (none — start the worker once to register "sync-fanout")');

    // user-scope: operator script over all integrations, by design.
    const rows = await prisma.integration.findMany({
      where: { provider: 'GITHUB' },
      select: {
        id: true,
        status: true,
        externalLogin: true,
        scheduleSlotMinute: true,
        lastSyncedAt: true,
      },
      orderBy: { scheduleSlotMinute: 'asc' },
    });
    const now = new Date();
    console.log(`\nIntegrations (${rows.length}):`);
    for (const r of rows) {
      const slot = `${String(Math.floor(r.scheduleSlotMinute / 60)).padStart(2, '0')}:${String(r.scheduleSlotMinute % 60).padStart(2, '0')} UTC`;
      const next =
        r.status === 'ACTIVE' ? nextSlotAfter(r.scheduleSlotMinute, now).toISOString() : 'paused';
      console.log(
        `  ${r.id}  @${r.externalLogin ?? '?'}  ${r.status.padEnd(12)} slot ${slot}  next ${next}  last ${r.lastSyncedAt?.toISOString() ?? '-'}`,
      );
    }
  } finally {
    await queue.close();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
