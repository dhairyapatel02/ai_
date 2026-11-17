/**
 * P07 task 7: server-time p95 of the metrics endpoints for the heavy seeded user
 * (`seed-heavy.ts` first), plus EXPLAIN ANALYZE of the engine's queries.
 *
 *   npx tsx prisma/scripts/seed-heavy.ts && npx tsx prisma/scripts/measure-metrics-perf.ts
 *
 * Calls the real services (MetricsService → ImpactScoreService → MetricsRepository → Postgres);
 * HTTP, auth and envelope add a few ms on top (see PERF_NOTES.md). "cold" = the user's cached
 * ImpactScore rows are deleted before every call (worst case after a recompute); "warm" = cache hits.
 */
import { localRangeToUtc, todayIn } from '@devimpact/shared';

import { loadEnvFiles } from '../../src/config/load-env';
import { ImpactScoreService } from '../../src/metrics/impact-score.service';
import { MetricsRepository } from '../../src/metrics/metrics.repository';
import { MetricsService } from '../../src/metrics/metrics.service';
import { createPrismaClient } from '../../src/prisma/create-client';
import { HEAVY_EMAIL } from './seed-heavy';

import type { PrismaService } from '../../src/prisma/prisma.service';

loadEnvFiles();

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
}

async function main() {
  const prisma = createPrismaClient() as unknown as PrismaService;
  const repo = new MetricsRepository(prisma);
  const metrics = new MetricsService(repo, new ImpactScoreService(repo), prisma);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: HEAVY_EMAIL } });
  const userId = user.id;
  const { timezone } = await repo.settings(userId);
  const today = todayIn(timezone);
  const year = today.slice(0, 4);
  const yearAgo = `${String(Number(year) - 1)}${today.slice(4)}`;

  const rows: Record<string, ReturnType<typeof stats>> = {};
  async function bench(name: string, runs: number, cold: boolean, fn: () => Promise<unknown>) {
    await fn(); // warm-up (JIT, connection pool)
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
      if (cold) await prisma.impactScore.deleteMany({ where: { userId } });
      const t0 = performance.now();
      await fn();
      samples.push(performance.now() - t0);
    }
    rows[name] = stats(samples);
  }

  await bench('overview month (cold)', 50, true, () => metrics.overview(userId));
  await bench('overview month (warm)', 200, false, () => metrics.overview(userId));
  await bench('overview year (cold)', 30, true, () => metrics.overview(userId, `year:${year}`));
  await bench('overview year (warm)', 200, false, () => metrics.overview(userId, `year:${year}`));
  await bench('kpis quarter (cold)', 30, true, () => metrics.kpis(userId));
  await bench('timeseries commits/day, 12 months (snapshots)', 100, false, () =>
    metrics.timeseries(userId, { metric: 'commits', from: yearAgo, to: today, interval: 'day' }),
  );
  await bench('timeseries prs_merged/week, 12 months (snapshots)', 100, false, () =>
    metrics.timeseries(userId, {
      metric: 'prs_merged',
      from: yearAgo,
      to: today,
      interval: 'week',
    }),
  );
  await bench('timeseries pr_cycle_time/week, 12 months (facts)', 50, false, () =>
    metrics.timeseries(userId, {
      metric: 'pr_cycle_time_median_hours',
      from: yearAgo,
      to: today,
      interval: 'week',
    }),
  );
  await bench('timeseries prs_reviewed/month, 12 months (facts)', 50, false, () =>
    metrics.timeseries(userId, {
      metric: 'prs_reviewed',
      from: yearAgo,
      to: today,
      interval: 'month',
    }),
  );
  await bench('heatmap 365 days', 100, false, () => metrics.heatmap(userId, {}));
  await bench('impact history 12 months (cold)', 10, true, () =>
    metrics.impactHistory(userId, { periodType: 'month', count: 12 }),
  );
  await bench('trends 6 months (warm)', 100, false, () => metrics.trends(userId, { count: 6 }));

  console.log(`\nHeavy user ${userId} (${timezone}), today ${today}\n`);
  console.log('| Call | n | p50 ms | p95 ms | max ms |\n|---|---|---|---|---|');
  for (const [name, s] of Object.entries(rows)) {
    console.log(
      `| ${name} | ${s.n} | ${s.p50.toFixed(1)} | ${s.p95.toFixed(1)} | ${s.max.toFixed(1)} |`,
    );
  }

  // EXPLAIN ANALYZE of the fact loads (12 months) and the snapshot range scan.
  const { start, endExclusive } = localRangeToUtc(yearAgo, today, timezone);
  const explain = async (label: string, sql: string, params: unknown[]) => {
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
      ...params,
    );
    console.log(`\n-- ${label}\n${plan.map((r) => r['QUERY PLAN']).join('\n')}`);
  };
  await explain(
    'authored PRs (12 months)',
    `SELECT p.id FROM pull_requests p JOIN repositories r ON r.id = p.repository_id AND r.included
     WHERE p."userId" = $1 AND p.is_authored_by_user AND NOT p.legacy_stub
       AND ((p.created_at_remote >= $2 AND p.created_at_remote < $3) OR (p."mergedAt" >= $2 AND p."mergedAt" < $3)
         OR (p.closed_at >= $2 AND p.closed_at < $3) OR (p.first_review_at >= $2 AND p.first_review_at < $3))`,
    [userId, start, endExclusive],
  );
  await explain(
    'reviews (12 months)',
    `SELECT v.id FROM pull_request_reviews v
     JOIN pull_requests p ON p.id = v.pull_request_id AND NOT p.is_authored_by_user AND NOT p.legacy_stub
     JOIN repositories r ON r.id = p.repository_id AND r.included
     WHERE v.user_id = $1 AND v.submitted_at >= $2 AND v.submitted_at < $3`,
    [userId, start, endExclusive],
  );
  await explain(
    'commits (12 months)',
    `SELECT c.id FROM commits c JOIN repositories r ON r.id = c.repository_id AND r.included
     WHERE c."userId" = $1 AND c.parents_count <= 1 AND c.authored_at >= $2 AND c.authored_at < $3`,
    [userId, start, endExclusive],
  );
  await explain(
    'snapshots (365 days)',
    `SELECT * FROM metric_snapshots WHERE user_id = $1 AND timezone = $2 AND date >= $3::date AND date <= $4::date`,
    [userId, timezone, yearAgo, today],
  );
  await explain(
    'impact score cache lookup',
    `SELECT id FROM impact_scores WHERE user_id = $1 AND score_version = 'impact@2.0.0' AND period_type = 'MONTH'
       AND period_start = $2::date AND period_end = $3::date`,
    [userId, `${today.slice(0, 7)}-01`, today],
  );
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
