import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';

/** `count` · `hours` · `ratio` (shown in points) · `score` · any other metric unit (plain number). */
export type DeltaUnit = string;

/** Amount without sign: `3`, `1.5 h`, `9 pts` (ratios are percentage points). */
export function formatDeltaAmount(delta: number, unit: DeltaUnit): string {
  const abs = Math.abs(delta);
  if (unit === 'ratio') return `${Math.round(abs * 100)} pts`;
  if (unit === 'hours') return `${abs.toFixed(1)} h`;
  if (unit === 'score') return `${Math.round(abs)} pts`;
  return (Math.round(abs * 10) / 10).toLocaleString('en-US');
}

/**
 * Descriptive change (DESIGN_SYSTEM §5.2): neutral ink + arrow, a visually hidden "up"/"down",
 * bold amount and the comparison label. Never red/green — a drop in commits is not "bad".
 */
export function DeltaText({
  delta,
  unit = 'count',
  comparison,
  className,
  comparisonClassName,
}: {
  delta: number | null | undefined;
  unit?: DeltaUnit;
  comparison?: string;
  className?: string;
  /** e.g. `max-md:sr-only`: phones show arrow + amount and one shared caption (S6 M). */
  comparisonClassName?: string;
}) {
  if (delta === null || delta === undefined) {
    return (
      <span className={cn('text-caption text-subtle-foreground', className)}>No comparison</span>
    );
  }
  const Icon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'no change';
  return (
    <span
      className={cn(
        'inline-flex flex-wrap items-center gap-1 text-caption text-muted-foreground',
        className,
      )}
    >
      <Icon className="size-3.5 text-foreground" aria-hidden="true" />
      <span className="sr-only">{direction}</span>
      {delta !== 0 ? (
        <b className="font-semibold text-foreground tabular-nums">
          {formatDeltaAmount(delta, unit)}
        </b>
      ) : (
        <span className="text-foreground">No change</span>
      )}
      {comparison ? <span className={comparisonClassName}>{comparison}</span> : null}
    </span>
  );
}
