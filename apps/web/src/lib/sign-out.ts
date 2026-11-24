'use client';

import { authClient, clearApiToken } from '@/lib/auth-client';

import type { QueryClient } from '@tanstack/react-query';

/** Ends the Better Auth session, drops the in-memory JWT and all cached data, then /sign-in. */
export async function signOut(
  queryClient: QueryClient,
  options: { reason?: 'account_deleted' } = {},
): Promise<void> {
  clearApiToken();
  try {
    await authClient.signOut();
  } finally {
    queryClient.clear();
    // Full navigation: nothing from the previous session survives in memory.

    window.location.assign(options.reason ? `/sign-in?reason=${options.reason}` : '/sign-in');
  }
}
