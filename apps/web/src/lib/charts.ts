import { formatCount, formatLocalDate, formatLocalMonth, plural } from '@/lib/format';

import type { HeatmapResponse, TimeseriesResponse } from '@devimpact/shared';

/**
 * Chart helpers (DESIGN_SYSTEM §4.5, §6): interval choice, bucketing of the per-day heatmap
 * series into week/month columns, table rows and `aria-label` summaries. Pure and unit-tested;
 * the Recharts plots only draw what these return.
 */

export type ChartInterval = 'day' | 'week' | 'month';

/** Fixed series assignment — never cycled (Commits = 1, PRs merged = 2, Reviews = 3). */
export const ACTIVITY_SERIES = [
  { key: 'commits', label: 'Commits', color: 'var(--chart-1)' },
  { key: 'prsMerged', label: 'PRs merged', color: 'var(--chart-2)' },
  { key: 'reviews', label: 'Reviews', color: 'var(--chart-3)' },
] as const;
export type ActivitySeriesKey = (typeof ACTIVITY_SERIES)[number]['key'];

/** ActivityChart interval (DESIGN_SYSTEM §5.2): day ≤ 45 days, week ≤ 200 days, month above. */
export function chooseInterval(days: number): ChartInterval {
  if (days <= 45) return 'day';
  if (days <= 200) return 'week';
  return 'month';
}

/** Inclusive day count between two local dates. */
export function daysBetween(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `date`. */
function isoWeekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

export interface ActivityRow {
  /** First local date of the bucket. */
  start: string;
  /** Last local date of the bucket (clipped to the range). */
  end: string;
  /** Full label for tooltips and tables: `Mon, Nov 9` · `Nov 2 – Nov 8` · `November 2026`. */
  label: string;
  /** Axis label: `Nov 9` · `Nov 2` · `Nov`. */
  short: string;
  commits: number;
  prsMerged: number;
  reviews: number;
}

type HeatDay = Pick<HeatmapResponse['days'][number], 'date' | 'commits' | 'prsMerged' | 'reviews'>;

/**
 * Per-day series → columns for `[from, to]` at `interval`. Missing days count as zero; ISO weeks
 * and calendar months are clipped to the range (same rule as `/metrics/timeseries`).
 */
export function bucketActivity(
  days: HeatDay[],
  from: string,
  to: string,
  interval: ChartInterval,
  currentYear?: number,
): ActivityRow[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const rows: ActivityRow[] = [];
  const keyOf = (date: string) =>
    interval === 'day' ? date : interval === 'week' ? isoWeekStart(date) : date.slice(0, 7);
  let current: ActivityRow | null = null;
  let currentKey = '';
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const key = keyOf(date);
    if (!current || key !== currentKey) {
      current = {
        start: date,
        end: date,
        label: '',
        short: '',
        commits: 0,
        prsMerged: 0,
        reviews: 0,
      };
      currentKey = key;
      rows.push(current);
    }
    current.end = date;
    const d = byDate.get(date);
    if (d) {
      current.commits += d.commits;
      current.prsMerged += d.prsMerged;
      current.reviews += d.reviews;
    }
  }
  for (const row of rows) {
    if (interval === 'day') {
      row.label = formatLocalDate(row.start, { weekday: true, currentYear });
      row.short = formatLocalDate(row.start);
    } else if (interval === 'week') {
      row.label =
        row.start === row.end
          ? formatLocalDate(row.start, { currentYear })
          : `${formatLocalDate(row.start)} – ${formatLocalDate(row.end, { currentYear })}`;
      row.short = formatLocalDate(row.start);
    } else {
      row.label = formatLocalMonth(row.start);
      row.short = formatLocalMonth(row.start, false);
    }
  }
  return rows;
}

