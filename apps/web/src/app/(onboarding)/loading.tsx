import { Skeleton } from '@/components/ui/skeleton';

export default function OnboardingLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-1" />
        ))}
      </div>
      <Skeleton className="mt-6 h-8 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-48 w-full" />
      <p className="sr-only" role="status">
        Loading…
      </p>
    </div>
  );
}
