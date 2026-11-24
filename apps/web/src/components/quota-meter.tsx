import { Progress } from '@/components/ui/progress';
import { resetDate } from '@/lib/documents';
import { cn } from '@/lib/utils';

/**
 * QuotaMeter (DESIGN_SYSTEM §5.2): label, used of limit, bar, reset date. Values come from
 * `GET /me/usage`; the bar is a real progressbar with its own accessible name.
 */
export function QuotaMeter({
  label,
  used,
  limit,
  resetsAt,
  note,
  compact = false,
  className,
}: {
  label: string;
  used: number;
  limit: number;
  resetsAt?: string | null;
  note?: string;
  compact?: boolean;
  className?: string;
}) {
  const shown = Math.min(used, limit);
  const percent = limit > 0 ? Math.round((shown / limit) * 100) : 0;
  const full = limit > 0 && used >= limit;
  return (
    <div className={cn('flex flex-col gap-1.5', compact ? 'min-w-48' : '', className)}>
      <div className="flex items-baseline justify-between gap-3 text-base">
        <span className="font-medium">{label}</span>
        <span className={cn('tabular-nums', full ? 'text-warning' : 'text-muted-foreground')}>
          {used} of {limit}
        </span>
      </div>
      <Progress value={percent} aria-label={`${label}: ${used} of ${limit} used`} />
      {resetsAt || note ? (
        <span className="text-caption text-subtle-foreground">
          {[note, resetsAt ? `Resets ${resetDate(resetsAt)} (UTC)` : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
      ) : null}
    </div>
  );
}
