'use client';

import { useSyncExternalStore } from 'react';

const noop = () => undefined;
const subscribe = () => noop;

/**
 * `false` during server rendering and hydration, `true` afterwards. Components inside a
 * Suspense boundary can hydrate after other components have already filled the query cache;
 * rendering cache data during that hydration would mismatch the server HTML.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
