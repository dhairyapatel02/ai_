import {
  IMPACT_BANDS,
  IMPACT_DIMENSIONS,
  IMPLEMENTED_METRIC_KEYS,
  METRIC_CATALOGUE,
  KPI_SECTIONS,
  PROVIDER_KINDS,
  type ProviderBreakdownResponse,
  METRICS_VERSION,
  PeriodError,
  SCORE_VERSION,
  SECTION_TITLES,
  DIMENSION_LABELS,
  addDays,
  comparisonPeriod,
  daysInclusive,
  impactBand,
  isoWeekday,
  localRangeToUtc,
  metricMeta,
  periodSpecContaining,
  periodSpecsEnding,
  resolvePeriod,
  todayIn,
  type DefinitionsResponse,
  type EvidenceItem,
  type HeatmapQuery,
  type HeatmapResponse,
  type ImpactDto,
  type ImpactHistoryQuery,
  type ImpactHistoryResponse,
  type ImplementedMetricKey,
  type KpisResponse,
  type MetricValue,
  type OverviewResponse,
  type PageMeta,
  type ResolvedPeriod,
  type ReposQuery,
  type ReposResponse,
  type TimeseriesInterval,
  type TimeseriesQuery,
  type TimeseriesResponse,
  type TrendsQuery,
  type TrendsResponse,
} from '@devimpact/shared';
import { Injectable } from '@nestjs/common';

import { inputsHashOf } from '../ai/hash';
import { AppException } from '../common/app-exception';
import { decodeOffsetCursor, encodeOffsetCursor } from '../common/pagination';
import { assertWithinHistory } from '../entitlements/entitlements';
import { PrismaService } from '../prisma/prisma.service';
import { evidenceRefs } from './evidence';
import { roundScore } from './impact';
import { ImpactScoreService, windowOfPeriod, type PeriodScore } from './impact-score.service';
import { computeMetric, prepareContext, type MetricResult } from './metric-definitions';
import { MetricsRepository, toLocalDate } from './metrics.repository';

/** Snapshot-backed metrics for charts (additive counters, §4). */
const SNAPSHOT_METRICS: Partial<
  Record<
    ImplementedMetricKey,
    (s: { commits: number; prsOpened: number; prsMerged: number; active: boolean }) => number
  >
> = {
  commits: (s) => s.commits,
  prs_opened: (s) => s.prsOpened,
  prs_merged: (s) => s.prsMerged,
  active_days: (s) => (s.active ? 1 : 0),
};

export const MAX_TIMESERIES_POINTS = 400;
export const MAX_HEATMAP_DAYS = 366;
export const OVERVIEW_CARDS: ImplementedMetricKey[] = ['commits', 'prs_merged', 'prs_reviewed'];

function invalidPeriod(spec: string, message: string): AppException {
  return new AppException('INVALID_PERIOD', message, { period: spec });
}

function validation(path: string, message: string): AppException {
  return new AppException('VALIDATION_FAILED', 'The request is invalid', {
    issues: [{ path, message, code: 'custom' }],
  });
}

