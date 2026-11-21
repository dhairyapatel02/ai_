'use client';

import { DocumentDetail } from '@devimpact/shared';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { apiClient } from '@/lib/api/browser';
import { useActiveDocuments } from '@/lib/api/document-hooks';
import { readyToastText } from '@/lib/documents';

/**
 * "Appraisal ready — 96% of claims cited. [Open]" (S16, FLOWS F5) for generations that finish
 * while the user is elsewhere: watches `useActiveDocuments` and announces documents that leave
 * the list. The open document announces itself (viewer), so it is skipped here.
 */
export function DocumentToaster() {
  const active = useActiveDocuments();
  const pathname = usePathname();
  const router = useRouter();
  const previous = useRef<Set<string> | null>(null);
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const ids = active.data?.items.map((d) => d.id).join(',');

  useEffect(() => {
    if (ids === undefined) return;
    const now = new Set(ids ? ids.split(',') : []);
    const before = previous.current;
    previous.current = now;
    if (!before) return;
    for (const id of before) {
      if (now.has(id) || pathRef.current === `/documents/${id}`) continue;
      void apiClient
        .get(`/documents/${encodeURIComponent(id)}`, { schema: DocumentDetail })
        .then(({ document }) => {
          if (document.status !== 'ready' || pathRef.current === `/documents/${id}`) return;
          toast.success(readyToastText(document), {
            duration: 10_000,
            action: {
              label: 'Open',
              onClick: () => {
                router.push(`/documents/${id}`);
              },
            },
          });
        })
        .catch(() => undefined);
    }
  }, [ids, router]);
  return null;
}
