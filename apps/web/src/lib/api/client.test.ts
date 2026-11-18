import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { errJson, okJson } from '../../../test/fixtures';

import { createApiClient, toQueryString } from './client';
import { ApiError } from './errors';

function setup(responses: Response[], token = 'jwt-1') {
  const fetchMock = vi.fn<typeof fetch>();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  const getToken = vi.fn(({ forceRefresh }: { forceRefresh: boolean }) =>
    Promise.resolve(forceRefresh ? `${token}-refreshed` : token),
  );
  const onUnauthenticated = vi.fn();
  const client = createApiClient({ baseUrl: 'https://api.test/api', getToken, onUnauthenticated, fetch: fetchMock });
  return { client, fetchMock, getToken, onUnauthenticated };
}

const Thing = z.object({ id: z.string(), n: z.number() });

describe('apiClient', () => {
  it('sends the Bearer JWT, unwraps the envelope and parses with the shared schema', async () => {
    const { client, fetchMock } = setup([okJson({ id: 'a', n: 1, extra: true })]);
    const data = await client.get('/things/a', { schema: Thing, query: { period: 'month:2026-10', skip: undefined } });
    expect(data).toEqual({ id: 'a', n: 1 });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.test/api/things/a?period=month%3A2026-10');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1');
    expect(init?.credentials).toBe('omit');
  });

  it('serialises JSON bodies', async () => {
    const { client, fetchMock } = setup([okJson({ id: 'a', n: 2 })]);
    await client.patch('/things/a', { body: { n: 2 }, schema: Thing });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('PATCH');
    expect(init?.body).toBe('{"n":2}');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('throws a typed ApiError with code, details and requestId', async () => {
    const { client } = setup([errJson(409, 'SYNC_IN_PROGRESS', { details: { syncRunId: 'r1' } })]);
    const error = await client.post('/sync').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'SYNC_IN_PROGRESS', status: 409, details: { syncRunId: 'r1' }, requestId: 'req-123' });
    expect((error as ApiError).retryable).toBe(false);
  });

  it('reads Retry-After on 429', async () => {
    const { client } = setup([errJson(429, 'RATE_LIMITED', { headers: { 'retry-after': '120' } })]);
    await expect(client.post('/sync')).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 120 });
  });

  it('keeps 402 QUOTA_EXCEEDED details', async () => {
    const details = { feature: 'generations', used: 15, limit: 15, resetsAt: '2026-12-01T00:00:00.000Z' };
    const { client } = setup([errJson(402, 'QUOTA_EXCEEDED', { details })]);
    await expect(client.post('/documents')).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', status: 402, details });
  });

  it('refreshes the token once on 401 and retries', async () => {
    const { client, fetchMock, getToken, onUnauthenticated } = setup([
      errJson(401, 'UNAUTHENTICATED'),
      okJson({ id: 'a', n: 1 }),
    ]);
    await expect(client.get('/things/a', { schema: Thing })).resolves.toEqual({ id: 'a', n: 1 });
    expect(getToken).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1-refreshed');
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('calls onUnauthenticated when the refreshed token is rejected too', async () => {
    const { client, onUnauthenticated } = setup([errJson(401, 'UNAUTHENTICATED'), errJson(401, 'UNAUTHENTICATED')]);
    await expect(client.get('/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('maps network failures to NETWORK_ERROR (retryable) and bad shapes to INVALID_RESPONSE', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('fetch failed'));
    const client = createApiClient({ baseUrl: 'x', getToken: () => Promise.resolve(null), fetch: fetchMock });
    const error = await client.get('/me').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
    expect((error as ApiError).retryable).toBe(true);

    const { client: c2 } = setup([okJson({ id: 1 })]);
    await expect(c2.get('/things/a', { schema: Thing })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('derives a code from the status when the error body is not an envelope', async () => {
    const { client } = setup([new Response('<html>Bad gateway</html>', { status: 502 })]);
    await expect(client.get('/me')).rejects.toMatchObject({ code: 'INTERNAL', status: 502 });
  });

  it('returns items + meta for cursor pages', async () => {
    const { client } = setup([okJson([{ id: 'a', n: 1 }], { meta: { nextCursor: 'abc', hasMore: true, total: 3 } })]);
    const page = await client.getPage('/things', { schema: Thing });
    expect(page).toEqual({ items: [{ id: 'a', n: 1 }], meta: { nextCursor: 'abc', hasMore: true, total: 3 } });
  });

  it('builds query strings with comma lists and drops empty values', () => {
    expect(toQueryString({ types: ['a', 'b'], q: '', n: 2, on: false, none: null })).toBe('?types=a%2Cb&n=2&on=false');
    expect(toQueryString(undefined)).toBe('');
  });
});
