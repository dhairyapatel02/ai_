import { z } from 'zod';

import {
  DEFERRED_METRIC_KEYS,
  IMPACT_DIMENSIONS,
  IMPLEMENTED_METRIC_KEYS,
  METRIC_SECTIONS,
} from '../metrics/catalogue';
import { PERIOD_SPEC_PATTERN, PERIOD_TYPES } from '../periods';
import { Id, LocalDate, PageQuery, Timestamp } from './common';

/**
 * Metrics, impact and career contracts (API_CONTRACT_V2 §3.4, §9, §10, §12 and amendments A-1,
 * A-2). All metric endpoints are read-only: they never call the AI and never enqueue work.
 */

// ── Periods (§3.4) ─────────────────────────────────────────────────────────────────────────

export const PeriodSpec = z.string().max(40).regex(PERIOD_SPEC_PATTERN, {
  message:
    'Expected month:YYYY-MM | quarter:YYYY-Qn | half:YYYY-Hn | year:YYYY | custom:YYYY-MM-DD..YYYY-MM-DD',
});

export const ResolvedPeriodDto = z.object({
  spec: PeriodSpec,
  type: z.enum(PERIOD_TYPES),
  startDate: LocalDate,
  endDate: LocalDate,
  timezone: z.string(),
  periodDays: z.number().int(),
  inProgress: z.boolean(),
  label: z.string(),
});
export type ResolvedPeriodDto = z.infer<typeof ResolvedPeriodDto>;

/** `?period=` — default: the user's `defaultPeriodType` containing today. */
export const PeriodQuery = z.strictObject({ period: PeriodSpec.optional() });
export type PeriodQuery = z.infer<typeof PeriodQuery>;

/**
 * Query-string list: repeated params (`?a=x&a=y`) and comma lists (`?a=x,y`) are both accepted.
 */
export function QueryList<T extends z.ZodType>(item: T, max: number) {
  return z.preprocess((value: unknown): unknown => {
    if (value === undefined) return undefined;
    const raw: unknown[] = Array.isArray(value) ? (value as unknown[]) : [value];
    return raw
      .flatMap((v): unknown[] => (typeof v === 'string' ? v.split(',') : [v]))
      .map((v): unknown => (typeof v === 'string' ? v.trim() : v))
      .filter((v) => v !== '');
  }, z.array(item).max(max));
}

// ── Metric values and definitions (§9) ─────────────────────────────────────────────────────

export const MetricKeyWire = z.enum([...IMPLEMENTED_METRIC_KEYS, ...DEFERRED_METRIC_KEYS]);
/** Keys the engine computes (deferred issue metrics are rejected in queries). */
export const ImplementedMetricKeyWire = z.enum(IMPLEMENTED_METRIC_KEYS);
export const MetricStatus = z.enum(['ok', 'insufficient_data', 'not_applicable']);
export type MetricStatus = z.infer<typeof MetricStatus>;
export const MetricUnitWire = z.enum(['count', 'hours', 'ratio', 'repos', 'days', 'weeks']);
export const MetricDirectionWire = z.enum(['higher_is_better', 'lower_is_better', 'neutral']);

export const MetricValue = z.object({
  key: MetricKeyWire,
  label: z.string(),
  unit: MetricUnitWire,
  value: z.number().nullable(),
  n: z.number().int(),
  status: MetricStatus,
  previousValue: z.number().nullable(),
  delta: z.number().nullable(),
  deltaPct: z.number().nullable(),
  direction: MetricDirectionWire,
  inScore: z.boolean(),
  evidence: z.array(Id).max(200),
  evidenceTruncated: z.boolean(),
});
export type MetricValue = z.infer<typeof MetricValue>;

export const MetricDefinition = z.object({
  key: MetricKeyWire,
  label: z.string(),
  section: z.enum([...METRIC_SECTIONS, 'issues']),
  definition: z.string(),
  formula: z.string(),
  unit: MetricUnitWire,
  minN: z.number().int(),
  goodRange: z.string(),
  caveats: z.array(z.string()),
  antiGaming: z.string().nullable(),
  inScore: z.boolean(),
  deferred: z.boolean(),
  direction: MetricDirectionWire,
});
export type MetricDefinition = z.infer<typeof MetricDefinition>;

