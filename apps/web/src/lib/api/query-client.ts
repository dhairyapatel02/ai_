import { QueryClient } from '@tanstack/react-query';

import { isApiError } from './errors';

const MAX_RETRIES = 2;

/**
 * TanStack Query defaults (ADR-0010): 30 s `staleTime`; queries (GETs, idempotent) retry up to 2×
 * on network errors and 5xx only — never on 4xx; mutations never retry.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) =>
          failureCount < MAX_RETRIES && (!isApiError(error) || error.retryable),
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: { retry: false },
    },
  });
}

let browserClient: QueryClient | undefined;

/** One client per browser tab; a fresh one per server render (no cross-request sharing). */
export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient();
  browserClient ??= makeQueryClient();
  return browserClient;
}
