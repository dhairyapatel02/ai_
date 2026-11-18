'use client';

import {
  CreateDocumentResponse,
  DocumentDetail,
  type CreateDocumentInput,
} from '@devimpact/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api/browser';
import { ApiError, errorMessage, isApiError } from '@/lib/api/errors';
import { qk } from '@/lib/api/query-keys';

const POLL_MS = 1500;
const MAX_WAIT_MS = 3 * 60_000;

/** User-facing copy for generation errors (SCREENS S13–S16). */
export function generationErrorCopy(error: unknown): string {
  if (!isApiError(error)) return 'Generation failed. Try again in a minute.';
  switch (error.code) {
    case 'QUOTA_EXCEEDED':
      return errorMessage(error);
    case 'CONFLICT':
      return 'There is no activity in this period to write about. Pick another period.';
    case 'RATE_LIMITED':
      return errorMessage(error);
    case 'UPSTREAM_UNAVAILABLE':
      return 'The AI service is busy or not configured. Try again in a minute.';
    case 'GENERATION_IN_PROGRESS':
      return 'This document is still being written.';
    default:
      return error.message || 'Generation failed.';
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Interim generation for the v1 studio pages (P11 rebuilds them with `useEventStream`):
 * `POST /documents`, then poll `GET /documents/:id` until the worker finishes.
 */
export function useGenerateDocument() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (body: CreateDocumentInput): Promise<DocumentDetail> => {
      const created = await apiClient.post('/documents', { body, schema: CreateDocumentResponse });
      const id = created.document.id;
      const deadline = Date.now() + MAX_WAIT_MS;
      for (;;) {
        const detail = await apiClient.get(`/documents/${id}`, { schema: DocumentDetail });
        const status = detail.document.status;
        if (status === 'ready') {
          queryClient.setQueryData(qk.documents.detail(id), detail);
          return detail;
        }
        if (status === 'failed' || status === 'cancelled') {
          throw new ApiError({
            code: 'INTERNAL',
            message: "The draft couldn't be finished. Nothing was counted against your quota.",
            status: 500,
          });
        }
        if (Date.now() > deadline) {
          throw new ApiError({
            code: 'INTERNAL',
            message: 'Generation is taking longer than expected. Check the document later.',
            status: 504,
          });
        }
        await sleep(POLL_MS);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.documents.all }),
  });

  return {
    generate: (body: CreateDocumentInput) => {
      mutation.reset();
      mutation.mutate(body);
    },
    loading: mutation.isPending,
    error: mutation.error ? generationErrorCopy(mutation.error) : null,
    detail: mutation.data ?? null,
  };
}