export const ImpactBandDto = z.object({ min: z.number(), max: z.number(), label: z.string() });

export const DefinitionsResponse = z.object({
  metricsVersion: z.string(),
  scoreVersion: z.string(),
  metrics: z.array(MetricDefinition),
  bands: z.array(ImpactBandDto),
});
export type DefinitionsResponse = z.infer<typeof DefinitionsResponse>;

export const ScoreStatusWire = z.enum(['ok', 'insufficient_data']);
export type ScoreStatusWire = z.infer<typeof ScoreStatusWire>;

export const DataFreshness = z.object({
  lastSuccessfulSyncAt: Timestamp.nullable(),
  syncing: z.boolean(),
});

export const OverviewResponse = z.object({
  period: ResolvedPeriodDto,
  previousPeriod: ResolvedPeriodDto,
  comparison: z.enum(['full', 'same_elapsed']),
  cards: z.array(MetricValue),
  impact: z.object({
    status: ScoreStatusWire,
    overall: z.number().int().nullable(),
    delta: z.number().int().nullable(),
    band: z.string().nullable(),
  }),
  dataFreshness: DataFreshness,
});
export type OverviewResponse = z.infer<typeof OverviewResponse>;

export const KpiSection = z.object({
  key: z.enum(METRIC_SECTIONS),
  title: z.string(),
  metrics: z.array(MetricValue),
});

export const KpisResponse = z.object({
  period: ResolvedPeriodDto,
  previousPeriod: ResolvedPeriodDto,
  comparison: z.enum(['full', 'same_elapsed']),
  sections: z.array(KpiSection),
  impactStatus: ScoreStatusWire,
  metricsVersion: z.string(),
});
export type KpisResponse = z.infer<typeof KpisResponse>;

export const TimeseriesInterval = z.enum(['day', 'week', 'month']);
export type TimeseriesInterval = z.infer<typeof TimeseriesInterval>;

const rangeOrPeriod = (value: { period?: string; from?: string; to?: string }) =>
  !(value.period !== undefined && (value.from !== undefined || value.to !== undefined));
const orderedRange = (value: { from?: string; to?: string }) =>
  value.from === undefined || value.to === undefined || value.from <= value.to;

export const TimeseriesQuery = z
  .strictObject({
    metric: ImplementedMetricKeyWire,
    period: PeriodSpec.optional(),
    from: LocalDate.optional(),
    to: LocalDate.optional(),
    interval: TimeseriesInterval.default('day'),
  })
  .refine(rangeOrPeriod, { message: 'Use either `period` or `from`/`to`', path: ['period'] })
  .refine((v) => (v.from === undefined) === (v.to === undefined), {
    message: '`from` and `to` must be given together',
    path: ['from'],
  })
  .refine(orderedRange, { message: '`from` must not be after `to`', path: ['from'] });
export type TimeseriesQuery = z.infer<typeof TimeseriesQuery>;

export const TimeseriesPoint = z.object({
  start: LocalDate,
  end: LocalDate,
  value: z.number().nullable(),
  n: z.number().int(),
});

export const TimeseriesResponse = z.object({
  metric: ImplementedMetricKeyWire,
  interval: TimeseriesInterval,
  unit: MetricUnitWire,
  points: z.array(TimeseriesPoint).max(400),
  timezone: z.string(),
});
export type TimeseriesResponse = z.infer<typeof TimeseriesResponse>;

export const HeatmapQuery = z
  .strictObject({ from: LocalDate.optional(), to: LocalDate.optional() })
  .refine(orderedRange, { message: '`from` must not be after `to`', path: ['from'] });
export type HeatmapQuery = z.infer<typeof HeatmapQuery>;