export function activityTotals(rows: ActivityRow[]) {
  return rows.reduce(
    (t, r) => ({
      commits: t.commits + r.commits,
      prsMerged: t.prsMerged + r.prsMerged,
      reviews: t.reviews + r.reviews,
    }),
    { commits: 0, prsMerged: 0, reviews: 0 },
  );
}

const INTERVAL_WORD: Record<ChartInterval, string> = { day: 'day', week: 'week', month: 'month' };

/** `aria-label` summary (DESIGN_SYSTEM §6 Tooltips): what is plotted, for when, and the totals. */
export function activityAriaSummary(
  rows: ActivityRow[],
  interval: ChartInterval,
  periodLabel: string,
) {
  const t = activityTotals(rows);
  return `Stacked columns of commits, PRs merged and reviews per ${INTERVAL_WORD[interval]} for ${periodLabel}. Totals: ${plural(t.commits, 'commit')}, ${plural(t.prsMerged, 'PR merged', 'PRs merged')}, ${plural(t.reviews, 'review')}.`;
}

/** Clean y-axis maximum and ticks (0, mid, max) — DESIGN_SYSTEM §6 "3 ticks rounded". */
export function niceMax(value: number): number {
  if (value <= 4) return 4;
  if (value <= 10) return Math.ceil(value / 2) * 2;
  const p = 10 ** Math.floor(Math.log10(value));
  const n = value / p;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function niceTicks(max: number): number[] {
  const top = niceMax(Math.max(1, max));
  return [0, top / 2, top];
}

/** Axis tick text: full under 10,000, compact (`12K`) above. */
export function formatAxis(value: number): string {
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}K`;
  return formatCount(value);
}

/** Metric value as plain text for charts, tables and summaries (§6 number formatting). */
export function formatUnitValue(value: number | null, unit: string): string {
  if (value === null) return '—';
  if (unit === 'ratio') return `${Math.round(value * 100)}%`;
  if (unit === 'hours') return `${value.toFixed(1)} h`;
  if (Number.isInteger(value)) return formatCount(value);
  return (Math.round(value * 10) / 10).toLocaleString('en-US');
}

export interface ColumnPoint {
  label: string;
  short: string;
  value: number | null;
  n: number;
}

/** Timeseries points (month interval) → columns for the explain drawer. */
export function timeseriesColumns(series: TimeseriesResponse): ColumnPoint[] {
  return series.points.map((p) => ({
    label: series.interval === 'month' ? formatLocalMonth(p.start) : formatLocalDate(p.start),
    short:
      series.interval === 'month' ? formatLocalMonth(p.start, false) : formatLocalDate(p.start),
    value: p.value,
    n: p.n,
  }));
}

export function columnsAriaSummary(
  points: ColumnPoint[],
  metricLabel: string,
  unit: string,
): string {
  if (points.length === 0) return `${metricLabel}: no data.`;
  const first = points[0]?.label ?? '';
  const last = points.at(-1);
  const known = points.filter((p) => p.value !== null).length;
  return `Columns of ${metricLabel} per month from ${first} to ${last?.label ?? ''}. ${
    last
      ? `Latest: ${last.value === null ? 'not enough data' : formatUnitValue(last.value, unit)}.`
      : ''
  } ${known} of ${points.length} months have enough data.`;
}

export interface LinePoint {
  label: string;
  short: string;
  value: number | null;
  note?: string;
}

export function lineAriaSummary(points: LinePoint[], seriesLabel: string): string {
  const known = points.filter((p) => p.value !== null);
  const last = known.at(-1);
  if (!last) return `${seriesLabel}: not enough data in any month.`;
  const min = Math.min(...known.map((p) => p.value ?? 0));
  const max = Math.max(...known.map((p) => p.value ?? 0));
  return `Line chart of ${seriesLabel} from ${points[0]?.label ?? ''} to ${points.at(-1)?.label ?? ''} on a 0–100 scale. Latest ${last.value} (${last.label}); range ${min}–${max}. ${points.length - known.length} months without enough data are shown as gaps.`;
}
