'use client';

import { authClient, clearApiToken } from '@/lib/auth-client';

import type { QueryClient } from '@tanstack/react-query';


/** Ends the Better Auth session, drops the in-memory JWT and all cached data, then /sign-in. */
export async function signOut(queryClient: QueryClient): Promise<void> {
  clearApiToken();
  try {
    await authClient.signOut();
  } finally {
    queryClient.clear();
    // Full navigation: nothing from the previous session survives in memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/sign-in');
  }
}
