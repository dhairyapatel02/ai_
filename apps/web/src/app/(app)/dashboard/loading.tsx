import { PageHeader } from '@/components/states';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Dashboard skeleton (S6 Loading): the same blocks and heights as the page (measured at 1440 and
 * 390 px), so streaming the page in causes no layout shift.
 */
export default function DashboardLoading() {
  return (
    <div aria-busy="true">
      <PageHeader
        title="Dashboard"
        lede={<Skeleton className="h-5 w-64 max-w-full" />}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Skeleton className="h-8 w-full sm:w-40" />
            <Skeleton className="h-8 w-full sm:w-36" />
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[122px] rounded-md lg:h-[128px]" />
            ))}
          </div>
          <div className="h-4 md:hidden" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Skeleton className="h-[405px] rounded-md" />
          <Skeleton className="h-[374px] rounded-md lg:h-[405px]" />
        </div>
        <Skeleton className="h-[288px] rounded-md lg:h-[252px]" />
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Skeleton className="h-[460px] rounded-md lg:h-[472px]" />
          <Skeleton className="h-[472px] rounded-md" />
        </div>
      </div>
      <p className="sr-only" role="status">
        Loading your dashboard…
      </p>
    </div>
  );
}
