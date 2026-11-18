'use client';

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartContainer } from '@/components/ui/chart';
import { formatUnitValue, niceTicks, type ColumnPoint } from '@/lib/charts';

import { ChartTooltipBox } from './chart-tooltip';

/** Single-series columns (explain drawer, DESIGN_SYSTEM §6): accent `--chart-5`, 4 px data-end. */
export default function ColumnPlot({
  points,
  unit,
  seriesLabel,
  height,
}: {
  points: ColumnPoint[];
  unit: string;
  seriesLabel: string;
  height: number;
}) {
  const scale = unit === 'ratio' ? 100 : 1;
  const data = points.map((p) => ({ ...p, plotted: p.value === null ? null : p.value * scale }));
  const max = Math.max(unit === 'ratio' ? 100 : 1, ...data.map((p) => p.plotted ?? 0));
  const ticks = unit === 'ratio' ? [0, 50, 100] : niceTicks(max);
  return (
    <ChartContainer config={{}} className="aspect-auto w-full" style={{ height }}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="short"
          tickLine={false}
          axisLine={{ stroke: 'var(--chart-axis)' }}
          tick={{ fill: 'var(--subtle-foreground)', fontSize: 12 }}
        />
        <YAxis
          width={40}
          ticks={ticks}
          domain={[0, ticks[2] ?? 4]}
          tickLine={false}
          axisLine={false}
          tick={{ fill: 'var(--subtle-foreground)', fontSize: 12 }}
          tickFormatter={(v: number) => (unit === 'ratio' ? `${v}%` : String(v))}
        />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)' }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const p = payload?.[0]?.payload as ColumnPoint | undefined;
            if (!active || !p) return null;
            return (
              <ChartTooltipBox
                title={p.label}
                rows={[
                  {
                    label: seriesLabel,
                    value: p.value === null ? 'Not enough data' : formatUnitValue(p.value, unit),
                  },
                  { label: 'Sample', value: `n = ${p.n}` },
                ]}
              />
            );
          }}
        />
        <Bar
          dataKey="plotted"
          fill="var(--chart-5)"
          maxBarSize={24}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}
