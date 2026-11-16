import { z } from 'zod';

import { Id, PageQuery, QueryBoolean, Timestamp } from './common';

/** API_CONTRACT_V2 §3.5 / §7. */
export const RepositoryDto = z.object({
  id: Id,
  integrationId: Id,
  fullName: z.string(),
  isPrivate: z.boolean(),
  isFork: z.boolean(),
  isArchived: z.boolean(),
  accessible: z.boolean(),
  included: z.boolean(),
  inclusionSource: z.enum(['default', 'user']),
  viaInstallation: z.boolean(),
  lastActivityAt: Timestamp.nullable(),
  lastSyncedAt: Timestamp.nullable(),
  htmlUrl: z.url().nullable(),
});
export type RepositoryDto = z.infer<typeof RepositoryDto>;

export const RepoListQuery = PageQuery.extend({
  integrationId: Id.optional(),
  included: QueryBoolean.optional(),
  accessible: QueryBoolean.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(['fullName', '-lastActivityAt']).default('fullName'),
});
export type RepoListQuery = z.infer<typeof RepoListQuery>;

export const RepoPatch = z.strictObject({ included: z.boolean() });
export type RepoPatch = z.infer<typeof RepoPatch>;

export const RepoBulkPatch = z.strictObject({
  ids: z.array(Id).min(1).max(200),
  included: z.boolean(),
});
export type RepoBulkPatch = z.infer<typeof RepoBulkPatch>;

export const RepoBulkResult = z.object({ updated: z.number().int().nonnegative() });
export type RepoBulkResult = z.infer<typeof RepoBulkResult>;

export const RepoPurgeResult = z.object({
  deleted: z.object({
    pullRequests: z.number().int().nonnegative(),
    reviews: z.number().int().nonnegative(),
    commits: z.number().int().nonnegative(),
  }),
});
export type RepoPurgeResult = z.infer<typeof RepoPurgeResult>;
