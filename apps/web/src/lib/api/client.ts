import { ErrorEnvelope, PageMeta } from '@devimpact/shared';
import { z } from 'zod';

import { ApiError, isErrorCode, type ApiErrorCode } from './errors';

export type QueryValue = string | number | boolean | null | undefined | readonly string[];
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions<T> {
  /** Shared Zod schema for `data` (packages/shared/src/api/*). Omit only for `unknown` bodies. */
  schema?: z.ZodType<T>;
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

export interface ApiClientConfig {
  baseUrl: string;
  /** Bearer JWT (`null` = no session). `forceRefresh` after a 401 (expired/rotated key). */
  getToken: (options: { forceRefresh: boolean }) => Promise<string | null>;
  /** Called once a refreshed token is still rejected (browser: redirect to /sign-in). */
  onUnauthenticated?: () => void;
  fetch?: typeof fetch;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const SuccessEnvelope = z.object({
  success: z.literal(true),
  data: z.unknown(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/** `a=1&b=x,y` — arrays become comma lists (API_CONTRACT_V2 §1 Filtering); empty values dropped. */
export function toQueryString(query: QueryParams | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function retryAfter(res: Response, details: unknown): number | null {
  const header = res.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds);
    const at = Date.parse(header);
    if (!Number.isNaN(at)) return Math.max(0, Math.round((at - Date.now()) / 1000));
  }
  const fromDetails = (details as { retryAfterSeconds?: unknown } | null | undefined)
    ?.retryAfterSeconds;
  return typeof fromDetails === 'number' ? fromDetails : null;
}

/** `attachment; filename="appraisal-2026-H2-v1.pdf"` → the name, if it is a plain file name. */
export function filenameFrom(header: string | null): string | null {
  const match = header ? /filename="([^"]+)"/i.exec(header) : null;
  const name = match?.[1] ?? null;
  return name && /^[A-Za-z0-9._-]{1,120}$/.test(name) ? name : null;
}

async function toApiError(res: Response): Promise<ApiError> {
  const raw: unknown = await res.json().catch(() => null);
  const parsed = ErrorEnvelope.safeParse(raw);
  const requestId = res.headers.get('x-request-id');
  if (parsed.success) {
    const { code, message, details, requestId: bodyRequestId } = parsed.data.error;
    return new ApiError({
      code,
      message,
      status: res.status,
      details,
      requestId: bodyRequestId || requestId,
      retryAfterSeconds: retryAfter(res, details),
    });
  }
  // Unknown body (proxy error page, older API): derive the code from the status.
  const fallback: ApiErrorCode =
    res.status === 401
      ? 'UNAUTHENTICATED'
      : res.status === 404
        ? 'NOT_FOUND'
        : res.status === 429
          ? 'RATE_LIMITED'
          : res.status >= 500
            ? 'INTERNAL'
            : 'VALIDATION_FAILED';
  const bodyCode = (raw as { error?: { code?: unknown } } | null)?.error?.code;
  const code: ApiErrorCode = isErrorCode(bodyCode) ? bodyCode : fallback;
  return new ApiError({
    code,
    message: `Request failed (${res.status})`,
    status: res.status,
    requestId,
    retryAfterSeconds: retryAfter(res, null),
  });
}

/**
 * Typed API client (ADR-0010): Bearer JWT, D-006 envelope unwrapping, response parsing with the
 * shared Zod schemas, typed `ApiError`. A 401 refreshes the token once and retries; a second 401
 * calls `onUnauthenticated`. This is the only module (with the SSE reader) that calls `fetch`.
 */
export function createApiClient(config: ApiClientConfig) {
  const doFetch = config.fetch ?? ((input, init) => fetch(input, init));

  async function send(method: Method, path: string, options: RequestOptions<unknown>) {
    const url = `${config.baseUrl}${path}${toQueryString(options.query)}`;
    const attempt = async (forceRefresh: boolean) => {
      const token = await config.getToken({ forceRefresh });
      const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      return doFetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
    };

    let res: Response;
    try {
      res = await attempt(false);
      if (res.status === 401) {
        res = await attempt(true);
        if (res.status === 401) config.onUnauthenticated?.();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError({
        code: 'NETWORK_ERROR',
        message: 'The DevImpact API did not respond',
        status: 0,
      });
    }

    if (!res.ok) throw await toApiError(res);

    const raw: unknown = await res.json().catch(() => null);
    const envelope = SuccessEnvelope.safeParse(raw);
    if (!envelope.success) {
      throw new ApiError({
        code: 'INVALID_RESPONSE',
        message: 'Unexpected response from the API',
        status: res.status,
        requestId: res.headers.get('x-request-id'),
      });
    }
    return { data: envelope.data.data, meta: envelope.data.meta, status: res.status, res };
  }

  function parse<T>(data: unknown, schema: z.ZodType<T> | undefined, res: Response): T {
    if (!schema) return data as T;
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new ApiError({
        code: 'INVALID_RESPONSE',
        message: 'Unexpected response from the API',
        status: res.status,
        requestId: res.headers.get('x-request-id'),
        details: result.error.issues.slice(0, 5),
      });
    }
    return result.data;
  }

  async function request<T>(method: Method, path: string, options: RequestOptions<T> = {}) {
    const { data, res } = await send(method, path, options);
    return parse(data, options.schema, res);
  }

  return {
    get: <T>(path: string, options?: RequestOptions<T>) => request<T>('GET', path, options),
    post: <T>(path: string, options?: RequestOptions<T>) => request<T>('POST', path, options),
    patch: <T>(path: string, options?: RequestOptions<T>) => request<T>('PATCH', path, options),
    delete: <T>(path: string, options?: RequestOptions<T>) => request<T>('DELETE', path, options),
    /** Cursor-paginated list: `data` is the item array, `meta` the PageMeta (§1 Pagination). */
    async getPage<T>(path: string, options: RequestOptions<T> = {}): Promise<Page<T>> {
      const { data, meta, res } = await send('GET', path, {
        ...options,
        schema: undefined,
      });
      const items = parse(data, z.array(options.schema ?? z.unknown()) as z.ZodType<T[]>, res);
      const pageMeta = PageMeta.safeParse(meta);
      return {
        items,
        meta: pageMeta.success ? pageMeta.data : { nextCursor: null, hasMore: false },
      };
    },
    /**
     * File download (not enveloped, e.g. `GET /documents/:id/export`): the body as a Blob and the
     * filename from `Content-Disposition` (ASCII `filename="…"` only; null when absent/unsafe).
     */
    async download(path: string, options: Pick<RequestOptions<never>, 'query' | 'signal'> = {}) {
      const url = `${config.baseUrl}${path}${toQueryString(options.query)}`;
      const attempt = async (forceRefresh: boolean) => {
        const token = await config.getToken({ forceRefresh });
        return doFetch(url, {
          method: 'GET',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: options.signal,
          credentials: 'omit',
          cache: 'no-store',
        });
      };
      let res: Response;
      try {
        res = await attempt(false);
        if (res.status === 401) {
          res = await attempt(true);
          if (res.status === 401) config.onUnauthenticated?.();
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new ApiError({
          code: 'NETWORK_ERROR',
          message: 'The DevImpact API did not respond',
          status: 0,
        });
      }
      if (!res.ok) throw await toApiError(res);
      return {
        blob: await res.blob(),
        filename: filenameFrom(res.headers.get('content-disposition')),
      };
    },
    /** Raw access to `meta` for endpoints that add fields to it (e.g. `recomputeQueued`). */
    async requestWithMeta<T>(method: Method, path: string, options: RequestOptions<T> = {}) {
      const { data, meta, res } = await send(method, path, options);
      return { data: parse(data, options.schema, res), meta: meta ?? {} };
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
