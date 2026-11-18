'use client';

import { useEffect, useMemo, useRef } from 'react';

import { ChartCard } from '@/components/states/chart-card';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { HeatmapResponse } from '@devimpact/shared';

type Day = Pick<HeatmapResponse['days'][number], 'date' | 'count'>;

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

function monthlyTotals(days: Day[]) {
  const totals = new Map<string, number>();
  for (const d of days)
    totals.set(d.date.slice(0, 7), (totals.get(d.date.slice(0, 7)) ?? 0) + d.count);
  return [...totals.entries()].map(([month, total]) => ({
    month,
    label: `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`,
    total,
  }));
}

/**
 * 12-month contribution heatmap (DESIGN_SYSTEM §5.2 ActivityHeatmap): 53 × 7 grid of 11 px cells,
 * 5 levels by quartile of active days, month labels, a tooltip per cell (`title`, supplementary),
 * scrolled to the newest week on small screens, and a "View as table" of monthly totals.
 */
export function ActivityHeatmap({
  days,
  title = 'Contributions',
  className,
}: {
  days: Day[];
  title?: string;
  className?: string;
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
      description="Weekends are shown but never scored."
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
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-b last:border-b-0">
                <td className="py-1.5">{m.label}</td>
                <td className="py-1.5 text-right tabular-nums">{formatCount(m.total)}</td>
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
                  day ? (
                    <span
                      key={day.date}
                      title={`${day.date}: ${day.count} contribution${day.count === 1 ? '' : 's'}`}
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
      <div
        className="mt-2 flex items-center justify-end gap-1 text-caption text-subtle-foreground"
        aria-hidden="true"
      >
        Less
        {LEVEL_CLASS.map((cls) => (
          <span key={cls} className={cn('size-[11px] rounded-[2px]', cls)} />
        ))}
        More
      </div>
    </ChartCard>
  );
}
