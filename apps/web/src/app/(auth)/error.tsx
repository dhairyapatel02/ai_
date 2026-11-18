'use client';

import { ErrorState } from '@/components/states';

export default function AuthError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <ErrorState
        error={error}
        headingLevel={1}
        title="Something went wrong on our side"
        what="the sign-in page"
        onRetry={retry}
      />
    </main>
  );
}
