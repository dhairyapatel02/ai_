'use client';

import { ErrorState } from '@/components/states';

export default function SystemError({
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
    />
  );
}
