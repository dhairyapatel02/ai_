import { z } from 'zod';

import { Id, PageQuery, Timestamp } from './common';

/** Wire enums (API_CONTRACT_V2 §3.2). */
export const SyncStatus = z.enum([
  'queued',
  'running',
  'waiting_rate_limit',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
]);
export type SyncStatus = z.infer<typeof SyncStatus>;

export const SyncStage = z.enum([
  'prepare',
  'repositories',
  'authored_prs',
  'reviewed_prs',
  'commits',
  'persist',
  'rollups',
  'done',
]);
export type SyncStage = z.infer<typeof SyncStage>;

export const SyncTrigger = z.enum(['initial', 'manual', 'scheduled', 'webhook', 'reconnect']);
export type SyncTrigger = z.infer<typeof SyncTrigger>;

export const SyncKind = z.enum(['backfill', 'incremental', 'targeted']);
export type SyncKind = z.infer<typeof SyncKind>;

export const SyncCounts = z
  .object({
    repos: z.number(),
    prsAuthored: z.number(),
    prsReviewed: z.number(),
    reviews: z.number(),
    commits: z.number(),
    created: z.number(),
    updated: z.number(),
  })
  .partial();
export type SyncCounts = z.infer<typeof SyncCounts>;

export const SyncRunError = z.object({
  stage: SyncStage,
  repo: z.string().nullable(),
  code: z.string(),
  message: z.string(),
  at: Timestamp,
});
export type SyncRunError = z.infer<typeof SyncRunError>;

/** API_CONTRACT_V2 §3.5 + amendment A-4 (`recentWindowCompletedAt`). */
export const SyncRunDto = z.object({
  id: Id,
  integrationId: Id,
  trigger: SyncTrigger,
  kind: SyncKind,
  status: SyncStatus,
  stage: SyncStage,
  progress: z.number().int().min(0).max(100),
  counts: SyncCounts,
  windowFrom: Timestamp.nullable(),
  windowTo: Timestamp.nullable(),
  resumeAt: Timestamp.nullable(),
  recentWindowCompletedAt: Timestamp.nullable().optional(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  errors: z.array(SyncRunError),
  queuedAt: Timestamp,
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
});
export type SyncRunDto = z.infer<typeof SyncRunDto>;

export const SyncStateWire = z.enum([
  'idle',
  'queued',
  'running',
  'waiting_rate_limit',
  'needs_reauth',
  'failed',
]);
export type SyncStateWire = z.infer<typeof SyncStateWire>;

/** `GET /sync/status` — read from the database, never from the queue (DATA-06). */
export const SyncStatusDto = z.object({
  integrationId: Id,
  state: SyncStateWire,
  currentRun: SyncRunDto.nullable(),
  lastRun: SyncRunDto.nullable(),
  lastSuccessfulAt: Timestamp.nullable(),
  nextScheduledAt: Timestamp.nullable(),
});
export type SyncStatusDto = z.infer<typeof SyncStatusDto>;

export const SyncRequest = z.strictObject({ integrationId: Id.optional() });
export type SyncRequest = z.infer<typeof SyncRequest>;

export const SyncStatusQuery = z.strictObject({ integrationId: Id.optional() });
export type SyncStatusQuery = z.infer<typeof SyncStatusQuery>;

export const SyncRunListQuery = PageQuery.extend({
  integrationId: Id.optional(),
  status: SyncStatus.optional(),
});
export type SyncRunListQuery = z.infer<typeof SyncRunListQuery>;

export const SyncAccepted = z.object({ syncRun: SyncRunDto });
export type SyncAccepted = z.infer<typeof SyncAccepted>;
