import { z } from 'zod';

import { Id, LocalDate, PageQuery, ProviderWire, Timestamp } from './common';
import { EvidenceRef, PeriodSpec, QueryList } from './metrics';

/**
 * Activity contracts (API_CONTRACT_V2 §11). Lists are cursor-paginated, newest first, and only
 * contain records from included repositories; authored and reviewed PRs never mix (DATA-01).
 */

/**
 * Range bound: a local date (`YYYY-MM-DD`, interpreted in the user's time zone; `to` is inclusive
 * — BUG-05) or a full ISO-8601 timestamp with offset.
 */
export const DateBound = z.union([LocalDate, z.iso.datetime({ offset: true })]);

const rangeRefinement = (value: { from?: string; to?: string }) =>
  value.from === undefined ||
  value.to === undefined ||
  value.from.slice(0, 10) <= value.to.slice(0, 10);
const periodOrRange = (value: { period?: string; from?: string; to?: string }) =>
  value.period === undefined || (value.from === undefined && value.to === undefined);

export const ActivityType = z.enum([
  'commit',
  'pr_opened',
  'pr_merged',
  'pr_closed',
  'review',
  'achievement',
  'issue',
]);
export type ActivityType = z.infer<typeof ActivityType>;

/** Common filter of every activity list (§11 `ActivityFilter`). */
export const ActivityFilterShape = PageQuery.extend({
  period: PeriodSpec.optional(),
  from: DateBound.optional(),
  to: DateBound.optional(),
  repoIds: QueryList(Id, 50).optional(),
  /** P13: restrict to records from these providers (achievements have none and are kept). */
  providers: QueryList(ProviderWire, 4).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

function filter<T extends z.ZodRawShape>(extra: T) {
  return ActivityFilterShape.extend(extra)
    .refine(rangeRefinement, { message: '`from` must not be after `to`', path: ['from'] })
    .refine(periodOrRange, { message: 'Use either `period` or `from`/`to`', path: ['period'] });
}

export const ActivityListQuery = filter({});
export type ActivityListQuery = z.infer<typeof ActivityListQuery>;

export const FeedQuery = filter({ types: QueryList(ActivityType, 7).optional() });
export type FeedQuery = z.infer<typeof FeedQuery>;

export const RepoRef = z.object({
  id: Id,
  fullName: z.string(),
  /** P13: `gitlab` repositories are GitLab projects (MRs use `!n`). */
  provider: ProviderWire.optional(),
});

export const FeedItem = z.object({
  id: z.string(),
  type: ActivityType,
  occurredAt: Timestamp,
  repo: RepoRef.nullable(),
  title: z.string(),
  url: z.url().nullable(),
  ref: EvidenceRef,
  /** Source provider; null for achievements (P13). */
  provider: ProviderWire.nullable().optional(),
  meta: z.record(z.string(), z.unknown()),
});
export type FeedItem = z.infer<typeof FeedItem>;

/**
 * `GET /activity/prs?role=` (F-18): PRs the user authored or PRs they reviewed (required).
 */
export const PullRequestRole = z.enum(['authored', 'reviewed']);
export type PullRequestRole = z.infer<typeof PullRequestRole>;

export const PullRequestListQuery = filter({
  role: PullRequestRole,
  state: z.enum(['open', 'merged', 'closed']).optional(),
  sort: z.enum(['-createdAt', '-mergedAt', '-changedLines']).default('-createdAt'),
});
export type PullRequestListQuery = z.infer<typeof PullRequestListQuery>;

export const PrStateWire = z.enum(['open', 'merged', 'closed']);
export const ReviewStateWire = z.enum(['approved', 'changes_requested', 'commented', 'dismissed']);
export type ReviewStateWire = z.infer<typeof ReviewStateWire>;

export const PullRequestListItem = z.object({
  id: Id,
  ref: EvidenceRef,
  repo: RepoRef,
  number: z.number().int(),
  title: z.string(),
  url: z.url().nullable(),
  state: PrStateWire,
  isDraft: z.boolean(),
  isAuthoredByUser: z.boolean(),
  authorLogin: z.string().nullable(),
  createdAt: Timestamp,
  readyAt: Timestamp,
  mergedAt: Timestamp.nullable(),
  closedAt: Timestamp.nullable(),
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
  changedFiles: z.number().int().nullable(),
  cycleTimeHours: z.number().nullable(),
  firstReviewHours: z.number().nullable(),
  reverted: z.boolean(),
  myReviews: z
    .object({ count: z.number().int(), latestState: ReviewStateWire.nullable() })
    .optional(),
});
export type PullRequestListItem = z.infer<typeof PullRequestListItem>;

export const ReviewItem = z.object({
  id: Id,
  ref: EvidenceRef,
  pullRequest: z.object({
    id: Id,
    repo: RepoRef,
    number: z.number().int(),
    title: z.string(),
    url: z.url().nullable(),
    authorLogin: z.string().nullable(),
  }),
  state: ReviewStateWire,
  submittedAt: Timestamp,
  commentsCount: z.number().int(),
  hasBody: z.boolean(),
  turnaroundHours: z.number().nullable(),
});
export type ReviewItem = z.infer<typeof ReviewItem>;

export const PullRequestDetail = PullRequestListItem.extend({
  body: z.string().nullable(),
  labels: z.array(z.string()),
  reviewersCount: z.number().int().nullable(),
  approvalsCount: z.number().int().nullable(),
  changesRequestedCount: z.number().int().nullable(),
  myReviews: z.array(ReviewItem),
  revertedByUrl: z.url().nullable(),
  achievementIds: z.array(Id),
});
export type PullRequestDetail = z.infer<typeof PullRequestDetail>;

export const ReviewListQuery = filter({
  state: ReviewStateWire.optional(),
});
export type ReviewListQuery = z.infer<typeof ReviewListQuery>;

export const CommitItem = z.object({
  id: Id,
  ref: EvidenceRef,
  repo: RepoRef,
  sha: z.string(),
  messageHeadline: z.string(),
  authoredAt: Timestamp,
  additions: z.number().int(),
  deletions: z.number().int(),
  branch: z.string(),
  associatedPrNumber: z.number().int().nullable(),
  url: z.url().nullable(),
});
export type CommitItem = z.infer<typeof CommitItem>;

export const CommitDetail = CommitItem.extend({ messageBody: z.string().nullable() });
export type CommitDetail = z.infer<typeof CommitDetail>;

// ── Issues (Jira / Linear, P13 — API_CONTRACT_V2 §22 A-8) ─────────────────────────────────────

export const IssueStatusWire = z.enum(['todo', 'in_progress', 'done', 'cancelled']);
export type IssueStatusWire = z.infer<typeof IssueStatusWire>;
export const IssuePriorityWire = z.enum(['urgent', 'high', 'medium', 'low', 'none']);
export type IssuePriorityWire = z.infer<typeof IssuePriorityWire>;

export const IssueListQuery = filter({
  status: IssueStatusWire.optional(),
  sort: z.enum(['-updatedAt', '-completedAt']).default('-updatedAt'),
});
export type IssueListQuery = z.infer<typeof IssueListQuery>;

export const IssueItem = z.object({
  id: Id,
  ref: EvidenceRef,
  provider: z.enum(['jira', 'linear']),
  key: z.string(),
  title: z.string(),
  url: z.url().nullable(),
  status: IssueStatusWire,
  statusName: z.string().nullable(),
  priority: IssuePriorityWire,
  storyPoints: z.number().nullable(),
  project: z.object({ key: z.string().nullable(), name: z.string().nullable() }),
  cycleName: z.string().nullable(),
  labels: z.array(z.string()),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  startedAt: Timestamp.nullable(),
  completedAt: Timestamp.nullable(),
  cycleTimeHours: z.number().nullable(),
});
export type IssueItem = z.infer<typeof IssueItem>;

export const IssueDetail = IssueItem.extend({
  canceledAt: Timestamp.nullable(),
  achievementIds: z.array(Id),
});
export type IssueDetail = z.infer<typeof IssueDetail>;