export const HeatmapDay = z.object({
  date: LocalDate,
  count: z.number().int(),
  commits: z.number().int(),
  prsOpened: z.number().int(),
  prsMerged: z.number().int(),
  reviews: z.number().int(),
});

export const HeatmapResponse = z.object({
  from: LocalDate,
  to: LocalDate,
  days: z.array(HeatmapDay),
  max: z.number().int(),
  total: z.number().int(),
  activeDays: z.number().int(),
  timezone: z.string(),
});
export type HeatmapResponse = z.infer<typeof HeatmapResponse>;

export const ReposQuery = z.strictObject({
  period: PeriodSpec.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ReposQuery = z.infer<typeof ReposQuery>;

export const RepoContribution = z.object({
  repositoryId: Id,
  fullName: z.string(),
  commits: z.number().int(),
  prsMerged: z.number().int(),
  prsReviewed: z.number().int(),
  firstContributionAt: Timestamp,
  lastContributionAt: Timestamp,
  twoWay: z.boolean(),
});

export const ReposResponse = z.object({
  period: ResolvedPeriodDto,
  repos: z.array(RepoContribution),
  total: z.number().int(),
});
export type ReposResponse = z.infer<typeof ReposResponse>;

/** A-1 `GET /metrics/trends`. */
export const TrendsQuery = z.strictObject({
  period: PeriodSpec.optional(),
  count: z.coerce.number().int().min(1).max(12).default(6),
  metrics: QueryList(ImplementedMetricKeyWire, IMPLEMENTED_METRIC_KEYS.length).optional(),
});
export type TrendsQuery = z.infer<typeof TrendsQuery>;

export const TrendsResponse = z.object({
  periodType: z.enum(PERIOD_TYPES),
  points: z.array(z.object({ period: ResolvedPeriodDto })),
  series: z.array(
    z.object({ metric: ImplementedMetricKeyWire, values: z.array(z.number().nullable()) }),
  ),
});
export type TrendsResponse = z.infer<typeof TrendsResponse>;

// ── Evidence (§3.3, A-2) ────────────────────────────────────────────────────────────────────

export const EvidenceRef = z.string().regex(/^(PR|REV|C|ACH)-[A-Za-z0-9._/@#-]{1,120}$/);
export const EvidenceKind = z.enum(['pull_request', 'review', 'commit', 'achievement']);
export const EvidenceItem = z.object({
  ref: EvidenceRef,
  kind: EvidenceKind,
  id: Id,
  title: z.string(),
  repo: z.string().nullable(),
  url: z.url().nullable(),
  occurredAt: Timestamp,
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const EvidenceQuery = PageQuery.extend({
  metric: ImplementedMetricKeyWire,
  period: PeriodSpec.optional(),
});
export type EvidenceQuery = z.infer<typeof EvidenceQuery>;

// ── Impact (§10) ────────────────────────────────────────────────────────────────────────────

export const ImpactComponentDto = z.object({
  metric: ImplementedMetricKeyWire,
  value: z.number().nullable(),
  n: z.number(),
  bandScore: z.number().nullable(),
  shrunkScore: z.number().nullable(),
  weight: z.number(),
  /** Weight after renormalising over available components (0 when dropped). */
  effectiveWeight: z.number(),
  available: z.boolean(),
});

export const ImpactDimensionDto = z.object({
  key: z.enum(IMPACT_DIMENSIONS),
  label: z.string(),
  score: z.number().int().nullable(),
  weight: z.number(),
  available: z.boolean(),
  components: z.array(ImpactComponentDto),
});

export const ImpactDto = z.object({
  period: ResolvedPeriodDto,
  status: ScoreStatusWire,
  scoreVersion: z.string(),
  overall: z.number().int().nullable(),
  band: z.string().nullable(),
  dimensions: z.array(ImpactDimensionDto),
  explanation: z.string(),
  /** KPI_METHODOLOGY §6.6 (`ImpactInputs`). */
  inputs: z.unknown(),
  computedAt: Timestamp,
  /** AI narrative (F-29, P08). Always null until `POST /impact/highlights` exists. */
  highlights: z.object({ documentId: Id, status: z.string() }).nullable(),
});
export type ImpactDto = z.infer<typeof ImpactDto>;

export const ImpactHistoryQuery = z.strictObject({
  periodType: z.enum(['month', 'quarter']).default('month'),
  count: z.coerce.number().int().min(1).max(24).default(12),
});
export type ImpactHistoryQuery = z.infer<typeof ImpactHistoryQuery>;

const dimensionScores = z.object({
  delivery: z.number().int().nullable(),
  quality: z.number().int().nullable(),
  collaboration: z.number().int().nullable(),
  ownership: z.number().int().nullable(),
});

export const ImpactHistoryResponse = z.object({
  points: z.array(
    z.object({
      period: ResolvedPeriodDto,
      status: ScoreStatusWire,
      overall: z.number().int().nullable(),
      band: z.string().nullable(),
      dimensions: dimensionScores,
      scoreVersion: z.string(),
    }),
  ),
  scoreVersion: z.string(),
});
export type ImpactHistoryResponse = z.infer<typeof ImpactHistoryResponse>;

/**
 * Stored score inputs (§6.6): everything needed to recompute the score without the database.
 * Also the period-metrics cache behind `/metrics/kpis`, `/metrics/trends` and `/metrics/evidence`.
 */
export const StoredMetric = z.object({
  value: z.number().nullable(),
  n: z.number().int(),
  status: MetricStatus,
});
export const ImpactInputsSchema = z.object({
  scoreVersion: z.string(),
  metricsVersion: z.string(),
  period: z.object({
    type: z.enum(PERIOD_TYPES),
    startDate: LocalDate,
    endDate: LocalDate,
    timezone: z.string(),
    periodDays: z.number().int(),
  }),
  metrics: z.record(z.string(), StoredMetric),
  dimensions: z.record(z.string(), z.unknown()),
  overall: z.number().nullable(),
  status: ScoreStatusWire,
  evidence: z.record(z.string(), z.array(z.string())),
  evidenceTruncated: z.record(z.string(), z.boolean()),
});
export type ImpactInputsWire = z.infer<typeof ImpactInputsSchema>;

// ── Career (§12) ────────────────────────────────────────────────────────────────────────────

export const CareerTimelineQuery = z.strictObject({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type CareerTimelineQuery = z.infer<typeof CareerTimelineQuery>;

export const CareerItem = z.object({
  type: z.enum(['pr_merged', 'achievement', 'review_cluster']),
  id: Id,
  ref: EvidenceRef,
  title: z.string(),
  date: LocalDate,
  url: z.url().nullable(),
  tags: z.array(z.string()),
  count: z.number().int().optional(),
});

export const CareerMilestone = z.object({
  kind: z.enum([
    'first_merged_pr_in_repo',
    'largest_merged_pr',
    'longest_active_week_streak',
    'achievement',
  ]),
  date: LocalDate,
  title: z.string(),
  refs: z.array(EvidenceRef),
});

export const CareerQuarter = z.object({
  quarter: z.number().int().min(1).max(4),
  label: z.string(),
  inProgress: z.boolean(),
  repos: z.array(
    z.object({
      repositoryId: Id,
      fullName: z.string(),
      items: z.array(CareerItem),
      truncated: z.boolean(),
      totalItems: z.number().int(),
    }),
  ),
  milestones: z.array(CareerMilestone),
  /** "Beyond code" group (P12, §22 A-7): the quarter's achievements, newest first. */
  achievements: z.array(CareerItem).default([]),
  totals: z.object({
    prsMerged: z.number().int(),
    prsReviewed: z.number().int(),
    achievements: z.number().int(),
  }),
});

export const CareerTimelineResponse = z.object({
  years: z.array(z.number().int()),
  year: z.number().int(),
  timezone: z.string(),
  quarters: z.array(CareerQuarter),
});
export type CareerTimelineResponse = z.infer<typeof CareerTimelineResponse>;
