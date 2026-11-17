import {
  IMPACT_DIMENSIONS,
  IMPLEMENTED_METRIC_KEYS,
  METRICS_VERSION,
  SCORE_VERSION,
  type ImpactDimension,
  type ImplementedMetricKey,
  type PeriodType,
} from '@devimpact/shared';

import { computeImpact, type ImpactComputation, type StoredMetricInput } from './impact';

import type { MetricResults } from './metric-definitions';

/**
 * `ImpactScore.inputs` (KPI_METHODOLOGY §6.6): every metric value of the period plus the score
 * breakdown and evidence ids. Recomputing `computeImpact(inputs.metrics, inputs.period)` must
 * reproduce `overall` and every dimension exactly.
 */
export interface ImpactInputs {
  scoreVersion: string;
  metricsVersion: string;
  period: {
    type: PeriodType;
    startDate: string;
    endDate: string;
    timezone: string;
    periodDays: number;
  };
  metrics: Record<ImplementedMetricKey, StoredMetricInput>;
  dimensions: Record<
    ImpactDimension,
    {
      available: boolean;
      weight: number;
      score: number | null;
      components: {
        metric: ImplementedMetricKey;
        input: number | null;
        band: number | null;
        shrunk: number | null;
        weight: number;
        effectiveWeight: number;
      }[];
    }
  >;
  overall: number | null;
  status: 'ok' | 'insufficient_data';
  evidence: Record<ImplementedMetricKey, string[]>;
  evidenceTruncated: Record<ImplementedMetricKey, boolean>;
}

export function buildImpactInputs(
  results: MetricResults,
  period: ImpactInputs['period'],
): { inputs: ImpactInputs; impact: ImpactComputation } {
  const metrics = {} as ImpactInputs['metrics'];
  const evidence = {} as ImpactInputs['evidence'];
  const evidenceTruncated = {} as ImpactInputs['evidenceTruncated'];
  for (const key of IMPLEMENTED_METRIC_KEYS) {
    const r = results[key];
    metrics[key] = { value: r.value, n: r.n, status: r.status };
    evidence[key] = r.evidence;
    evidenceTruncated[key] = r.evidenceTruncated;
  }
  const impact = computeImpact(metrics, period);
  const dimensions = Object.fromEntries(
    IMPACT_DIMENSIONS.map((key) => {
      const d = impact.dimensions[key];
      return [
        key,
        {
          available: d.available,
          weight: d.weight,
          score: d.score,
          components: d.components.map((c) => ({
            metric: c.metric,
            input: c.input,
            band: c.band,
            shrunk: c.shrunk,
            weight: c.weight,
            effectiveWeight: c.effectiveWeight,
          })),
        },
      ];
    }),
  ) as ImpactInputs['dimensions'];
  return {
    impact,
    inputs: {
      scoreVersion: SCORE_VERSION,
      metricsVersion: METRICS_VERSION,
      period,
      metrics,
      dimensions,
      overall: impact.overall,
      status: impact.status,
      evidence,
      evidenceTruncated,
    },
  };
}
