/**
 * Errors a provider session raises. The sync engine maps them to SyncRun outcomes
 * (ADR-0007 §Failure handling): rate limit → WAITING_RATE_LIMIT + delayed resume; auth →
 * NEEDS_REAUTH; not found → per-repository error (PARTIAL); unavailable → retry, then FAILED.
 */
export class ProviderRateLimitError extends Error {
  constructor(
    readonly resetAt: Date,
    readonly remaining: number | null,
  ) {
    super(`Provider rate limit reached; resets at ${resetAt.toISOString()}`);
    this.name = 'ProviderRateLimitError';
  }
}

export class ProviderAuthError extends Error {
  constructor(readonly reason: 'TOKEN_REVOKED' | 'REFRESH_FAILED' | 'NO_TOKEN' = 'TOKEN_REVOKED') {
    super(`Provider authorization failed (${reason})`);
    this.name = 'ProviderAuthError';
  }
}

export class ProviderNotFoundError extends Error {
  constructor(readonly resource: string) {
    super(`Not found or not accessible: ${resource}`);
    this.name = 'ProviderNotFoundError';
  }
}

export class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}
