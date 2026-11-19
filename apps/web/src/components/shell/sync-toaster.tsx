'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { useSyncStatus } from '@/lib/api/hooks';
import { plural } from '@/lib/format';
import { newItems } from '@/lib/integration-state';

import type { SyncStateWire } from '@devimpact/shared';

const ACTIVE = new Set<SyncStateWire>(['queued', 'running']);

/**
 * "Sync finished — 3 new items." (FLOWS F4): one toast when a run the user watched ends; the data
 * refreshes in place through `useSyncStatus` invalidation. Failures show the sync banner instead.
 */
export function SyncToaster() {
  const sync = useSyncStatus();
  const previous = useRef<SyncStateWire | null>(null);
  const state = sync.data?.state ?? null;
  const lastRun = sync.data?.lastRun ?? null;
  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    if (!before || !ACTIVE.has(before) || (state && ACTIVE.has(state)) || !lastRun) return;
    if (lastRun.status === 'succeeded') {
      toast.success(`Sync finished — ${plural(newItems(lastRun), 'new item')}.`);
    } else if (lastRun.status === 'partial') {
      const repos = new Set(lastRun.errors.map((e) => e.repo).filter(Boolean)).size;
      toast.warning(
        `Sync finished with errors in ${plural(repos || 1, 'repository', 'repositories')}. Details are in Settings → Integrations.`,
      );
    }
  }, [state, lastRun]);
  return null;
}
