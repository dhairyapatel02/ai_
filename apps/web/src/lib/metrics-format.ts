import type { MetricValue } from '@devimpact/shared';

/** Display formatting for metric values (full precision on the wire, rounded only here). */
export function formatMetric(m: Pick<MetricValue, 'value' | 'unit' | 'status' | 'n'>): string {
  if (m.status !== 'ok' || m.value === null) return 'Not enough data';
  switch (m.unit) {
    case 'ratio':
      return `${Math.round(m.value * 100)}%`;
    case 'hours':
      return `${m.value.toFixed(1)} h`;
    default:
      return String(Math.round(m.value * 10) / 10);
  }
}