/**
 * Read-only metric endpoints (API_CONTRACT_V2 §9, §10, A-1, A-2). Nothing here calls the AI or
 * enqueues work; period metrics come from the `ImpactScore` cache (computed lazily on a miss),
 * chart counters from `MetricSnapshot`.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly repo: MetricsRepository,
    private readonly scores: ImpactScoreService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Periods ────────────────────────────────────────────────────────────────────────────

  /** Resolves `?period=` (default: the user's default period type containing today). */
  async resolve(userId: string, spec: string | undefined, now = new Date()) {
    const settings = await this.repo.settings(userId);
    const today = todayIn(settings.timezone, now);
    const type =
      settings.defaultPeriodType === 'CUSTOM'
        ? 'month'
        : (settings.defaultPeriodType.toLowerCase() as 'month' | 'quarter' | 'half' | 'year');
    const effective = spec ?? periodSpecContaining(type, today);
    let period: ResolvedPeriod;
    try {
      period = resolvePeriod(effective, settings.timezone, today);
    } catch (error) {
      if (error instanceof PeriodError) throw invalidPeriod(effective, error.message);
      throw error;
    }
    // PRD §6 history window (FREE 12 / PRO 36 months): 403 ENTITLEMENT_REQUIRED before any work.
    assertWithinHistory(settings.plan, period.startDate, today);
    return { timezone: settings.timezone, today, period };
  }

  // ── Definitions ────────────────────────────────────────────────────────────────────────

  definitions(): DefinitionsResponse {
    return {
      metricsVersion: METRICS_VERSION,
      scoreVersion: SCORE_VERSION,
      metrics: METRIC_CATALOGUE.map((m) => ({ ...m, caveats: [...m.caveats] })),
      bands: IMPACT_BANDS.map((b) => ({ ...b })),
    };
  }

  // ── Metric values ──────────────────────────────────────────────────────────────────────

  private metricValue(
    key: ImplementedMetricKey,
    current: PeriodScore,
    previous: PeriodScore | null,
  ): MetricValue {
    const meta = metricMeta(key);
    const m = current.inputs.metrics[key];
    const prev = previous?.inputs.metrics[key];
    const previousValue = prev?.value ?? null;
    const delta = m.value !== null && previousValue !== null ? m.value - previousValue : null;
    return {
      key,
      label: meta.label,
      unit: meta.unit,
      value: m.value,
      n: m.n,
      status: m.status,
      previousValue,
      delta,
      deltaPct:
        delta !== null && previousValue !== null && previousValue !== 0
          ? delta / previousValue
          : null,
      direction: meta.direction,
      inScore: meta.inScore,
      evidence: current.inputs.evidence[key] ?? [],
      evidenceTruncated: current.inputs.evidenceTruncated[key] ?? false,
    };
  }

  private async withComparison(userId: string, period: ResolvedPeriod) {
    const { period: previous, comparison } = comparisonPeriod(period);
    const [current, prev] = await this.scores.scoresFor(userId, [period, previous]);
    return {
      current: current,
      previous: prev,
      previousPeriod: previous,
      comparison,
    };
  }

  async overview(userId: string, spec?: string): Promise<OverviewResponse> {
    const { period } = await this.resolve(userId, spec);
    const [{ current, previous, previousPeriod, comparison }, freshness] = await Promise.all([
      this.withComparison(userId, period),
      this.repo.dataFreshness(userId),
    ]);
    const overall = current.inputs.overall === null ? null : roundScore(current.inputs.overall);
    const prevOverall =
      previous.inputs.overall === null ? null : roundScore(previous.inputs.overall);
    return {
      period,
      previousPeriod,
      comparison,
      cards: OVERVIEW_CARDS.map((key) => this.metricValue(key, current, previous)),
      impact: {
        status: current.inputs.status,
        overall,
        delta: overall !== null && prevOverall !== null ? overall - prevOverall : null,
        band: overall === null ? null : impactBand(overall),
      },
      dataFreshness: {
        lastSuccessfulSyncAt: freshness.lastSuccessfulSyncAt?.toISOString() ?? null,
        syncing: freshness.syncing,
      },
    };
  }

  async kpis(userId: string, spec?: string): Promise<KpisResponse> {
    const { period } = await this.resolve(userId, spec);
    const [{ current, previous, previousPeriod, comparison }, issuesAvailable] = await Promise.all([
      this.withComparison(userId, period),
      this.issuesAvailable(userId),
    ]);
    return {
      period,
      previousPeriod,
      comparison,
      sections: KPI_SECTIONS.map((section) => ({
        key: section,
        title: SECTION_TITLES[section],
        metrics: METRIC_CATALOGUE.filter((m) => m.section === section && !m.deferred).map((m) =>
          this.metricValue(m.key as ImplementedMetricKey, current, previous),
        ),
        ...(section === 'issues' ? { available: issuesAvailable } : {}),
      })),
      impactStatus: current.inputs.status,
      metricsVersion: METRICS_VERSION,
    };
  }

  /** Issues section is "available" once Jira / Linear is connected or issues exist (P13). */
  private async issuesAvailable(userId: string): Promise<boolean> {
    const [trackers, issues] = await Promise.all([
      this.prisma.integration.count({
        where: { userId, provider: { in: ['JIRA', 'LINEAR'] }, status: { not: 'DISCONNECTED' } },
      }),
      this.prisma.issue.count({ where: { userId }, take: 1 }),
    ]);
    return trackers > 0 || issues > 0;
  }

  /** `GET /metrics/providers?period=` — per-provider totals from the daily rollups (P13, A-8). */
  async providers(userId: string, spec?: string): Promise<ProviderBreakdownResponse> {
    const { period, timezone } = await this.resolve(userId, spec);
    const rows = await this.repo.snapshots(userId, timezone, period.startDate, period.endDate);
    const totals = new Map<string, ProviderBreakdownResponse['providers'][number]>();
    for (const row of rows) {
      const byProvider = (row.byProvider ?? {}) as Record<string, Partial<Record<string, number>>>;
      for (const [provider, c] of Object.entries(byProvider)) {
        if (!(PROVIDER_KINDS as readonly string[]).includes(provider)) continue;
        const t = totals.get(provider) ?? {
          provider: provider as ProviderBreakdownResponse['providers'][number]['provider'],
          commits: 0,
          prsMerged: 0,
          prsReviewed: 0,
          issuesCompleted: 0,
          storyPoints: 0,
        };
        t.commits += c.commits ?? 0;
        t.prsMerged += c.prsMerged ?? 0;
        t.prsReviewed += c.prsReviewed ?? 0;
        t.issuesCompleted += c.issuesCompleted ?? 0;
        t.storyPoints = Math.round((t.storyPoints + (c.storyPoints ?? 0)) * 100) / 100;
        totals.set(provider, t);
      }
    }
    const order = PROVIDER_KINDS as readonly string[];
    return {
      period,
      providers: [...totals.values()].sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider)),
    };
  }

  async trends(userId: string, query: TrendsQuery): Promise<TrendsResponse> {
    const { period, timezone, today } = await this.resolve(userId, query.period);
    const periods = periodSpecsEnding(period.spec, query.count)
      .map((spec) => {
        try {
          return resolvePeriod(spec, timezone, today);
        } catch {
          return null; // older custom periods never start in the future; defensive only
        }
      })
      .filter((p): p is ResolvedPeriod => p !== null);
    const scores = await this.scores.scoresFor(userId, periods);
    const metrics = query.metrics ?? [...IMPLEMENTED_METRIC_KEYS];
    return {
      periodType: period.type,
      points: periods.map((p) => ({ period: p })),
      series: metrics.map((metric) => ({
        metric,
        values: scores.map((s) => s.inputs.metrics[metric].value),
      })),
    };
  }

  // ── Impact ─────────────────────────────────────────────────────────────────────────────

  toImpactDto(score: PeriodScore): ImpactDto {
    const { inputs } = score;
    const overall = inputs.overall === null ? null : roundScore(inputs.overall);
    return {
      period: score.period,
      status: inputs.status,
      scoreVersion: inputs.scoreVersion,
      overall,
      band: overall === null ? null : impactBand(overall),
      dimensions: IMPACT_DIMENSIONS.map((key) => {
        const d = inputs.dimensions[key];
        return {
          key,
          label: DIMENSION_LABELS[key],
          score: d.score === null ? null : roundScore(d.score),
          weight: d.weight,
          available: d.available,
          components: d.components.map((c) => {
            const m = inputs.metrics[c.metric];
            return {
              metric: c.metric,
              value: m.value,
              n: m.n,
              bandScore: c.band,
              shrunkScore: c.shrunk,
              weight: c.weight,
              effectiveWeight: c.effectiveWeight,
              available: m.status === 'ok' && m.value !== null,
            };
          }),
        };
      }),
      explanation: score.explanation,
      inputs,
      computedAt: score.computedAt.toISOString(),
      highlights: null,
    };
  }

  async impact(userId: string, spec?: string): Promise<ImpactDto> {
    const { period } = await this.resolve(userId, spec);
    const score = await this.scores.scoreFor(userId, period);
    return { ...this.toImpactDto(score), highlights: await this.highlightsFor(userId, score) };
  }

  /**
   * The impact narrative (F-29) generated for exactly these score inputs, if one exists. A plain
   * database lookup — GET /impact never calls the AI (P07/P08 acceptance).
   */
  private async highlightsFor(
    userId: string,
    score: PeriodScore,
  ): Promise<ImpactDto['highlights']> {
    const doc = await this.prisma.generatedDocument.findFirst({
      where: {
        userId,
        type: 'IMPACT_NARRATIVE',
        status: { in: ['READY', 'PENDING', 'STREAMING'] },
        options: { path: ['inputsHash'], equals: inputsHashOf(score.inputs) },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
    return doc ? { documentId: doc.id, status: doc.status.toLowerCase() } : null;
  }

  async impactHistory(userId: string, query: ImpactHistoryQuery): Promise<ImpactHistoryResponse> {
    const { timezone, today } = await this.resolve(userId, undefined);
    const current = periodSpecContaining(query.periodType, today);
    const periods = periodSpecsEnding(current, query.count).map((spec) =>
      resolvePeriod(spec, timezone, today),
    );
    const scores = await this.scores.scoresFor(userId, periods);
    return {
      scoreVersion: SCORE_VERSION,
      points: scores.map((s) => {
        const overall = s.inputs.overall === null ? null : roundScore(s.inputs.overall);
        const dim = (key: (typeof IMPACT_DIMENSIONS)[number]) => {
          const score = s.inputs.dimensions[key].score;
          return score === null ? null : roundScore(score);
        };
        return {
          period: s.period,
          status: s.inputs.status,
          overall,
          band: overall === null ? null : impactBand(overall),
          dimensions: {
            delivery: dim('delivery'),
            quality: dim('quality'),
            collaboration: dim('collaboration'),
            ownership: dim('ownership'),
          },
          scoreVersion: s.inputs.scoreVersion,
        };
      }),
    };
  }

  // ── Timeseries ─────────────────────────────────────────────────────────────────────────

  async timeseries(userId: string, query: TimeseriesQuery): Promise<TimeseriesResponse> {
    let startDate: string;
    let endDate: string;
    let timezone: string;
    if (query.from !== undefined && query.to !== undefined) {
      const settings = await this.repo.settings(userId);
      timezone = settings.timezone;
      const today = todayIn(timezone);
      startDate = query.from;
      endDate = query.to > today ? today : query.to;
      if (startDate > today) throw validation('query.from', '`from` must not be in the future');
    } else {
      const resolved = await this.resolve(userId, query.period);
      ({ startDate, endDate } = resolved.period);
      timezone = resolved.timezone;
    }
    const buckets = bucketsFor(startDate, endDate, query.interval);
    if (buckets.length > MAX_TIMESERIES_POINTS) {
      throw validation(
        'query.interval',
        `Interval too fine for the range (${buckets.length} points; at most ${MAX_TIMESERIES_POINTS})`,
      );
    }
    const meta = metricMeta(query.metric);
    const snapshotOf = SNAPSHOT_METRICS[query.metric];
    let points: TimeseriesResponse['points'];
    if (snapshotOf) {
      const rows = await this.repo.snapshots(userId, timezone, startDate, endDate);
      const byDate = new Map(rows.map((r) => [toLocalDate(r.date), r]));
      points = buckets.map((b) => {
        let value = 0;
        for (let d = b.start; d <= b.end; d = addDays(d, 1)) {
          const row = byDate.get(d);
          if (row) value += snapshotOf(row);
        }
        return { start: b.start, end: b.end, value, n: value };
      });
    } else {
      const { start, endExclusive } = localRangeToUtc(startDate, endDate, timezone);
      const facts = await this.repo.loadFacts(userId, start, endExclusive);
      points = buckets.map((b) => {
        const range = localRangeToUtc(b.start, b.end, timezone);
        const r: MetricResult = computeMetric(query.metric, facts, {
          ...range,
          startDate: b.start,
          endDate: b.end,
          timezone,
          periodDays: daysInclusive(b.start, b.end),
        });
        return { start: b.start, end: b.end, value: r.value, n: r.n };
      });
    }
    return { metric: query.metric, interval: query.interval, unit: meta.unit, points, timezone };
  }

  // ── Heatmap ────────────────────────────────────────────────────────────────────────────

  async heatmap(userId: string, query: HeatmapQuery): Promise<HeatmapResponse> {
    const { timezone } = await this.repo.settings(userId);
    const today = todayIn(timezone);
    const to =
      query.to ?? (query.from ? minDate(addDays(query.from, MAX_HEATMAP_DAYS - 1), today) : today);
    const from = query.from ?? addDays(to, -364);
    if (from > to) throw validation('query.from', '`from` must not be after `to`');
    if (daysInclusive(from, to) > MAX_HEATMAP_DAYS) {
      throw validation('query.from', `The range may span at most ${MAX_HEATMAP_DAYS} days`);
    }
    const rows = await this.repo.snapshots(userId, timezone, from, to);
    const byDate = new Map(rows.map((r) => [toLocalDate(r.date), r]));
    const days: HeatmapResponse['days'] = [];
    let max = 0;
    let total = 0;
    let activeDays = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const r = byDate.get(d);
      const commits = r?.commits ?? 0;
      const prsOpened = r?.prsOpened ?? 0;
      const reviews = r?.reviewsSubmitted ?? 0;
      // Contributions as in active_days: commits, PRs opened and reviews (§3.5).
      const count = commits + prsOpened + reviews;
      max = Math.max(max, count);
      total += count;
      if (r?.active) activeDays++;
      days.push({ date: d, count, commits, prsOpened, prsMerged: r?.prsMerged ?? 0, reviews });
    }
    return { from, to, days, max, total, activeDays, timezone };
  }

  // ── Repositories ───────────────────────────────────────────────────────────────────────

  async repos(userId: string, query: ReposQuery): Promise<ReposResponse> {
    const { period } = await this.resolve(userId, query.period);
    const window = windowOfPeriod(period);
    const facts = await this.repo.loadFacts(userId, window.start, window.endExclusive);
    const ctx = prepareContext(facts, window);
    interface Acc {
      commits: number;
      prsMerged: number;
      prsReviewed: number;
      first: number;
      last: number;
    }
    const acc = new Map<string, Acc>();
    const touch = (repo: string, at: Date) => {
      let a = acc.get(repo);
      if (!a) {
        a = { commits: 0, prsMerged: 0, prsReviewed: 0, first: Infinity, last: -Infinity };
        acc.set(repo, a);
      }
      a.first = Math.min(a.first, at.getTime());
      a.last = Math.max(a.last, at.getTime());
      return a;
    };
    for (const c of ctx.commits) touch(c.repositoryId, c.authoredAt).commits++;
    for (const p of ctx.opened) touch(p.repositoryId, p.createdAt);
    for (const p of ctx.merged) touch(p.repositoryId, p.mergedAt).prsMerged++;
    for (const rp of ctx.reviewedPrs) {
      const a = touch(rp.repositoryId, rp.first.submittedAt);
      a.prsReviewed++;
      for (const r of rp.all) touch(rp.repositoryId, r.submittedAt);
    }
    const names = await this.prisma.repository.findMany({
      where: { userId, id: { in: [...acc.keys()] } },
      select: { id: true, fullName: true },
    });
    const nameOf = new Map(names.map((r) => [r.id, r.fullName]));
    const repos = [...acc.entries()]
      .map(([repositoryId, a]) => ({
        repositoryId,
        fullName: nameOf.get(repositoryId) ?? 'unknown',
        commits: a.commits,
        prsMerged: a.prsMerged,
        prsReviewed: a.prsReviewed,
        firstContributionAt: new Date(a.first).toISOString(),
        lastContributionAt: new Date(a.last).toISOString(),
        twoWay: a.prsMerged > 0 && a.prsReviewed > 0,
      }))
      .sort(
        (x, y) =>
          y.commits + y.prsMerged + y.prsReviewed - (x.commits + x.prsMerged + x.prsReviewed) ||
          x.fullName.localeCompare(y.fullName),
      );
    return { period, repos: repos.slice(0, query.limit), total: repos.length };
  }

  // ── Evidence (A-2) ─────────────────────────────────────────────────────────────────────

  async evidence(
    userId: string,
    metric: ImplementedMetricKey,
    spec: string | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ items: EvidenceItem[]; meta: PageMeta & { truncated: boolean } }> {
    const { period } = await this.resolve(userId, spec);
    const score = await this.scores.scoreFor(userId, period);
    const ids = score.inputs.evidence[metric] ?? [];
    const offset = decodeOffsetCursor(cursor);
    const pageIds = ids.slice(offset, offset + limit);
    const items = await evidenceRefs(this.prisma, userId, metric, pageIds);
    const hasMore = offset + limit < ids.length;
    return {
      items,
      meta: {
        nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
        hasMore,
        total: ids.length,
        truncated: score.inputs.evidenceTruncated[metric] ?? false,
      },
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────

const minDate = (a: string, b: string) => (a < b ? a : b);

/** Day / ISO-week / calendar-month buckets clipped to `[startDate, endDate]`. */
export function bucketsFor(
  startDate: string,
  endDate: string,
  interval: TimeseriesInterval,
): { start: string; end: string }[] {
  const buckets: { start: string; end: string }[] = [];
  let d = startDate;
  while (d <= endDate) {
    let end: string;
    if (interval === 'day') end = d;
    else if (interval === 'week') end = addDays(d, 7 - isoWeekday(d));
    else {
      const [y, m] = d.split('-').map(Number) as [number, number];
      end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    }
    if (end > endDate) end = endDate;
    buckets.push({ start: d, end });
    if (buckets.length > MAX_TIMESERIES_POINTS) break;
    d = addDays(end, 1);
  }
  return buckets;
}
