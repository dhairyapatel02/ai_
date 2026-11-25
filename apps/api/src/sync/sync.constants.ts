/**
 * Queues and job names (ARCHITECTURE_V2 §2). Keys live under the per-environment BullMQ prefix
 * (`QUEUE_PREFIX`, default `devimpact`, `devimpact-test` under NODE_ENV=test — OPS-17).
 */
export const SYNC_QUEUE = 'sync';
export const METRICS_QUEUE = 'metrics';

export const SYNC_JOBS = {
  backfill: 'sync.backfill',
  incremental: 'sync.incremental',
  targeted: 'sync.targeted',
  fanout: 'sync.fanout',
} as const;

export const METRICS_JOBS = { recompute: 'metrics.recompute', nightly: 'metrics.nightly' } as const;
export const METRICS_NIGHTLY_SCHEDULER_ID = 'metrics-nightly';
/** Debounce of `metrics.recompute` per user (ARCHITECTURE_V2 §2). */
export const METRICS_DEBOUNCE_MS = 30_000;
/** User-initiated recomputes (time zone, repository selection) run almost immediately. */
export const METRICS_FAST_DELAY_MS = 1_000;
export const metricsJobId = (userId: string) => `metrics-${userId}`;

/**
 * One backfill/incremental run per integration at a time. BullMQ custom ids may not contain ':',
 * so the ARCHITECTURE_V2 `sync:<integrationId>` id is spelled `sync-<integrationId>`.
 */
export const syncJobId = (integrationId: string) => `sync-${integrationId}`;
export const targetedJobId = (deliveryId: string) => `sync-t-${deliveryId}`;
export const FANOUT_SCHEDULER_ID = 'sync-fanout';

/** Attempts for transient failures, exponential backoff (ADR-0007). */
export const SYNC_JOB_ATTEMPTS = 3;
export const SYNC_BACKOFF_MS = 30_000;

/** Newest slice of a backfill processed first (dashboard renders after it, ADR-0007). */
export const RECENT_WINDOW_DAYS = 30;
/** Overlap subtracted from cursors (clock skew; idempotent upserts make overlap free). */
export const CURSOR_OVERLAP_MS = 60 * 60_000;
/** Refresh user tokens that expire within this margin (ARCHITECTURE_V2 §6.1). */
export const TOKEN_REFRESH_MARGIN_MS = 10 * 60_000;

export interface SyncJobData {
  syncRunId: string;
  integrationId: string;
  userId: string;
}

export interface MetricsRecomputeJobData {
  userId: string;
  /** Affected range, ISO timestamps (P07 maps it to local dates in the user's time zone). */
  from: string;
  to: string;
  reason:
    'sync' | 'webhook' | 'repository_inclusion' | 'timezone' | 'nightly' | 'manual' | 'achievement';
}
