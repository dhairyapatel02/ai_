'use client';

import type { QueryClient } from '@tanstack/react-query';

import { authClient, clearApiToken } from '@/lib/auth-client';

/** Ends the Better Auth session, drops the in-memory JWT and all cached data, then /sign-in. */
export async function signOut(queryClient: QueryClient): Promise<void> {
  clearApiToken();
  try {
    await authClient.signOut();
  } finally {
    queryClient.clear();
    // Full navigation: nothing from the previous session survives in memory.
    window.location.assign('/sign-in');
  }
}
