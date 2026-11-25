import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import {
  ProviderAuthError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from './provider.errors';

import type { ProviderStats } from '@devimpact/shared';

/** Rate-limit state a provider reports on a response (or null when it reports nothing). */
export interface RateLimitReading {
  remaining: number | null;
  resetAt: Date | null;
}

export interface ProviderHttpOptions {
  /** Provider label for error messages (never includes tokens or URLs with secrets). */
  label: string;
  getAccessToken: () => Promise<string>;
  onUnauthorized: () => Promise<string | null>;
  minRemaining?: number;
  retries: number;
  timeoutMs: number;
  readRateLimit: (headers: Headers) => RateLimitReading;
  /** Extra headers on every request (e.g. `Accept`). */
  headers?: Record<string, string>;
}

export interface ProviderRequest {
  method?: 'GET' | 'POST';
  url: string | URL;
  /** JSON body. */
  json?: unknown;
}

const RETRYABLE = new Set([500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `Retry-After` (seconds or HTTP date) → absolute time; defaults to one minute. */
export function retryAfter(headers: Headers, now = Date.now()): Date {
  const value = headers.get('retry-after');
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return new Date(now + Math.max(1, seconds) * 1000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return new Date(date);
  }
  return new Date(now + 60_000);
}

/**
 * Bearer-token JSON client shared by the GitLab, Jira and Linear sessions (ADR-0007 §Failure
 * handling): 401 → one refresh via `onUnauthorized`, then `ProviderAuthError`; 429 or a budget
 * below `minRemaining` → `ProviderRateLimitError` (the engine pauses and resumes from the
 * checkpoint); 404 → `ProviderNotFoundError`; 5xx/network → bounded retries, then
 * `ProviderUnavailableError`. Tokens are only ever placed in the `Authorization` header.
 */
export class ProviderHttp {
  readonly stats: ProviderStats = {
    requests: 0,
    graphqlPoints: 0,
    rateLimitRemaining: null,
    rateLimitResetAt: null,
  };
  private token: string | null = null;

  constructor(private readonly options: ProviderHttpOptions) {}

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- callers name the JSON shape they expect
  async request<T>(req: ProviderRequest): Promise<{ data: T; headers: Headers; status: number }> {
    const { minRemaining } = this.options;
    if (
      minRemaining !== undefined &&
      this.stats.rateLimitRemaining !== null &&
      this.stats.rateLimitRemaining < minRemaining &&
      this.stats.rateLimitResetAt &&
      this.stats.rateLimitResetAt.getTime() > Date.now()
    ) {
      throw new ProviderRateLimitError(this.stats.rateLimitResetAt, this.stats.rateLimitRemaining);
    }
    this.token ??= await this.options.getAccessToken();
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(req.url, {
          method: req.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            ...(req.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...this.options.headers,
            Authorization: `Bearer ${this.token}`,
          },
          body: req.json !== undefined ? JSON.stringify(req.json) : undefined,
          // Never replay the bearer token to another location (redirects are refused).
          redirect: 'error',
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
      } catch {
        if (attempt < this.options.retries) {
          await sleep(250 * 2 ** attempt);
          continue;
        }
        throw new ProviderUnavailableError(`${this.options.label} could not be reached`);
      }
      this.stats.requests++;
      const reading = this.options.readRateLimit(res.headers);
      if (reading.remaining !== null) this.stats.rateLimitRemaining = reading.remaining;
      if (reading.resetAt) this.stats.rateLimitResetAt = reading.resetAt;

      if (res.status === 401) {
        if (refreshed) throw new ProviderAuthError('TOKEN_REVOKED');
        refreshed = true;
        const next = await this.options.onUnauthorized();
        if (!next) throw new ProviderAuthError('TOKEN_REVOKED');
        this.token = next;
        continue;
      }
      if (res.status === 429) {
        throw new ProviderRateLimitError(reading.resetAt ?? retryAfter(res.headers), 0);
      }
      if (res.status === 404 || res.status === 410) {
        throw new ProviderNotFoundError(this.options.label);
      }
      if (res.status === 403) {
        // GitLab answers 403 for projects the token can no longer read.
        throw new ProviderNotFoundError(this.options.label);
      }
      if (RETRYABLE.has(res.status) && attempt < this.options.retries) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      if (!res.ok && res.status !== 400) {
        throw new ProviderUnavailableError(
          `${this.options.label} answered ${res.status}`,
          res.status,
        );
      }
      const data = (await res.json().catch(() => null)) as T;
      return { data, headers: res.headers, status: res.status };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- callers name the JSON shape they expect
  async get<T>(url: string | URL): Promise<{ data: T; headers: Headers }> {
    const res = await this.request<T>({ url });
    if (res.status === 400) {
      throw new ProviderUnavailableError(`${this.options.label} rejected the request`, 400);
    }
    return res;
  }
}

/** OAuth token endpoint call (form or JSON), shared by the three OAuth clients. */
export async function tokenRequest(
  url: string,
  body: Record<string, string>,
  options: { json?: boolean; timeoutMs: number; label: string },
): Promise<{ status: number; data: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': options.json ? 'application/json' : 'application/x-www-form-urlencoded',
      },
      body: options.json ? JSON.stringify(body) : new URLSearchParams(body).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch {
    throw new ProviderUnavailableError(`${options.label} could not be reached`);
  }
  const data = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return { status: res.status, data };
}

/** Maps an OAuth token response to `ProviderTokenSet`; 400/401 → `ProviderAuthError`. */
export function toTokenSet(
  res: { status: number; data: Record<string, unknown> },
  label: string,
  now = Date.now(),
) {
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new ProviderAuthError('REFRESH_FAILED');
  }
  const access = res.data.access_token;
  if (res.status >= 300 || typeof access !== 'string' || access === '') {
    throw new ProviderUnavailableError(`${label} token endpoint failed`, res.status);
  }
  const expiresIn = Number(res.data.expires_in);
  const refresh = res.data.refresh_token;
  const refreshExpiresIn = Number(res.data.refresh_token_expires_in);
  return {
    accessToken: access,
    accessTokenExpiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now + expiresIn * 1000) : null,
    refreshToken: typeof refresh === 'string' && refresh !== '' ? refresh : null,
    refreshTokenExpiresAt:
      Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0
        ? new Date(now + refreshExpiresIn * 1000)
        : null,
  };
}

/** Constant-time comparison of two strings (webhook shared secrets); fails closed on empties. */
export function safeEqual(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** `HMAC-SHA256(secret, rawBody)` hex compared in constant time; fails closed without a secret. */
export function verifyHmacHex(
  secret: string | undefined,
  rawBody: Uint8Array,
  givenHex: string | undefined,
): boolean {
  if (!secret || !givenHex || !/^[0-9a-f]{64}$/i.test(givenHex)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(givenHex, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
