import {
  HeatmapResponse,
  ImpactDto,
  OverviewResponse,
  PERIOD_SPEC_PATTERN,
} from '@devimpact/shared';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';

import { makeQueryClient } from '@/lib/api/query-client';
import { qk } from '@/lib/api/query-keys';
import { getServerApi } from '@/lib/api/server';

import { DashboardView } from './dashboard-view';

export const metadata = { title: 'Dashboard' };

/**
 * Dashboard (S6). The first-paint queries (overview, impact, 12-month heatmap) are fetched on the
 * server in parallel and hydrated, so the cards, impact card and charts render without a client
 * waterfall. Failures are left to the client, which shows the designed per-widget error states.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { period: raw } = await searchParams;
  const period = typeof raw === 'string' && PERIOD_SPEC_PATTERN.test(raw) ? raw : undefined;
  const invalid = typeof raw === 'string' && period === undefined;
  const queryClient = makeQueryClient();
  if (!invalid) {
    try {
      const api = await getServerApi();
      const [overview, impact, heatmap] = await Promise.allSettled([
        api.get('/metrics/overview', { schema: OverviewResponse, query: { period } }),
        api.get('/impact', { schema: ImpactDto, query: { period } }),
        api.get('/metrics/heatmap', { schema: HeatmapResponse }),
      ]);
      if (overview.status === 'fulfilled')
        queryClient.setQueryData(qk.metrics.overview(period), overview.value);
      if (impact.status === 'fulfilled')
        queryClient.setQueryData(qk.impact.detail(period), impact.value);
      if (heatmap.status === 'fulfilled')
        queryClient.setQueryData(qk.metrics.heatmap(), heatmap.value);
    } catch {
      // No session or API unreachable: the client renders the designed states.
    }
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DashboardView />
    </HydrationBoundary>
  );
}
