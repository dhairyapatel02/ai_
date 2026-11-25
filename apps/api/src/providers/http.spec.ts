import { createHmac } from 'node:crypto';

import { ProviderHttp, retryAfter, safeEqual, toTokenSet, verifyHmacHex } from './http';
import {
  ProviderAuthError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from './provider.errors';

describe('provider HTTP helpers', () => {
  it('parses Retry-After seconds and dates', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    expect(retryAfter(new Headers({ 'retry-after': '30' }), now).getTime()).toBe(now + 30_000);
    expect(
      retryAfter(new Headers({ 'retry-after': 'Sat, 10 Oct 2026 12:05:00 GMT' }), now).getTime(),
    ).toBe(Date.parse('2026-10-10T12:05:00Z'));
    expect(retryAfter(new Headers(), now).getTime()).toBe(now + 60_000);
  });

  it('maps token responses (expiry, rotation) and rejects refusals', () => {
    const now = 1_000_000;
    expect(
      toTokenSet(
        { status: 200, data: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } },
        'X',
        now,
      ),
    ).toEqual({
      accessToken: 'a',
      accessTokenExpiresAt: new Date(now + 3_600_000),
      refreshToken: 'r',
      refreshTokenExpiresAt: null,
    });
    expect(() => toTokenSet({ status: 400, data: { error: 'invalid_grant' } }, 'X')).toThrow(
      ProviderAuthError,
    );
    expect(() => toTokenSet({ status: 500, data: {} }, 'X')).toThrow(ProviderUnavailableError);
  });

  it('compares secrets in constant time and fails closed', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual(undefined, 'abc')).toBe(false);
    expect(safeEqual('abc', undefined)).toBe(false);
    const body = Buffer.from('x');
    expect(verifyHmacHex('s', body, createHmac('sha256', 's').update(body).digest('hex'))).toBe(
      true,
    );
    expect(verifyHmacHex(undefined, body, 'a'.repeat(64))).toBe(false);
    expect(verifyHmacHex('s', body, 'zz')).toBe(false);
  });

  describe('ProviderHttp', () => {
    const original = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = original;
    });
    const respond = (...responses: Response[]) => {
      const calls: RequestInit[] = [];
      globalThis.fetch = (_url: unknown, init?: RequestInit) => {
        calls.push(init ?? {});
        return Promise.resolve(responses.shift() ?? new Response('{}', { status: 200 }));
      };
      return calls;
    };
    const client = (onUnauthorized = () => Promise.resolve<string | null>('fresh')) =>
      new ProviderHttp({
        label: 'Test',
        getAccessToken: () => Promise.resolve('stale'),
        onUnauthorized,
        retries: 1,
        timeoutMs: 1000,
        minRemaining: 10,
        readRateLimit: (h) => ({
          remaining: h.get('x-remaining') ? Number(h.get('x-remaining')) : null,
          resetAt: h.get('x-reset') ? new Date(Number(h.get('x-reset'))) : null,
        }),
      });

    it('refreshes once on 401 and retries with the new token', async () => {
      const calls = respond(
        new Response('', { status: 401 }),
        new Response('{"ok":1}', { status: 200 }),
      );
      const res = await client().get<{ ok: number }>('https://x.invalid/a');
      expect(res.data.ok).toBe(1);
      expect((calls[1]?.headers as Record<string, string>).Authorization).toBe('Bearer fresh');
    });

    it('raises auth / not-found / rate-limit / unavailable errors', async () => {
      respond(new Response('', { status: 401 }));
      await expect(
        client(() => Promise.resolve(null)).get('https://x.invalid'),
      ).rejects.toBeInstanceOf(ProviderAuthError);
      respond(new Response('', { status: 404 }));
      await expect(client().get('https://x.invalid')).rejects.toBeInstanceOf(ProviderNotFoundError);
      respond(new Response('', { status: 429, headers: { 'retry-after': '5' } }));
      await expect(client().get('https://x.invalid')).rejects.toBeInstanceOf(
        ProviderRateLimitError,
      );
      respond(new Response('', { status: 503 }), new Response('', { status: 503 }));
      await expect(client().get('https://x.invalid')).rejects.toBeInstanceOf(
        ProviderUnavailableError,
      );
    });

    it('pauses before a request when the remaining budget is below minRemaining', async () => {
      const reset = Date.now() + 60_000;
      respond(
        new Response('{}', {
          status: 200,
          headers: { 'x-remaining': '3', 'x-reset': String(reset) },
        }),
      );
      const http = client();
      await http.get('https://x.invalid/1');
      await expect(http.get('https://x.invalid/2')).rejects.toBeInstanceOf(ProviderRateLimitError);
      expect(http.stats.requests).toBe(1);
    });
  });
});
