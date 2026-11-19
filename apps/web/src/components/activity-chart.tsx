'use client';

import dynamic from 'next/dynamic';
import { memo } from 'react';

import { ChartTable } from '@/components/charts/chart-table';
import { ChartCard } from '@/components/states/chart-card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ACTIVITY_SERIES,
  activityAriaSummary,
  activityTotals,
  type ActivityRow,
  type ChartInterval,
} from '@/lib/charts';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

// Recharts is loaded per route on demand; the reserved height prevents layout shift.
const ActivityPlot = dynamic(() => import('@/components/charts/activity-plot'), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

export function SeriesLegend() {
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground"
      aria-label="Legend"
    >
      {ACTIVITY_SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-[2px]"
            style={{ background: s.color }}
            aria-hidden="true"
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * ActivityChart (DESIGN_SYSTEM §5.2): stacked columns of commits, PRs merged and reviews with a
 * legend above, hover tooltip, `aria-label` summary and "View as table". `empty` replaces the plot
 * with an empty-plot message (no zero-height chart).
 */
export const ActivityChart = memo(function ActivityChart({
  rows,
  interval,
  periodLabel,
  height = 220,
  fetching = false,
  empty,
  className,
  actions,
}: {
  rows: ActivityRow[];
  interval: ChartInterval;
  periodLabel: string;
  height?: number;
  fetching?: boolean;
  empty?: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  const totals = activityTotals(rows);
  const isEmpty = totals.commits + totals.prsMerged + totals.reviews === 0;
  return (
    <ChartCard
      title={`Activity · ${periodLabel}`}
      description={`By ${interval}`}
      className={className}
      actions={actions}
      table={
        <ChartTable
          caption={`Activity by ${interval}, ${periodLabel}`}
          headers={[interval === 'day' ? 'Date' : 'Period', 'Commits', 'PRs merged', 'Reviews']}
          rows={rows.map((r) => ({
            key: r.start,
            cells: [
              r.label,
              formatCount(r.commits),
              formatCount(r.prsMerged),
              formatCount(r.reviews),
            ],
          }))}
        />
      }
    >
      <div className={cn('flex flex-col gap-3 transition-opacity', fetching && 'opacity-60')}>
        <SeriesLegend />
        {isEmpty && empty ? (
          <div
            className="flex items-center justify-center rounded-md border border-dashed text-center text-muted-foreground"
            style={{ height }}
          >
            {empty}
          </div>
        ) : (
          <div
            role="img"
            aria-label={activityAriaSummary(rows, interval, periodLabel)}
            style={{ height }}
            data-testid="activity-chart"
          >
            <ActivityPlot rows={rows} height={height} />
          </div>
        )}
      </div>
    </ChartCard>
  );
});
