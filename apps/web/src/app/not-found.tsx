import { getSessionCookie } from 'better-auth/cookies';
import { headers } from 'next/headers';

import { Wordmark } from '@/components/brand';
import { NotFoundState } from '@/components/not-found-state';
import { AppShell } from '@/components/shell/app-shell';

export const metadata = { title: 'Page not found' };

/** Unknown URL (SCREENS S25): inside the shell when signed in, standalone otherwise. */
export default async function NotFound() {
  const signedIn = Boolean(getSessionCookie(await headers()));
  if (signedIn) {
    return (
      <AppShell title="Page not found">
        <NotFoundState />
      </AppShell>
    );
  }
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-8">
      <Wordmark href="/sign-in" />
      <NotFoundState />
    </main>
  );
}
