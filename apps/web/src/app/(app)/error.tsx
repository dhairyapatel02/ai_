'use client';

import Link from 'next/link';

import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';

/** Route error boundary inside the shell (SCREENS S25 500): navigation keeps working. */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorState
      error={error}
      headingLevel={1}
      title="Something went wrong on our side"
      what="this page"
      onRetry={retry}
      secondary={
        <Button variant="secondary" asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      }
    />
  );
}
