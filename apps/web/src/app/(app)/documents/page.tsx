import { DocumentSummary, UsageResponse } from '@devimpact/shared';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';

import { makeQueryClient } from '@/lib/api/query-client';
import { qk } from '@/lib/api/query-keys';
import { getServerApi } from '@/lib/api/server';

import { DocumentsView } from './documents-view';

export const metadata = { title: 'Documents' };

const TYPES = new Set(['resume', 'appraisal', 'promotion']);
const SORTS = new Set(['-updatedAt', '-createdAt', 'title']);

/**
 * Documents library (S11). The first page for the URL's filters and the usage meter are fetched
 * on the server in parallel and hydrated (no client waterfall behind `/me`).
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const type = TYPES.has(str(sp.type) ?? '') ? str(sp.type) : undefined;
  const q = str(sp.q)?.trim().slice(0, 100) || undefined;
  const sort = SORTS.has(str(sp.sort) ?? '') ? str(sp.sort) : '-updatedAt';
  const queryClient = makeQueryClient();
  try {
    const api = await getServerApi();
    const [page, usage] = await Promise.allSettled([
      api.getPage('/documents', {
        schema: DocumentSummary,
        query: { type, q, sort, limit: 20 },
      }),
      api.get('/me/usage', { schema: UsageResponse }),
    ]);
    if (page.status === 'fulfilled') {
      queryClient.setQueryData(qk.documents.library({ type, q, sort }), {
        pages: [page.value],
        pageParams: [undefined],
      });
    }
    if (usage.status === 'fulfilled') queryClient.setQueryData(qk.usage.month(), usage.value);
  } catch {
    // No session or API unreachable: the client renders the designed states.
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DocumentsView />
    </HydrationBoundary>
  );
}
