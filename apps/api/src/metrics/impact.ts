import {
  DIMENSION_LABELS,
  IMPACT_DIMENSIONS,
  METRICS_VERSION,
  SCORE_VERSION,
  impactBand,
  type ImpactDimension,
  type ImplementedMetricKey,
} from '@devimpact/shared';

import type { MetricStatusValue } from './metric-definitions';

/**
 * Impact score `impact@2.0.0` (KPI_METHODOLOGY §5–§6, ADR-0008): absolute reference bands,
 * k = 3 shrinkage toward 50 for ratio/median metrics, saturation, renormalised weights, minimum-data
 * thresholds and half-up rounding at the very end. Pure — reproducible from stored inputs alone.
 */

export const SHRINK_K = 3;
export const NEUTRAL = 50;
export const MIN_PERIOD_DAYS = 7;
export const MIN_MERGED_PLUS_REVIEWED = 3;
export const MIN_DIMENSIONS = 2;

export type Anchor = readonly [x: number, y: number];

interface ComponentSpec {
  metric: ImplementedMetricKey;
  weight: number;
  anchors: readonly Anchor[];
  shrink: boolean;
  /** Count metrics scored on `per28(count)` (§6.2). */
  per28: boolean;
}

export const IMPACT_MODEL: Record<
  ImpactDimension,
  { weight: number; components: readonly ComponentSpec[] }
> = {
  delivery: {
    weight: 0.3,
    components: [
      {
        metric: 'prs_merged',
        weight: 0.5,
        per28: true,
        shrink: false,
        anchors: [
          [0, 0],
          [2, 40],
          [4, 60],
          [8, 85],
          [12, 100],
        ],
      },
      {
        metric: 'pr_cycle_time_median_hours',
        weight: 0.3,
        per28: false,
        shrink: true,
        anchors: [
          [4, 100],
          [24, 85],
          [72, 60],
          [168, 30],
          [336, 0],
        ],
      },
      {
        metric: 'active_weeks_ratio',
        weight: 0.2,
        per28: false,
        shrink: false,
        anchors: [
          [0, 0],
          [0.5, 50],
          [0.75, 80],
          [1, 100],
        ],
      },
    ],
  },
  quality: {
    weight: 0.25,
    components: [
      {
        metric: 'small_pr_ratio',
        weight: 0.4,
        per28: false,
        shrink: true,
        anchors: [
          [0, 0],
          [0.5, 60],
          [0.8, 90],
          [1, 100],
        ],
      },
      {
        metric: 'revert_rate',
        weight: 0.35,
        per28: false,
        shrink: true,
        anchors: [
          [0, 100],
          [0.05, 80],
          [0.1, 50],
          [0.25, 0],
        ],
      },
      {
        metric: 'merge_rate',
        weight: 0.25,
        per28: false,
        shrink: true,
        anchors: [
          [0, 0],
          [0.5, 40],
          [0.8, 80],
          [0.9, 100],
        ],
      },
    ],
  },
  collaboration: {
    weight: 0.3,
    components: [
      {
        metric: 'prs_reviewed',
        weight: 0.5,
        per28: true,
        shrink: false,
        anchors: [
          [0, 0],
          [2, 40],
          [5, 65],
          [10, 90],
          [15, 100],
        ],
      },
      {
        metric: 'review_turnaround_median_hours',
        weight: 0.3,
        per28: false,
        shrink: true,
        anchors: [
          [2, 100],
          [8, 85],
          [24, 65],
          [72, 30],
          [168, 0],
        ],
      },
      {
        metric: 'review_balance',
        weight: 0.2,
        per28: false,
        shrink: true,
        anchors: [
          [0, 0],
          [0.3, 70],
          [0.5, 100],
          [1, 100],
        ],
      },
    ],
  },
  ownership: {
    weight: 0.15,
    components: [
      {
        metric: 'two_way_repos',
        weight: 0.6,
        per28: false,
        shrink: false,
        anchors: [
          [0, 0],
          [1, 60],
          [2, 80],
          [3, 100],
        ],
      },
      {
        metric: 'repos_contributed',
        weight: 0.4,
        per28: false,
        shrink: false,
        anchors: [
          [0, 0],
          [1, 40],
          [3, 75],
          [5, 100],
        ],
      },
    ],
  },
};

