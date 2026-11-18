'use client';

import dynamic from 'next/dynamic';
import { useId, useState } from 'react';

import { ChartTable } from '@/components/charts/chart-table';
import { Skeleton } from '@/components/ui/skeleton';
import { columnsAriaSummary, formatUnitValue, type ColumnPoint } from '@/lib/charts';

const ColumnPlot = dynamic(() => import('@/components/charts/column-plot'), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

/** Explain drawer chart: 6 months of one metric as columns + table toggle (FLOWS F9 D4). */
export function MetricColumnChart({
  points,
  unit,
  metricLabel,
  height = 160,
}: {
  points: ColumnPoint[];
  unit: string;
  metricLabel: string;
  height?: number;
}) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={columnsAriaSummary(points, metricLabel, unit)} style={{ height }}>
        <ColumnPlot points={points} unit={unit} seriesLabel={metricLabel} height={height} />
      </div>
      <button
        type="button"
        className="self-start text-sm text-link underline underline-offset-2"
        aria-expanded={showTable}
        aria-controls={tableId}
        onClick={() => {
          setShowTable((v) => !v);
        }}
      >
        {showTable ? 'Hide table' : 'View as table'}
      </button>
      <div id={tableId} hidden={!showTable}>
        {showTable ? (
          <ChartTable
            caption={`${metricLabel} per month`}
            headers={['Month', metricLabel, 'n']}
            rows={points.map((p) => ({
              key: p.label,
              cells: [
                p.label,
                p.value === null ? 'Not enough data' : formatUnitValue(p.value, unit),
                String(p.n),
              ],
            }))}
          />
        ) : null}
      </div>
    </div>
  );
}
