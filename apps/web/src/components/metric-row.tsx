'use client';

import { Info } from 'lucide-react';

import { Sparkline } from '@/components/sparkline';
import { DeltaText } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { formatUnitValue } from '@/lib/charts';
import { cn } from '@/lib/utils';

import type { MetricDefinition, MetricValue } from '@devimpact/shared';

/** "Low sample" when n is within 3 of the minimum (S8 Partial). */
export function isLowSample(value: Pick<MetricValue, 'status' | 'n'>, minN: number): boolean {
  return value.status === 'ok' && minN > 0 && value.n < minN + 3;
}

/**
 * MetricRow (DESIGN_SYSTEM §5.2, S8): name + Scored / Low sample badges, definition, value + n,
 * descriptive delta, 6-period sparkline and the explain button. Insufficient data reads
 * "Not enough data · n = 2 of 3 needed" — never 0.
 */
export function MetricRow({
  value,
  definition,
  trend,
  comparison,
  onExplain,
}: {
  value: MetricValue;
  definition: MetricDefinition | undefined;
  trend: (number | null)[] | undefined;
  comparison: string;
  onExplain: () => void;
}) {
  const minN = definition?.minN ?? 0;
  const insufficient = value.status !== 'ok' || value.value === null;
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-1 border-b px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_9rem_12rem_6rem_auto]"
      data-testid={`metric-${value.key}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{value.label}</span>
          {value.inScore ? <Badge variant="outline">Scored</Badge> : null}
          {isLowSample(value, minN) ? <Badge variant="warning">Low sample</Badge> : null}
        </div>
        {definition ? (
          <p className="hidden text-sm text-muted-foreground md:block">{definition.definition}</p>
        ) : null}
      </div>
      <div className="text-right md:text-left">
        {insufficient ? (
          <>
            <span className="text-sm font-medium text-subtle-foreground">Not enough data</span>
            <p className="text-caption text-subtle-foreground">
              n = {value.n}
              {minN ? ` of ${minN} needed` : ''}
            </p>
          </>
        ) : (
          <>
            <span className="text-lg font-semibold" data-testid={`metric-value-${value.key}`}>
              {formatUnitValue(value.value, value.unit)}
            </span>
            {minN ? <p className="text-caption text-subtle-foreground">n = {value.n}</p> : null}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onExplain}
        aria-label={`Explain ${value.label}`}
        className="row-span-1 inline-flex size-7 cursor-pointer items-center justify-center justify-self-end rounded-sm text-subtle-foreground hover:bg-surface-2 hover:text-foreground md:order-last"
      >
        <Info className="size-4" aria-hidden="true" />
      </button>
      <div className={cn('col-span-2 md:col-span-1', insufficient && 'max-md:hidden')}>
        {insufficient ? null : (
          <DeltaText delta={value.delta} unit={value.unit} comparison={comparison} />
        )}
      </div>
      <div className="flex justify-end md:justify-start" title="Last 6 periods">
        <Sparkline values={trend ?? []} />
      </div>
    </li>
  );
}
