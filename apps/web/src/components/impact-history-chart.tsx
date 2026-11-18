'use client';

import dynamic from 'next/dynamic';

import { ChartTable } from '@/components/charts/chart-table';
import { ChartCard } from '@/components/states/chart-card';
import { Skeleton } from '@/components/ui/skeleton';
import { lineAriaSummary, type LinePoint } from '@/lib/charts';

const LinePlot = dynamic(() => import('@/components/charts/line-plot'), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

/** S9 History: impact score per month (0–100, band ticks, gaps) + table toggle. */
export function ImpactHistoryChart({
  points,
  height = 220,
  title = 'History',
  description,
}: {
  points: LinePoint[];
  height?: number;
  title?: string;
  description?: string;
}) {
  return (
    <ChartCard
      title={title}
      description={description}
      table={
        <ChartTable
          caption="Impact score per month"
          headers={['Month', 'Impact score', 'Note']}
          rows={points.map((p) => ({
            key: p.label,
            cells: [p.label, p.value === null ? 'Not enough data' : String(p.value), p.note ?? ''],
          }))}
        />
      }
    >
      <div
        role="img"
        aria-label={lineAriaSummary(points, 'impact score')}
        style={{ height }}
        data-testid="impact-history-chart"
      >
        <LinePlot points={points} seriesLabel="Impact score" height={height} />
      </div>
    </ChartCard>
  );
}