/** Piecewise-linear band through `anchors`, clamped outside the first and last anchor (§6.2). */
export function band(x: number, anchors: readonly Anchor[]): number {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (x <= first[0]) return first[1];
  if (x > last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

/** `(n × s + k × 50) / (n + k)` with k = 3 (§6.3). */
export function shrunk(score: number, n: number): number {
  return (n * score + SHRINK_K * NEUTRAL) / (n + SHRINK_K);
}

/** `x × 28 / periodDays` (§2.6). */
export function per28(count: number, periodDays: number): number {
  return (count * 28) / periodDays;
}

/** Half-up rounding used for every displayed score (§6.4 rule 4). */
export function roundScore(x: number): number {
  return Math.floor(x + 0.5);
}

export interface StoredMetricInput {
  value: number | null;
  n: number;
  status: MetricStatusValue | 'not_applicable';
}

export type ImpactMetricInputs = Partial<Record<ImplementedMetricKey, StoredMetricInput>>;

export interface ComponentResult {
  metric: ImplementedMetricKey;
  /** Raw metric value (count, hours or ratio). */
  value: number | null;
  /** Value fed into the band: `per28(count)` for count metrics, else the raw value. */
  input: number | null;
  n: number;
  band: number | null;
  shrunk: number | null;
  weight: number;
  effectiveWeight: number;
  available: boolean;
}

export interface DimensionResult {
  available: boolean;
  weight: number;
  score: number | null;
  components: ComponentResult[];
}

export interface ImpactComputation {
  status: 'ok' | 'insufficient_data';
  /** Full precision; null when insufficient. */
  overall: number | null;
  dimensions: Record<ImpactDimension, DimensionResult>;
  /** Why the score is insufficient (for logs/tests; the UI copy is fixed). */
  reason: 'period_too_short' | 'not_enough_activity' | 'too_few_dimensions' | null;
}

/** `overall = Σ (w_d × D_d) / Σ w_d` over available dimensions (§6.4 rule 3). */
export function combineDimensions(
  dimensions: { weight: number; score: number | null; available: boolean }[],
): number | null {
  let weighted = 0;
  let weights = 0;
  for (const d of dimensions) {
    if (!d.available || d.score === null) continue;
    weighted += d.weight * d.score;
    weights += d.weight;
  }
  return weights === 0 ? null : weighted / weights;
}

function scoreDimension(
  spec: (typeof IMPACT_MODEL)[ImpactDimension],
  metrics: ImpactMetricInputs,
  periodDays: number,
): DimensionResult {
  const components: ComponentResult[] = spec.components.map((c) => {
    const m = metrics[c.metric];
    const value = m?.status === 'ok' ? m.value : null;
    const available = value !== null;
    const input = value === null ? null : c.per28 ? per28(value, periodDays) : value;
    const bandScore = input === null ? null : band(input, c.anchors);
    return {
      metric: c.metric,
      value,
      input,
      n: m?.n ?? 0,
      band: bandScore,
      shrunk: bandScore !== null && c.shrink ? shrunk(bandScore, m?.n ?? 0) : null,
      weight: c.weight,
      effectiveWeight: 0,
      available,
    };
  });
  const totalWeight = components.reduce((s, c) => s + (c.available ? c.weight : 0), 0);
  let score: number | null = null;
  if (totalWeight > 0) {
    score = 0;
    for (const c of components) {
      if (!c.available) continue;
      c.effectiveWeight = c.weight / totalWeight;
      score += c.effectiveWeight * (c.shrunk ?? c.band ?? 0);
    }
  }
  return { available: score !== null, weight: spec.weight, score, components };
}

/** The whole score from stored metric inputs (§6.6: `computeImpact(inputs.metrics, inputs.period)`). */
export function computeImpact(
  metrics: ImpactMetricInputs,
  period: { periodDays: number },
): ImpactComputation {
  const dimensions = Object.fromEntries(
    IMPACT_DIMENSIONS.map((key) => [
      key,
      scoreDimension(IMPACT_MODEL[key], metrics, period.periodDays),
    ]),
  ) as Record<ImpactDimension, DimensionResult>;

  const merged = metrics.prs_merged?.value ?? 0;
  const reviewed = metrics.prs_reviewed?.value ?? 0;
  const available = IMPACT_DIMENSIONS.filter((k) => dimensions[k].available).length;
  const reason =
    period.periodDays < MIN_PERIOD_DAYS
      ? 'period_too_short'
      : merged + reviewed < MIN_MERGED_PLUS_REVIEWED
        ? 'not_enough_activity'
        : available < MIN_DIMENSIONS
          ? 'too_few_dimensions'
          : null;

  if (reason !== null) {
    // §5: no overall or dimension scores are shown; component values/n stay visible.
    for (const key of IMPACT_DIMENSIONS) {
      const d = dimensions[key];
      d.score = null;
      for (const c of d.components) {
        c.band = null;
        c.shrunk = null;
        c.effectiveWeight = 0;
      }
    }
    return { status: 'insufficient_data', overall: null, dimensions, reason };
  }

  const overall = combineDimensions(IMPACT_DIMENSIONS.map((k) => dimensions[k]));
  return { status: 'ok', overall, dimensions, reason: null };
}

// ── Explanation (§6.7) ─────────────────────────────────────────────────────────────────────

const INSUFFICIENT_COPY =
  'Not enough activity in this period to compute a fair score — try a longer period.';

/** Plain-text "How is this calculated?" for the period (stored in `ImpactScore.explanation`). */
export function renderExplanation(impact: ImpactComputation, periodLabel: string): string {
  const footer = `Version ${SCORE_VERSION} (${METRICS_VERSION}). Only repositories you included are counted.`;
  if (impact.status !== 'ok' || impact.overall === null) {
    return [
      `Your impact score for ${periodLabel}: not enough data.`,
      INSUFFICIENT_COPY,
      'The score combines Delivery, Quality, Collaboration and Ownership signals from your GitHub activity (weights 30 / 25 / 30 / 15) and is never compared with other people.',
      footer,
    ].join('\n\n');
  }
  const overall = roundScore(impact.overall);
  const dim = (key: ImpactDimension) => {
    const score = impact.dimensions[key].score;
    return score === null ? '—' : String(roundScore(score));
  };
  const unavailable = IMPACT_DIMENSIONS.filter((k) => !impact.dimensions[k].available).map(
    (k) =>
      `${DIMENSION_LABELS[k]} wasn't scored this period because there wasn't enough data; the other dimensions were re-weighted.`,
  );
  return [
    `Your impact score: ${overall} (${impactBand(overall)}) — a summary of signals from your GitHub activity in ${periodLabel}, not a judgement of your performance.`,
    `It combines four dimensions: Delivery ${dim('delivery')} (PRs merged, cycle time, steady weeks), Quality ${dim('quality')} (small PRs, reverts, merge rate), Collaboration ${dim('collaboration')} (PRs reviewed, review turnaround, review balance) and Ownership ${dim('ownership')} (repositories where you both ship and review, breadth). Weights: 30 / 25 / 30 / 15.`,
    'Each metric is compared with fixed reference ranges based on public engineering research — never with other people. Results from small samples are pulled toward the middle, and volume beyond a healthy level earns no extra points. Lines of code are not used.',
    ...unavailable,
    footer,
  ].join('\n\n');
}
