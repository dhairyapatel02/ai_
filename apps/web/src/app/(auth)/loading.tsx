import { Skeleton } from '@/components/ui/skeleton';

export default function AuthLoading() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4" aria-busy="true">
      <div className="flex w-full max-w-[400px] flex-col gap-4 rounded-lg border bg-card p-8">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <p className="sr-only" role="status">
          Loading…
        </p>
      </div>
    </main>
  );
}
