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

export function formatDelta(m: Pick<MetricValue, 'delta' | 'unit'>): string | null {
  if (m.delta === null) return null;
  const sign = m.delta > 0 ? '+' : m.delta < 0 ? '−' : '±';
  const abs = Math.abs(m.delta);
  const value =
    m.unit === 'ratio'
      ? `${Math.round(abs * 100)} pts`
      : m.unit === 'hours'
        ? `${abs.toFixed(1)} h`
        : String(Math.round(abs * 10) / 10);
  return `${sign}${value}`;
}
