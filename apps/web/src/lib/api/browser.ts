'use client';

import { publicEnv } from '@/env';
import { clearApiToken, getApiToken } from '@/lib/auth-client';

import { createApiClient } from './client';

let redirecting = false;

/** Same-origin path to return to after signing in again (no open redirect: path only). */
function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Browser API client: JWT from Better Auth (`/api/auth/token`, in memory, refreshed 60 s before
 * expiry). When a refreshed token is still rejected the session is gone → `/sign-in` with the
 * "Your session ended" notice (FLOWS F1).
 */
export const apiClient = createApiClient({
  baseUrl: publicEnv.NEXT_PUBLIC_API_URL,
  getToken: ({ forceRefresh }) => getApiToken({ forceRefresh }),
  onUnauthenticated: () => {
    clearApiToken();
    if (redirecting || typeof window === 'undefined') return;
    redirecting = true;
    const params = new URLSearchParams({ callbackUrl: currentPath(), reason: 'session_expired' });
    // Full reload on purpose: no state from the ended session may survive in memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/sign-in?${params.toString()}`);
  },
});

/**
 * Client for public endpoints (no session needed, e.g. `POST /notifications/unsubscribe` from an
 * email link): never sends a token and never redirects to sign-in.
 */
export const publicApiClient = createApiClient({
  baseUrl: publicEnv.NEXT_PUBLIC_API_URL,
  getToken: () => Promise.resolve(null),
});
