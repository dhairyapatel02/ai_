import { DocumentDetail, DocumentVersionListItem } from '@devimpact/shared';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';

import { makeQueryClient } from '@/lib/api/query-client';
import { qk } from '@/lib/api/query-keys';
import { getServerApi } from '@/lib/api/server';

import { DocumentView } from './document-view';

export const metadata = { title: 'Document' };

const ID = /^[a-z0-9]{20,40}$/;

/**
 * Document viewer / editor (S16). The current version and the version list are fetched on the
 * server in parallel and hydrated, so the document's first paint has no client waterfall. Errors
 * (404 → "This document was deleted") are left to the client's designed states.
 */
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const queryClient = makeQueryClient();
  if (ID.test(id)) {
    try {
      const api = await getServerApi();
      const [detail, versions] = await Promise.allSettled([
        api.get(`/documents/${id}`, { schema: DocumentDetail }),
        api.getPage(`/documents/${id}/versions`, {
          schema: DocumentVersionListItem,
          query: { limit: 50 },
        }),
      ]);
      if (detail.status === 'fulfilled')
        queryClient.setQueryData(qk.documents.detail(id), detail.value);
      if (versions.status === 'fulfilled')
        queryClient.setQueryData(qk.documents.versions(id), versions.value);
    } catch {
      // No session or API unreachable: the client renders the designed states.
    }
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DocumentView id={id} />
    </HydrationBoundary>
  );
}
