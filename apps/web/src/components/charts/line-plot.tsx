'use client';

import { CartesianGrid, LabelList, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartContainer } from '@/components/ui/chart';
import type { LinePoint } from '@/lib/charts';

import { ChartTooltipBox } from './chart-tooltip';

/**
 * Impact score history (DESIGN_SYSTEM §6): single 2 px line, fixed 0–100 axis with ticks at the
 * band edges 40/60/80, gaps for months without enough data, r = 4 markers with a 2 px surface
 * ring and a direct label on the latest value only.
 */
export default function LinePlot({
  points,
  seriesLabel,
  height,
}: {
  points: LinePoint[];
  seriesLabel: string;
  height: number;
}) {
  const lastIndex = points.reduce((acc, p, i) => (p.value !== null ? i : acc), -1);
  return (
    <ChartContainer config={{}} className="aspect-auto w-full" style={{ height }}>
      <LineChart
        data={points}
        margin={{ top: 12, right: 32, bottom: 0, left: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="short"
          tickLine={false}
          axisLine={{ stroke: 'var(--chart-axis)' }}
          tick={{ fill: 'var(--subtle-foreground)', fontSize: 12 }}
          minTickGap={16}
          interval="preserveStartEnd"
        />
        <YAxis
          width={32}
          domain={[0, 100]}
          ticks={[0, 40, 60, 80, 100]}
          tickLine={false}
          axisLine={false}
          tick={{ fill: 'var(--subtle-foreground)', fontSize: 12 }}
        />
        <Tooltip
          cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const p = payload?.[0]?.payload as LinePoint | undefined;
            if (!active || !p) return null;
            return (
              <ChartTooltipBox
                title={p.label}
                rows={[
                  {
                    label: seriesLabel,
                    value: p.value === null ? 'Not enough data' : String(p.value),
                  },
                  ...(p.note ? [{ label: p.note, value: '' }] : []),
                ]}
              />
            );
          }}
        />
        <Line
          type="linear"
          dataKey="value"
          stroke="var(--chart-5)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          connectNulls={false}
          isAnimationActive={false}
          dot={{ r: 4, fill: 'var(--chart-5)', stroke: 'var(--card)', strokeWidth: 2 }}
          activeDot={{ r: 5, fill: 'var(--chart-5)', stroke: 'var(--card)', strokeWidth: 2 }}
        >
          <LabelList
            dataKey="value"
            content={({ x, y, value, index }) =>
              index === lastIndex && value !== null && value !== undefined ? (
                <text
                  x={Number(x) + 9}
                  y={Number(y) + 4}
                  fontSize={12}
                  fontWeight={600}
                  fill="var(--foreground)"
                >
                  {String(value)}
                </text>
              ) : null
            }
          />
        </Line>
      </LineChart>
    </ChartContainer>
  );
}
