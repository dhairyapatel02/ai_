'use client';

import { useCallback, useState } from 'react';

import { useAuth } from './auth-context';

import type { CreateDocumentResponse, DocumentDetail } from '@devimpact/shared';

const POLL_MS = 1500;
const MAX_WAIT_MS = 3 * 60_000;

/** User-facing copy for generation errors (design/SCREENS.md S13–S16). */
function errorCopy(res: { code?: string; error?: string; status?: number }): string {
  switch (res.code) {
    case 'QUOTA_EXCEEDED':
      return 'You have used all AI generations for this month. They reset on the 1st (UTC).';
    case 'CONFLICT':
      return 'There is no activity in this period to write about. Pick another period.';
    case 'RATE_LIMITED':
      return 'Too many generations in a short time. Try again in a minute.';
    case 'UPSTREAM_UNAVAILABLE':
      return res.error ?? 'The AI service is busy. Try again in a minute.';
    default:
      return res.error ?? 'Generation failed.';
  }
}

/**
 * Interim document generation for the v1 studio pages (P11 rebuilds them with fetch-SSE):
 * `POST /documents`, then poll `GET /documents/:id` until the worker finishes.
 */
export function useGenerateDocument() {
  const { apiFetch } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);

  const generate = useCallback(
    async (body: Record<string, unknown>) => {
      setLoading(true);
      setError(null);
      setDetail(null);
      try {
        const created = await apiFetch<CreateDocumentResponse>('/documents', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (!created.success || !created.data) {
          setError(errorCopy(created));
          return;
        }
        const id = created.data.document.id;
        const deadline = Date.now() + MAX_WAIT_MS;
        for (;;) {
          const res = await apiFetch<DocumentDetail>(`/documents/${id}`);
          if (!res.success || !res.data) {
            setError(errorCopy(res));
            return;
          }
          const status = res.data.document.status;
          if (status === 'ready') {
            setDetail(res.data);
            return;
          }
          if (status === 'failed' || status === 'cancelled') {
            setError("The draft couldn't be finished. Nothing was counted against your quota.");
            return;
          }
          if (Date.now() > deadline) {
            setError('Generation is taking longer than expected. Check the document later.');
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
      } finally {
        setLoading(false);
      }
    },
    [apiFetch],
  );

  return { generate, loading, error, detail };
}
