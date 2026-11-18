import { ERROR_CODES, type ErrorCode } from '@devimpact/shared';

/** Codes the client adds for failures that never reached (or never came back from) the API. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'INVALID_RESPONSE';
export type ApiErrorCode = ErrorCode | ClientErrorCode;

const KNOWN_CODES = new Set<string>(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && KNOWN_CODES.has(value);
}

/**
 * Typed API failure (ADR-0010): `code` from API_CONTRACT_V2 §2 (`ERROR_CODES`), the HTTP status,
 * the safe `details`, the `requestId` to quote in support requests, and `retryAfterSeconds` from a
 * 429 `Retry-After` header (or `details.retryAfterSeconds`).
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(init: {
    code: ApiErrorCode;
    message: string;
    status: number;
    details?: unknown;
    requestId?: string | null;
    retryAfterSeconds?: number | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.details = init.details;
    this.requestId = init.requestId ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }

  /** Worth retrying automatically: network failures and 5xx (never 4xx, ADR-0010). */
  get retryable(): boolean {
    return this.code === 'NETWORK_ERROR' || this.status >= 500;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** `details` of `QUOTA_EXCEEDED` (402). */
export interface QuotaDetails {
  feature: string;
  used: number;
  limit: number;
  resetsAt: string;
}

export function quotaDetails(error: ApiError): QuotaDetails | null {
  const d = error.details as Record<string, unknown> | null | undefined;
  if (error.code !== 'QUOTA_EXCEEDED' || !d || typeof d.resetsAt !== 'string') return null;
  return {
    feature: typeof d.feature === 'string' ? d.feature : '',
    used: typeof d.used === 'number' ? d.used : 0,
    limit: typeof d.limit === 'number' ? d.limit : 0,
    resetsAt: d.resetsAt,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Calm, actionable copy for an error (DESIGN_SYSTEM §8): what failed + what to do. Never shows
 * raw upstream payloads (UX-05). `what` names the thing that failed ("your dashboard").
 */
export function errorMessage(error: unknown, what = 'this'): string {
  if (!isApiError(error)) return `Couldn't load ${what}. Try again in a moment.`;
  switch (error.code) {
    case 'NETWORK_ERROR':
      return `Couldn't load ${what}. The DevImpact API didn't respond. Your data is safe — try again.`;
    case 'UNAUTHENTICATED':
      return 'Your session ended. Sign in to continue.';
    case 'RATE_LIMITED': {
      if (error.retryAfterSeconds) {
        const at = new Date(Date.now() + error.retryAfterSeconds * 1000);
        return `Too many requests. You can try again at ${hhmm(at)}.`;
      }
      return 'Too many requests. Try again in a minute.';
    }
    case 'QUOTA_EXCEEDED': {
      const q = quotaDetails(error);
      if (q) {
        const reset = new Date(q.resetsAt);
        return `You've used all ${q.limit} ${q.feature === 'quick' ? 'quick AI actions' : 'generations'} this month. They reset on ${MONTHS[reset.getUTCMonth()] ?? ''} ${reset.getUTCDate()}.`;
      }
      return "You've used this month's AI quota.";
    }
    case 'INVALID_PERIOD':
      return "That period isn't valid. Choose 7–366 days that don't start in the future.";
    case 'NOT_FOUND':
      return `Couldn't find ${what}. It may have been deleted.`;
    case 'INTEGRATION_NEEDS_REAUTH':
      return 'GitHub needs to be reconnected before DevImpact can sync.';
    case 'SYNC_IN_PROGRESS':
      return 'A sync is already running.';
    case 'UPSTREAM_UNAVAILABLE':
    case 'UPSTREAM_ERROR':
      return "An upstream service didn't respond. Try again in a minute.";
    case 'INVALID_RESPONSE':
    case 'INTERNAL':
      return "Something went wrong on our side. We've logged the problem — your data is safe.";
    default:
      return error.message;
  }
}
