import { describe, expect, it } from 'vitest';

import { ApiError } from './errors';
import { makeQueryClient } from './query-client';

describe('query defaults (ADR-0010)', () => {
  const retry = makeQueryClient().getDefaultOptions().queries?.retry as (
    n: number,
    e: unknown,
  ) => boolean;

  it('retries GETs on network errors and 5xx, at most twice', () => {
    expect(retry(0, new ApiError({ code: 'NETWORK_ERROR', message: '', status: 0 }))).toBe(true);
    expect(retry(1, new ApiError({ code: 'UPSTREAM_UNAVAILABLE', message: '', status: 503 }))).toBe(
      true,
    );
    expect(retry(2, new ApiError({ code: 'INTERNAL', message: '', status: 500 }))).toBe(false);
  });

  it('never retries 4xx', () => {
    for (const [code, status] of [
      ['NOT_FOUND', 404],
      ['VALIDATION_FAILED', 400],
      ['RATE_LIMITED', 429],
      ['UNAUTHENTICATED', 401],
    ] as const) {
      expect(retry(0, new ApiError({ code, message: '', status }))).toBe(false);
    }
  });

  it('does not retry mutations and keeps data fresh for 30 s', () => {
    const defaults = makeQueryClient().getDefaultOptions();
    expect(defaults.mutations?.retry).toBe(false);
    expect(defaults.queries?.staleTime).toBe(30_000);
  });
});
