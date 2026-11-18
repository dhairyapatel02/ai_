'use client';

import Link from 'next/link';

import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';

export default function OnboardingError({
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
      what="setup"
      onRetry={retry}
      secondary={
        <Button variant="secondary" asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      }
    />
  );
}
