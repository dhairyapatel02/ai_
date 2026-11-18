import { MeDto } from '@devimpact/shared';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/shell/app-shell';
import { isApiError } from '@/lib/api/errors';
import { makeQueryClient } from '@/lib/api/query-client';
import { qk } from '@/lib/api/query-keys';
import { getServerApi } from '@/lib/api/server';

import type { ReactNode } from 'react';

/**
 * Signed-in shell. `/me` is prefetched on the server and hydrated into TanStack Query, so the
 * shell (name, time zone, default period) renders without a client waterfall (PERF-04). A stale
 * session cookie (the API rejects the token) goes straight to /sign-in; an unreachable API does
 * not block rendering — the pages show their designed error states.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const queryClient = makeQueryClient();
  try {
    const api = await getServerApi();
    const me = await api.get('/me', { schema: MeDto });
    queryClient.setQueryData(qk.me.detail(), me);
  } catch (error) {
    if (isApiError(error) && error.code === 'UNAUTHENTICATED') redirect('/sign-in');
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AppShell>{children}</AppShell>
    </HydrationBoundary>
  );
}
