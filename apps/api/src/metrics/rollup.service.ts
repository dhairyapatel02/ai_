import { METRICS_VERSION, localDateOf, localRangeToUtc, todayIn } from '@devimpact/shared';
import { Injectable, Logger } from '@nestjs/common';

import { MetricsRepository } from './metrics.repository';
import { rollupDays } from './rollup';

export interface RecomputeResult {
  fromDate: string;
  toDate: string;
  snapshots: number;
  scoresInvalidated: number;
}

/**
 * Daily rollups (KPI_METHODOLOGY §4, ARCHITECTURE_V2 §7): for a user and an instant range, maps the
 * range to local dates in the user's time zone, rewrites those `MetricSnapshot` rows in one
 * transaction (idempotent) and deletes cached `ImpactScore` rows whose period overlaps (DATA-09).
 */
@Injectable()
export class RollupService {
  private readonly logger = new Logger(RollupService.name);

  constructor(private readonly repo: MetricsRepository) {}

  async recompute(
    userId: string,
    from: Date,
    to: Date,
    now = new Date(),
  ): Promise<RecomputeResult> {
    const { timezone } = await this.repo.settings(userId);
    const today = todayIn(timezone, now);
    const fromDate = localDateOf(Math.min(from.getTime(), now.getTime()), timezone);
    let toDate = localDateOf(to, timezone);
    if (toDate > today) toDate = today;
    if (toDate < fromDate) toDate = fromDate;

    const { start, endExclusive } = localRangeToUtc(fromDate, toDate, timezone);
    const [facts, achievementDates] = await Promise.all([
      this.repo.loadFacts(userId, start, endExclusive),
      this.repo.achievementDates(userId, fromDate, toDate),
    ]);
    const rows = rollupDays(facts, fromDate, toDate, timezone, achievementDates);
    const snapshots = await this.repo.replaceSnapshots(
      userId,
      timezone,
      fromDate,
      toDate,
      rows,
      METRICS_VERSION,
    );
    const scoresInvalidated = await this.repo.deleteOverlappingScores(userId, fromDate, toDate);
    this.logger.log(
      { userId, fromDate, toDate, snapshots, scoresInvalidated },
      'metrics recomputed',
    );
    return { fromDate, toDate, snapshots, scoresInvalidated };
  }
}
