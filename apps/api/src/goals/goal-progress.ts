import { periodSpecContaining, shiftPeriodSpec, type GoalProgress } from '@devimpact/shared';

import type { StoredMetricInput } from '../metrics/impact';

/**
 * Month a goal is evaluated on (API_CONTRACT_V2 §16): the most recent complete calendar month in
 * the user's time zone, or the current in-progress month when the goal started this month.
 */
export function evaluationMonthSpec(startDate: string, today: string): string {
  const current = periodSpecContaining('month', today);
  return startDate >= `${today.slice(0, 7)}-01` ? current : shiftPeriodSpec(current, -1);
}

/** Pure progress rule: numbers come only from the metrics engine (KPI_METHODOLOGY §8). */
export function progressOf(
  target: { comparator: 'lte' | 'gte'; targetValue: number } | null,
  metric: StoredMetricInput | undefined,
  evaluatedPeriod: GoalProgress['evaluatedPeriod'],
): GoalProgress {
  if (!target) return { current: null, target: null, status: 'no_metric', evaluatedPeriod: null };
  const value = metric?.status === 'ok' ? metric.value : null;
  if (value === null || value === undefined) {
    return { current: null, target: target.targetValue, status: 'no_data', evaluatedPeriod };
  }
  const met =
    target.comparator === 'lte' ? value <= target.targetValue : value >= target.targetValue;
  return {
    current: value,
    target: target.targetValue,
    status: met ? 'met' : 'not_met',
    evaluatedPeriod,
  };
}
