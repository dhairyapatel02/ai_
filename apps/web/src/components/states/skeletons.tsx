import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Visually hidden live status so screen readers hear that content is loading (UX-07). */
function LoadingStatus({ label }: { label: string }) {
  return (
    <p className="sr-only" role="status">
      {label}
    </p>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <Skeleton className="h-3.5 w-2/5" />
      <Skeleton className="h-7 w-1/2" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}

export function CardSkeleton({ height = 180, className }: { height?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-md border bg-card p-4', className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="w-full" style={{ height }} />
    </div>
  );
}

export function ListSkeleton({ rows = 6, label = 'Loading…' }: { rows?: number; label?: string }) {
  return (
    <div className="rounded-md border bg-card" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
          <Skeleton className="size-7 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
      <LoadingStatus label={label} />
    </div>
  );
}

/** Route-level skeleton mirroring an Overview page: 4 stat cards, two panels, one wide block. */
export function PageSkeleton({
  kind = 'dashboard',
  label = 'Loading your data…',
}: {
  kind?: 'dashboard' | 'list' | 'form';
  label?: string;
}) {
  if (kind === 'list') return <ListSkeleton label={label} />;
  if (kind === 'form') {
    return (
      <div className="flex max-w-(--reading-max) flex-col gap-4" aria-busy="true">
        <Skeleton className="h-7 w-1/3" />
        <CardSkeleton height={120} />
        <CardSkeleton height={80} />
        <LoadingStatus label={label} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <CardSkeleton height={90} />
      <LoadingStatus label={label} />
    </div>
  );
}
