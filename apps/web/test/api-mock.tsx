/**
 * Test double for `@/lib/api/browser` (P10 view tests): routes `METHOD /path` to handlers, so the
 * real hooks, query keys and Zod schemas run against fixtures captured from the seeded API
 * (`test/fixtures-p10/*.json`, demo user, 2026-11-18).
 *
 * Usage in a test file:
 *   vi.mock('@/lib/api/browser', async () => (await import('../../../../test/api-mock')).browserModule);
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

import { ShellProvider } from '@/components/shell/shell-context';
import { ApiError } from '@/lib/api/errors';

import type { ReactNode } from 'react';
import type { z } from 'zod';

type Query = Record<string, unknown> | undefined;
export type Handler = (query: Query, body: unknown) => unknown;

export const routes = new Map<string, Handler>();

/** Never settles: the loading state. */
export const pending: Handler = () => new Promise(() => undefined);
export const fail =
  (status = 503, code = 'UPSTREAM_UNAVAILABLE', details?: unknown): Handler =>
  () =>
    Promise.reject(
      new ApiError({
        code: code as never,
        status,
        message: `${code} message`,
        details,
        requestId: 'req-123',
      }),
    );
export const ok =
  (data: unknown): Handler =>
  () =>
    data;

/** Values: a handler, an envelope-like `{ data, meta }`, or any plain response body. */
export function setRoutes(table: Record<string, Handler | object>) {
  routes.clear();
  for (const [key, value] of Object.entries(table)) {
    routes.set(key, typeof value === 'function' ? (value as Handler) : () => value);
  }
}

function find(method: string, path: string): Handler {
  const exact = routes.get(`${method} ${path}`);
  if (exact) return exact;
  for (const [key, handler] of routes) {
    const [m, pattern] = key.split(' ');
    if (m !== method || !pattern?.includes('*')) continue;
    if (path.startsWith(pattern.replace('*', ''))) return handler;
  }
  return fail(404, 'NOT_FOUND');
}

function unwrap(value: unknown): { data: unknown; meta?: unknown } {
  return value && typeof value === 'object' && 'data' in value ? value : { data: value };
}

async function call(method: string, path: string, options: { query?: Query; body?: unknown } = {}) {
  return unwrap(await find(method, path)(options.query, options.body));
}

function parse<T>(schema: z.ZodType<T> | undefined, data: unknown): T {
  return schema ? schema.parse(data) : (data as T);
}

export const calls: { method: string; path: string; query?: Query; body?: unknown }[] = [];

function method(name: string) {
  return async <T,>(
    path: string,
    options: { schema?: z.ZodType<T>; query?: Query; body?: unknown } = {},
  ) => {
    calls.push({ method: name, path, query: options.query, body: options.body });
    const { data } = await call(name, path, options);
    return parse(options.schema, data);
  };
}

export const apiClient = {
  get: method('GET'),
  post: method('POST'),
  patch: method('PATCH'),
  delete: method('DELETE'),
  async getPage<T>(path: string, options: { schema?: z.ZodType<T>; query?: Query } = {}) {
    calls.push({ method: 'GET', path, query: options.query });
    const { data, meta } = await call('GET', path, options);
    const items = (data as unknown[]).map((item) => parse(options.schema, item));
    return {
      items,
      meta: (meta as
        { nextCursor: string | null; hasMore: boolean; total?: number } | undefined) ?? {
        nextCursor: null,
        hasMore: false,
      },
    };
  },
  /** File downloads: the handler returns `{ blob, filename }`. */
  async download(path: string, options: { query?: Query } = {}) {
    calls.push({ method: 'GET', path, query: options.query });
    return (await find('GET', path)(options.query, undefined)) as {
      blob: Blob;
      filename: string | null;
    };
  },
  async requestWithMeta<T>(
    m: string,
    path: string,
    options: { schema?: z.ZodType<T>; query?: Query; body?: unknown } = {},
  ) {
    const { data, meta } = await call(m, path, options);
    return { data: parse(options.schema, data), meta: (meta ?? {}) as Record<string, unknown> };
  },
};

export const browserModule = {
  apiClient,
  // Public endpoints (unsubscribe) go through the same route table.
  publicApiClient: apiClient,
  getApiToken: vi.fn(() => Promise.resolve('test-token')),
  clearApiToken: vi.fn(),
};

/** Renders with a fresh QueryClient (no retries) so each test starts from an empty cache. */
export function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Views can open the shell's dialogs (Add achievement / goal), so they render inside its provider.
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ShellProvider>{ui}</ShellProvider>
      </QueryClientProvider>,
    ),
  };
}
