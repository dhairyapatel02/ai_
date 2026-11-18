'use client';

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import { ACTIVITY_SERIES, formatAxis, niceTicks, type ActivityRow } from '@/lib/charts';
import { formatCount } from '@/lib/format';

import { ChartTooltipBox } from './chart-tooltip';

const CONFIG: ChartConfig = Object.fromEntries(
  ACTIVITY_SERIES.map((s) => [s.key, { label: s.label, color: s.color }]),
);

interface SegmentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: ActivityRow;
}

/**
 * Stacked segment (dataviz mark specs): ≤ 24 px wide, 4 px rounded data-end on the top segment
 * only (square at the baseline), and a 2 px surface gap between stacked segments.
 */
function segment(seriesIndex: number) {
  return function Segment({ x = 0, y = 0, width = 0, height = 0, fill, payload }: SegmentProps) {
    if (!payload || height <= 0) return null;
    const values = ACTIVITY_SERIES.map((s) => payload[s.key]);
    const isTop = values.slice(seriesIndex + 1).every((v) => v <= 0);
    const hasBelow = values.slice(0, seriesIndex).some((v) => v > 0);
    const h = Math.max(0, height - (hasBelow ? 2 : 0));
    if (h <= 0) return null;
    const r = isTop ? Math.min(4, width / 2, h) : 0;
    if (!r) return <rect x={x} y={y} width={width} height={h} fill={fill} />;
    return (
      <path
        d={`M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + h} Z`}
        fill={fill}
      />
    );
  };
}
const SEGMENTS = ACTIVITY_SERIES.map((_, i) => segment(i));

/** Recharts plot behind `ActivityChart` (loaded with `next/dynamic`, so charts stay out of the main bundle). */
export default function ActivityPlot({ rows, height }: { rows: ActivityRow[]; height: number }) {
  const max = Math.max(1, ...rows.map((r) => r.commits + r.prsMerged + r.reviews));
  const ticks = niceTicks(max);
  return (
    <ChartContainer config={CONFIG} className="aspect-auto w-full" style={{ height }}>
      <BarChart
        data={rows}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="short"
          tickLine={false}
          axisLine={{ stroke: 'var(--chart-axis)' }}
          tick={{ fill: 'var(--subtle-foreground)', fontSize: 12 }}
          minTickGap={24}
          interval="preserveStartEnd"
        />
        <YAxis
          width={36}
          ticks={ticks}
          domain={[0, ticks[2] ?? 4]}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tick={{ fill: 'var(--subtle-foreground)', fontSize: 12 }}
          tickFormatter={formatAxis}
        />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)' }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as ActivityRow | undefined;
            if (!active || !row) return null;
            return (
              <ChartTooltipBox
                title={row.label}
                rows={ACTIVITY_SERIES.map((s) => ({
                  label: s.label,
                  value: formatCount(row[s.key]),
                  color: s.color,
                }))}
                total={formatCount(row.commits + row.prsMerged + row.reviews)}
              />
            );
          }}
        />
        {ACTIVITY_SERIES.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="a"
            fill={s.color}
            maxBarSize={24}
            isAnimationActive={false}
            shape={SEGMENTS[i]}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
