import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { DeltaText, type DeltaUnit } from './delta-text';
import { InfoPopover } from './info-popover';

import type { ReactNode } from 'react';

/**
 * Dashboard stat tile (DESIGN_SYSTEM §5.2): label + info button, value, descriptive delta.
 * States: `loading`, `insufficient` ("Not enough data", never 0), `ok` (with or without delta).
 */
export function StatCard({
  label,
  value,
  delta,
  unit = 'count',
  comparison,
  info,
  state = 'ok',
  insufficientNote,
  testId,
  className,
  icon,
  compactComparison = false,
}: {
  icon?: ReactNode;
  /** Hide the comparison label below 768 px (one shared caption instead, S6 M). */
  compactComparison?: boolean;
  label: string;
  value: ReactNode;
  delta?: number | null;
  unit?: DeltaUnit;
  comparison?: string;
  info?: ReactNode;
  state?: 'loading' | 'insufficient' | 'ok';
  insufficientNote?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5 rounded-md border bg-card p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium text-muted-foreground">
          {icon}
          {label}
        </span>
        {info ? <InfoPopover label={`How is ${label} calculated?`}>{info}</InfoPopover> : null}
      </div>
      {state === 'loading' ? (
        <>
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <span className="sr-only">Loading {label}</span>
        </>
      ) : state === 'insufficient' ? (
        <>
          <span className="text-xl font-semibold text-subtle-foreground" data-testid={testId}>
            —
          </span>
          <span className="text-caption text-subtle-foreground">
            {insufficientNote ?? 'Not enough data'}
          </span>
        </>
      ) : (
        <>
          <span className="text-xl font-semibold tracking-tight md:text-2xl" data-testid={testId}>
            {value}
          </span>
          {delta !== undefined ? (
            <DeltaText
              delta={delta}
              unit={unit}
              comparison={comparison}
              comparisonClassName={compactComparison ? 'max-md:sr-only' : undefined}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
