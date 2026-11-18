/** Mutable `next/navigation` double: tests set the URL; `push`/`replace` update it. */
import { vi } from 'vitest';

export const nav = {
  pathname: '/dashboard',
  params: new URLSearchParams(),
  push: vi.fn((href: string) => {
    applyHref(href);
  }),
  replace: vi.fn((href: string) => {
    applyHref(href);
  }),
};

function applyHref(href: string) {
  const url = new URL(href, 'http://localhost');
  nav.pathname = url.pathname;
  nav.params = new URLSearchParams(url.search);
}

export function setUrl(href: string) {
  applyHref(href);
  nav.push.mockClear();
  nav.replace.mockClear();
}

export const navigationModule = {
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.params,
  useRouter: () => ({
    push: nav.push,
    replace: nav.replace,
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  redirect: vi.fn(),
  notFound: vi.fn(),
};

/** `next/dynamic` stub: chart plots render a marker instead of Recharts (jsdom has no layout). */
export const dynamicModule = {
  default: () =>
    function DynamicStub() {
      return null;
    },
};
