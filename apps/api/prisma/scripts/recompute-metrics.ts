/**
 * Rebuilds daily metric snapshots and drops cached impact scores (P07 runbook):
 *
 *   npx tsx prisma/scripts/recompute-metrics.ts               # every user with activity
 *   npx tsx prisma/scripts/recompute-metrics.ts dev@acme.io   # one user (by email)
 *
 * Same code path as the `metrics.recompute` job, run synchronously without Redis. Safe to re-run
 * (idempotent). The nightly job also bootstraps users without snapshots, so this is only needed to
 * make data visible immediately after deploying P07.
 */
import { loadEnvFiles } from '../../src/config/load-env';
import { MetricsRepository } from '../../src/metrics/metrics.repository';
import { RollupService } from '../../src/metrics/rollup.service';
import { createPrismaClient } from '../../src/prisma/create-client';

import type { PrismaService } from '../../src/prisma/prisma.service';

loadEnvFiles();

async function main() {
  const prisma = createPrismaClient() as unknown as PrismaService;
  const repo = new MetricsRepository(prisma);
  const rollups = new RollupService(repo);
  const email = process.argv[2];
  // user-scope: operator script over every user (or the one named on the command line).
  const users = await prisma.user.findMany({
    where: email ? { email } : { integrations: { some: {} } },
    select: { id: true, email: true },
  });
  for (const user of users) {
    await repo.deleteAllScores(user.id);
    const result = await rollups.recompute(user.id, new Date(0), new Date());
    console.log(
      `${user.email}: ${String(result.snapshots)} snapshot rows (${result.fromDate}..${result.toDate})`,
    );
  }
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
