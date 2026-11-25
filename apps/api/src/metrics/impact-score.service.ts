import {
  METRICS_VERSION,
  SCORE_VERSION,
  localRangeToUtc,
  type ResolvedPeriod,
} from '@devimpact/shared';
import { Injectable } from '@nestjs/common';
import { PeriodType, ScoreStatus, type Prisma } from '@prisma/client';

import { renderExplanation } from './impact';
import { computeMetrics, type MetricWindow } from './metric-definitions';
import { MetricsRepository } from './metrics.repository';
import { buildImpactInputs, type ImpactInputs } from './score-inputs';

export interface PeriodScore {
  period: ResolvedPeriod;
  inputs: ImpactInputs;
  explanation: string;
  computedAt: Date;
}

export const toPeriodTypeEnum = (type: ResolvedPeriod['type']) => type.toUpperCase() as PeriodType;

export function windowOfPeriod(period: ResolvedPeriod): MetricWindow {
  const { start, endExclusive } = localRangeToUtc(
    period.startDate,
    period.endDate,
    period.timezone,
  );
  return {
    start,
    endExclusive,
    startDate: period.startDate,
    endDate: period.endDate,
    timezone: period.timezone,
    periodDays: period.periodDays,
  };
}

/**
 * Lazy, cached period metrics + impact score (ADR-0008, ARCHITECTURE_V2 §7/§9). A cache hit is one
 * indexed lookup; a miss computes from the fact tables with the pure engine and stores the row
 * (`inputs` = KPI_METHODOLOGY §6.6), so `/impact`, `/metrics/kpis`, `/metrics/trends` and
 * `/metrics/evidence` share one computation. Never calls the AI, never enqueues work.
 * `metrics.recompute` deletes rows whose period overlaps changed data.
 */
@Injectable()
export class ImpactScoreService {
  constructor(private readonly repo: MetricsRepository) {}

  async scoresFor(userId: string, periods: ResolvedPeriod[]): Promise<PeriodScore[]> {
    if (periods.length === 0) return [];
    const timezone = periods[0].timezone;
    const keyOf = (type: string, start: string, end: string) => `${type}|${start}|${end}`;
    const cached = await this.repo.findScores(
      userId,
      SCORE_VERSION,
      timezone,
      METRICS_VERSION,
      periods.map((p) => ({
        periodType: toPeriodTypeEnum(p.type),
        startDate: p.startDate,
        endDate: p.endDate,
      })),
    );
    const hits = new Map(
      cached.map((row) => [
        keyOf(
          row.periodType,
          row.periodStart.toISOString().slice(0, 10),
          row.periodEnd.toISOString().slice(0, 10),
        ),
        row,
      ]),
    );

    const misses = periods.filter(
      (p) => !hits.has(keyOf(toPeriodTypeEnum(p.type), p.startDate, p.endDate)),
    );
    const computed = new Map<string, PeriodScore>();
    if (misses.length > 0) {
      const windows = misses.map(windowOfPeriod);
      const start = new Date(Math.min(...windows.map((w) => w.start.getTime())));
      const end = new Date(Math.max(...windows.map((w) => w.endExclusive.getTime())));
      const facts = await this.repo.loadFacts(userId, start, end);
      // Pure computation is synchronous; the cache writes run concurrently.
      const scores = await Promise.all(
        misses.map((period, i) => this.computeAndStore(userId, period, facts, windows[i])),
      );
      for (const score of scores) {
        const { period } = score;
        computed.set(keyOf(toPeriodTypeEnum(period.type), period.startDate, period.endDate), score);
      }
    }

    return periods.map((period) => {
      const key = keyOf(toPeriodTypeEnum(period.type), period.startDate, period.endDate);
      const fresh = computed.get(key);
      if (fresh) return { ...fresh, period };
      const row = hits.get(key);
      if (!row) throw new Error('impact score cache inconsistency');
      return {
        period,
        inputs: row.inputs as unknown as ImpactInputs,
        explanation: row.explanation,
        computedAt: row.computedAt,
      };
    });
  }

  async scoreFor(userId: string, period: ResolvedPeriod): Promise<PeriodScore> {
    const [score] = await this.scoresFor(userId, [period]);
    return score;
  }

  private async computeAndStore(
    userId: string,
    period: ResolvedPeriod,
    facts: Awaited<ReturnType<MetricsRepository['loadFacts']>>,
    window: MetricWindow,
  ): Promise<PeriodScore> {
    const { inputs, impact } = buildImpactInputs(computeMetrics(facts, window), {
      type: period.type,
      startDate: period.startDate,
      endDate: period.endDate,
      timezone: period.timezone,
      periodDays: period.periodDays,
    });
    const explanation = renderExplanation(impact, period.label);
    const row = await this.repo.saveScore({
      userId,
      periodType: toPeriodTypeEnum(period.type),
      startDate: period.startDate,
      endDate: period.endDate,
      timezone: period.timezone,
      scoreVersion: SCORE_VERSION,
      metricsVersion: METRICS_VERSION,
      status: impact.status === 'ok' ? ScoreStatus.OK : ScoreStatus.INSUFFICIENT_DATA,
      overall: impact.overall,
      delivery: impact.dimensions.delivery.score,
      quality: impact.dimensions.quality.score,
      collaboration: impact.dimensions.collaboration.score,
      ownership: impact.dimensions.ownership.score,
      inputs: inputs as unknown as Prisma.InputJsonValue,
      explanation,
    });
    return { period, inputs, explanation, computedAt: row.computedAt };
  }
}
