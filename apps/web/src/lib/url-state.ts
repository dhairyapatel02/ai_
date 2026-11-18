'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * URL search-param state (IA §6): filters, `?item=`, `?metric=`, `?year=` live in the address bar
 * so a view can be linked and Back closes a drawer. `null`/`''` removes a param.
 */
export function useSearchParamsState() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const hrefWith = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '') params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [searchParams, pathname],
  );

  const set = useCallback(
    (updates: Record<string, string | null | undefined>, options: { replace?: boolean } = {}) => {
      const href = hrefWith(updates);
      if (options.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [hrefWith, router],
  );

  return { searchParams, get: (key: string) => searchParams.get(key), set, hrefWith };
}
