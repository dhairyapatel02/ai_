import { z } from 'zod';

import { LocalDate, PageQuery, QueryBoolean } from './common';

/**
 * Range bound for v1-era activity endpoints: a local date (`YYYY-MM-DD`, interpreted in the
 * user's time zone; `to` is inclusive — BUG-05) or a full ISO-8601 timestamp with offset.
 * The `period` grammar replaces these in P07.
 */
export const DateBound = z.union([LocalDate, z.iso.datetime({ offset: true })]);

const rangeRefinement = (value: { from?: string; to?: string }) =>
  value.from === undefined ||
  value.to === undefined ||
  value.from.slice(0, 10) <= value.to.slice(0, 10);

export const DateRangeQuery = z
  .strictObject({ from: DateBound.optional(), to: DateBound.optional() })
  .refine(rangeRefinement, { message: '`from` must not be after `to`', path: ['from'] });
export type DateRangeQuery = z.infer<typeof DateRangeQuery>;

export const ActivityListQuery = PageQuery.extend({
  from: DateBound.optional(),
  to: DateBound.optional(),
}).refine(rangeRefinement, { message: '`from` must not be after `to`', path: ['from'] });
export type ActivityListQuery = z.infer<typeof ActivityListQuery>;

/**
 * `GET /activity/prs?role=` (F-18): authored PRs (default) or PRs the user reviewed. The two never
 * mix, so reviewing someone else's PR can't inflate the authored count (DATA-01).
 */
export const PullRequestRole = z.enum(['authored', 'reviewed']);
export type PullRequestRole = z.infer<typeof PullRequestRole>;

export const PullRequestListQuery = PageQuery.extend({
  from: DateBound.optional(),
  to: DateBound.optional(),
  role: PullRequestRole.default('authored'),
}).refine(rangeRefinement, { message: '`from` must not be after `to`', path: ['from'] });
export type PullRequestListQuery = z.infer<typeof PullRequestListQuery>;

export const DocumentListQuery = PageQuery;
export type DocumentListQuery = z.infer<typeof DocumentListQuery>;

/** v1 `GET /generate/impact-score` (removed in P07, replaced by `GET /impact`). */
export const ImpactScoreQuery = z.strictObject({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  force: QueryBoolean.default(false),
});
export type ImpactScoreQuery = z.infer<typeof ImpactScoreQuery>;
