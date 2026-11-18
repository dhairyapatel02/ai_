'use client';

import { memo, useEffect, useMemo, useRef } from 'react';

import { ChartCard } from '@/components/states/chart-card';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { HeatmapResponse } from '@devimpact/shared';

type Day = Pick<HeatmapResponse['days'][number], 'date' | 'count'> &
  Partial<Pick<HeatmapResponse['days'][number], 'commits' | 'prsOpened' | 'prsMerged' | 'reviews'>>;

const LEVEL_CLASS = ['bg-heat-0', 'bg-heat-1', 'bg-heat-2', 'bg-heat-3', 'bg-heat-4'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Quartile thresholds over *active* days → levels 1–4; 0 = no activity (DESIGN_SYSTEM §5.2). */
export function heatLevels(days: Day[]): (count: number) => 0 | 1 | 2 | 3 | 4 {
  const active = days
    .map((d) => d.count)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
  const q = (p: number) => active[Math.min(active.length - 1, Math.floor(p * active.length))] ?? 0;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  return (count) => (count <= 0 ? 0 : count <= q1 ? 1 : count <= q2 ? 2 : count <= q3 ? 3 : 4);
}

/** Columns of 7 days (Monday first, ISO weeks); leading cells before the first day are null. */
export function heatmapWeeks(days: Day[]): (Day | null)[][] {
  if (days.length === 0) return [];
  const first = new Date(`${days[0]?.date ?? ''}T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cells: (Day | null)[] = [...Array<null>(lead).fill(null), ...days];
  const weeks: (Day | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function monthlyTotals(days: Day[]) {
  const totals = new Map<string, { total: number; active: number }>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    const t = totals.get(key) ?? { total: 0, active: 0 };
    t.total += d.count;
    if (d.count > 0) t.active += 1;
    totals.set(key, t);
  }
  return [...totals.entries()].map(([month, t]) => ({
    month,
    label: `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`,
    total: t.total,
    active: t.active,
  }));
}

function cellTitle(day: Day): string {
  const parts = [`${day.date}: ${day.count} contribution${day.count === 1 ? '' : 's'}`];
  if (day.commits !== undefined) {
    parts.push(
      `${day.commits} commit${day.commits === 1 ? '' : 's'}, ${day.prsOpened ?? 0} PRs opened, ${day.prsMerged ?? 0} merged, ${day.reviews ?? 0} review${day.reviews === 1 ? '' : 's'}`,
    );
  }
  return parts.join(' · ');
}

const HATCH = {
  backgroundImage: 'repeating-linear-gradient(45deg, var(--surface-3) 0 2px, transparent 2px 4px)',
} as const;

/**
 * 12-month contribution heatmap (DESIGN_SYSTEM §5.2 ActivityHeatmap): 53 × 7 grid of 11 px cells,
 * 5 levels by quartile of active days, month labels, a tooltip per cell (`title`, supplementary),
 * scrolled to the newest week on small screens, and a "View as table" of monthly totals.
 */
export const ActivityHeatmap = memo(function ActivityHeatmap({
  days,
  title = 'Contributions',
  className,
  importingBefore,
}: {
  days: Day[];
  title?: string;
  className?: string;
  /** During the first backfill: days before this local date are hatched "Still importing". */
  importingBefore?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const level = useMemo(() => heatLevels(days), [days]);
  const weeks = useMemo(() => heatmapWeeks(days), [days]);
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const activeDays = days.filter((d) => d.count > 0).length;
  const months = monthlyTotals(days);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks.length]);

  const summary = `Calendar heatmap of ${formatCount(total)} contributions on ${formatCount(activeDays)} active days${
    days.length ? ` from ${days[0]?.date ?? ''} to ${days.at(-1)?.date ?? ''}` : ''
  }.`;

  return (
    <ChartCard
      title={title}
      description={`Last 12 months · ${formatCount(total)} contribution${total === 1 ? '' : 's'} on ${formatCount(activeDays)} day${activeDays === 1 ? '' : 's'}`}
      className={className}
      table={
        <table className="w-full text-sm">
          <caption className="sr-only">Contributions per month</caption>
          <thead>
            <tr className="border-b border-border-strong text-left text-muted-foreground">
              <th scope="col" className="py-1.5 font-medium">
                Month
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Contributions
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Active days
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-b last:border-b-0">
                <td className="py-1.5">{m.label}</td>
                <td className="py-1.5 text-right tabular-nums">{formatCount(m.total)}</td>
                <td className="py-1.5 text-right tabular-nums">{formatCount(m.active)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div
        ref={scroller}
        className="overflow-x-auto pb-1"
        tabIndex={0}
        role="region"
        aria-label="Contribution heatmap, scrollable"
      >
        <div role="img" aria-label={summary} className="inline-flex flex-col gap-1">
          <div
            className="flex gap-[3px] pl-0 text-caption text-subtle-foreground"
            aria-hidden="true"
          >
            {weeks.map((week, i) => {
              const firstDay = week.find((d) => d !== null);
              const showLabel = firstDay && Number(firstDay.date.slice(8, 10)) <= 7;
              return (
                <span key={i} className="w-[11px] overflow-visible whitespace-nowrap">
                  {showLabel ? MONTHS[Number(firstDay.date.slice(5, 7)) - 1] : ''}
                </span>
              );
            })}
          </div>
          <div className="flex gap-[3px]" aria-hidden="true">
            {weeks.map((week, i) => (
              <div key={i} className="flex flex-col gap-[3px]">
                {week.map((day, j) =>
                  day && importingBefore && day.date < importingBefore ? (
                    <span
                      key={day.date}
                      title={`${day.date}: still importing`}
                      className="size-[11px] rounded-[2px] bg-heat-0"
                      style={HATCH}
                      data-level="importing"
                    />
                  ) : day ? (
                    <span
                      key={day.date}
                      title={cellTitle(day)}
                      className={cn('size-[11px] rounded-[2px]', LEVEL_CLASS[level(day.count)])}
                      data-level={level(day.count)}
                    />
                  ) : (
                    <span key={`empty-${j}`} className="size-[11px]" />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-subtle-foreground">
        <span className="mr-auto">
          Commits, PRs opened, PRs merged and reviews per day. Weekends are shown but never scored.
          {importingBefore ? ' Hatched days are still importing.' : ''}
        </span>
        <span className="flex items-center gap-1" aria-hidden="true">
          Less
          {LEVEL_CLASS.map((cls) => (
            <span key={cls} className={cn('size-[11px] rounded-[2px]', cls)} />
          ))}
          More
        </span>
      </div>
    </ChartCard>
  );
});
