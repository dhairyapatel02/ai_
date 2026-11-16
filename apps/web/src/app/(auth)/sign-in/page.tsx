import { Trophy } from 'lucide-react';

import { getServerEnv, isDevLoginEnabled } from '@/env';

import { safeCallback } from './safe-callback';
import { SignInButtons } from './sign-in-buttons';

export const dynamic = 'force-dynamic';

/** Minimal, functional sign-in (P05). The designed screen (SCREENS S1) is built in P09. */
export default function SignInPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string; error?: string };
}) {
  const env = getServerEnv();
  const callbackUrl = safeCallback(searchParams.callbackUrl);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <Trophy className="h-6 w-6 text-primary" aria-hidden />
          <h1 className="text-xl font-semibold">Sign in to DevImpact AI</h1>
        </div>
        {searchParams.error ? (
          <p role="alert" className="text-sm text-destructive">
            Sign-in failed. Please try again.
          </p>
        ) : null}
        <SignInButtons
          callbackUrl={callbackUrl}
          github={Boolean(env.github)}
          google={Boolean(env.google)}
          devLogin={isDevLoginEnabled()}
        />
      </div>
    </main>
  );
}
