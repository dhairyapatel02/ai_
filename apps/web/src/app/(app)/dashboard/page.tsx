import {
  DocumentSummary,
  FeedItem,
  HeatmapResponse,
  ImpactDto,
  IntegrationDto,
  OverviewResponse,
  PERIOD_SPEC_PATTERN,
  SyncStatusDto,
} from '@devimpact/shared';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { z } from 'zod';

import { isApiError } from '@/lib/api/errors';
import { makeQueryClient } from '@/lib/api/query-client';
import { qk } from '@/lib/api/query-keys';
import { getServerApi } from '@/lib/api/server';
import { DASHBOARD_FEED } from '@/lib/dashboard';

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
      const page = <T,>(
        path: string,
        schema: z.ZodType<T>,
        query: Record<string, string | number>,
      ) => api.getPage(path, { schema, query });
      const [overview, impact, heatmap, sync, integrations, feed, appraisals, resumes] =
        await Promise.allSettled([
          api.get('/metrics/overview', { schema: OverviewResponse, query: { period } }),
          api.get('/impact', { schema: ImpactDto, query: { period } }),
          api.get('/metrics/heatmap', { schema: HeatmapResponse }),
          api.get('/sync/status', { schema: SyncStatusDto }),
          api.get('/integrations', { schema: z.array(IntegrationDto) }),
          page('/activity/feed', FeedItem, {
            types: DASHBOARD_FEED.types.join(','),
            limit: DASHBOARD_FEED.limit,
          }),
          page('/documents', DocumentSummary, { type: 'appraisal', limit: 20, sort: '-createdAt' }),
          page('/documents', DocumentSummary, { type: 'resume', limit: 1, sort: '-createdAt' }),
        ]);
      const set = (key: readonly unknown[], result: PromiseSettledResult<unknown>) => {
        if (result.status === 'fulfilled') queryClient.setQueryData(key, result.value);
      };
      set(qk.metrics.overview(period), overview);
      set(qk.impact.detail(period), impact);
      set(qk.metrics.heatmap(), heatmap);
      set(qk.integrations.list(), integrations);
      set(qk.documents.list({ type: 'appraisal', limit: 20 }), appraisals);
      set(qk.documents.list({ type: 'resume', limit: 1 }), resumes);
      // `useSyncStatus` maps 404 (not connected) to null.
      if (sync.status === 'fulfilled') queryClient.setQueryData(qk.sync.status(), sync.value);
      else if (isApiError(sync.reason) && sync.reason.code === 'NOT_FOUND') {
        queryClient.setQueryData(qk.sync.status(), null);
      }
      if (feed.status === 'fulfilled') {
        queryClient.setQueryData(
          qk.activity.feed({ types: DASHBOARD_FEED.types.join(','), limit: DASHBOARD_FEED.limit }),
          { pages: [feed.value], pageParams: [undefined] },
        );
      }
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
