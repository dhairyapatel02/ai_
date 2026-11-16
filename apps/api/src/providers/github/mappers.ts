import type {
  NormalizedCommit,
  NormalizedPrState,
  NormalizedPullRequest,
  NormalizedRepository,
  NormalizedReview,
  NormalizedReviewState,
  NormalizedReviewedPullRequest,
} from '@devimpact/shared';

/**
 * Pure GraphQL → normalised DTO mappers (unit-tested in mappers.spec.ts). Field semantics follow
 * KPI_METHODOLOGY §2.2/§3 and DATA_MODEL_V2 §4.
 */

export interface GqlActor {
  __typename?: string;
  login?: string;
  id?: string;
}

export interface GqlRepository {
  id: string;
  nameWithOwner: string;
  name: string;
  owner: { login: string };
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  url: string | null;
  defaultBranchRef: { name: string } | null;
}

interface GqlTimelineNode {
  __typename: string;
  createdAt?: string;
  source?: {
    __typename: string;
    title?: string;
    url?: string;
    state?: string;
    mergedAt?: string | null;
    repository?: { id: string };
  };
  requestedReviewer?: { __typename: string; login?: string; slug?: string } | null;
}

export interface GqlPullRequest {
  id: string;
  number: number;
  title: string;
  url: string | null;
  state: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  baseRefName: string | null;
  author: GqlActor | null;
  repository: GqlRepository;
  body?: string | null;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  commits?: { totalCount: number };
  labels?: { nodes: { name: string }[] };
  reviews?: { nodes: { state: string; submittedAt: string | null; author: GqlActor | null }[] };
  myReviews?: {
    nodes: {
      id: string;
      state: string;
      submittedAt: string | null;
      body: string | null;
      comments: { totalCount: number };
    }[];
  };
  timelineItems?: { nodes: (GqlTimelineNode | null)[] };
  requests?: { nodes: (GqlTimelineNode | null)[] };
}

export interface GqlCommit {
  oid: string;
  messageHeadline: string;
  messageBody: string | null;
  authoredDate: string;
  committedDate: string | null;
  additions: number;
  deletions: number;
  changedFilesIfAvailable: number | null;
  parents: { totalCount: number };
  associatedPullRequests: { nodes: { number: number }[] } | null;
  author: { user: { id: string } | null } | null;
}

const date = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

/** Bot account = `__typename` Bot or a login ending with `[bot]` (KPI_METHODOLOGY §2.2). */
export function isBot(actor: GqlActor | null | undefined): boolean {
  if (!actor) return false;
  return actor.__typename === 'Bot' || (actor.login ?? '').endsWith('[bot]');
}

export function prState(state: string, mergedAt: string | null): NormalizedPrState {
  if (state === 'MERGED' || mergedAt) return 'MERGED';
  return state === 'CLOSED' ? 'CLOSED' : 'OPEN';
}

export function reviewState(state: string): NormalizedReviewState | null {
  switch (state) {
    case 'APPROVED':
    case 'CHANGES_REQUESTED':
    case 'COMMENTED':
    case 'DISMISSED':
      return state;
    default:
      return null; // PENDING reviews are drafts and never stored
  }
}

export function mapRepository(
  node: GqlRepository,
  installationId: string | null = null,
): NormalizedRepository {
  return {
    externalId: node.id,
    fullName: node.nameWithOwner,
    ownerLogin: node.owner.login,
    name: node.name,
    isPrivate: node.isPrivate,
    isFork: node.isFork,
    isArchived: node.isArchived,
    defaultBranch: node.defaultBranchRef?.name ?? null,
    htmlUrl: node.url,
    installationId,
  };
}

function timeline(node: GqlPullRequest, key: 'timelineItems' | 'requests' = 'timelineItems') {
  return (node[key]?.nodes ?? []).filter((n): n is GqlTimelineNode => n !== null);
}

function baseFields(node: GqlPullRequest): NormalizedPullRequest {
  return {
    externalId: node.id,
    repository: mapRepository(node.repository),
    number: node.number,
    title: node.title,
    body: null,
    url: node.url,
    state: prState(node.state, node.mergedAt),
    isDraft: node.isDraft,
    authorExternalId: node.author?.id ?? null,
    authorLogin: node.author?.login ?? null,
    labels: [],
    baseRef: node.baseRefName,
    createdAt: new Date(node.createdAt),
    updatedAt: date(node.updatedAt),
    mergedAt: date(node.mergedAt),
    closedAt: date(node.closedAt),
    readyForReviewAt: null,
    additions: null,
    deletions: null,
    changedFiles: null,
    commitsCount: null,
    firstReviewAt: null,
    reviewersCount: null,
    approvalsCount: null,
    changesRequestedCount: null,
    isRevert: node.title.startsWith('Revert "'),
    revertedAt: null,
    revertedByUrl: null,
  };
}

/**
 * A PR authored by the user. Received-review aggregates ignore bots, the author and pending
 * reviews: `firstReviewAt` = earliest such review; `reviewersCount` = distinct reviewers;
 * `approvalsCount` = distinct reviewers who approved; `changesRequestedCount` = number of
 * CHANGES_REQUESTED reviews. Reverted when a merged PR in the same repository titled
 * `Revert "…"` cross-references it (KPI_METHODOLOGY §3.2).
 */
export function mapAuthoredPullRequest(node: GqlPullRequest): NormalizedPullRequest {
  const pr = baseFields(node);
  const authorLogin = node.author?.login ?? null;
  const received = (node.reviews?.nodes ?? []).filter(
    (r): r is typeof r & { submittedAt: string } =>
      r.submittedAt !== null &&
      reviewState(r.state) !== null &&
      !isBot(r.author) &&
      (r.author?.login ?? null) !== authorLogin,
  );
  const times = received.map((r) => new Date(r.submittedAt).getTime());
  const reviewers = new Set(received.map((r) => r.author?.login ?? '?'));
  const approvers = new Set(
    received.filter((r) => r.state === 'APPROVED').map((r) => r.author?.login ?? '?'),
  );

  const events = timeline(node);
  const ready = events
    .filter((e) => e.__typename === 'ReadyForReviewEvent')
    .flatMap((e) => (e.createdAt ? [new Date(e.createdAt).getTime()] : []));
  const reverts = events
    .filter(
      (e) =>
        e.__typename === 'CrossReferencedEvent' &&
        e.source?.__typename === 'PullRequest' &&
        e.source.mergedAt &&
        (e.source.title ?? '').startsWith('Revert "') &&
        e.source.repository?.id === node.repository.id,
    )
    .sort((a, b) => Date.parse(a.source?.mergedAt ?? '') - Date.parse(b.source?.mergedAt ?? ''));
  const revert = reverts[0]?.source;

  return {
    ...pr,
    body: node.body ?? null,
    labels: (node.labels?.nodes ?? []).map((l) => l.name),
    readyForReviewAt: ready.length ? new Date(Math.min(...ready)) : null,
    additions: node.additions ?? null,
    deletions: node.deletions ?? null,
    changedFiles: node.changedFiles ?? null,
    commitsCount: node.commits?.totalCount ?? null,
    firstReviewAt: times.length ? new Date(Math.min(...times)) : null,
    reviewersCount: reviewers.size,
    approvalsCount: approvers.size,
    changesRequestedCount: received.filter((r) => r.state === 'CHANGES_REQUESTED').length,
    revertedAt: revert?.mergedAt ? new Date(revert.mergedAt) : null,
    revertedByUrl: revert?.url ?? null,
  };
}

/**
 * A PR the user reviewed: metadata only (no body, no size, no other people's reviews) plus the
 * user's own non-pending reviews. `reviewRequestedAt` = earliest review request for the user (or a
 * team) at or before the review.
 */
export function mapReviewedPullRequest(
  node: GqlPullRequest,
  login: string,
  timelineKey: 'timelineItems' | 'requests' = 'timelineItems',
): NormalizedReviewedPullRequest {
  const requests = timeline(node, timelineKey)
    .filter(
      (e) =>
        e.__typename === 'ReviewRequestedEvent' &&
        e.createdAt &&
        (e.requestedReviewer?.__typename === 'Team' ||
          (e.requestedReviewer?.login ?? '').toLowerCase() === login.toLowerCase()),
    )
    .flatMap((e) => (e.createdAt ? [new Date(e.createdAt).getTime()] : []))
    .sort((a, b) => a - b);

  const reviews: NormalizedReview[] = [];
  for (const r of node.myReviews?.nodes ?? []) {
    const state = reviewState(r.state);
    if (!state || !r.submittedAt) continue;
    const submittedAt = new Date(r.submittedAt);
    const requestedAt = requests.find((t) => t <= submittedAt.getTime());
    reviews.push({
      externalId: r.id,
      state,
      submittedAt,
      hasBody: (r.body ?? '').trim().length > 0,
      commentsCount: r.comments.totalCount,
      reviewRequestedAt: requestedAt !== undefined ? new Date(requestedAt) : null,
    });
  }
  return { pullRequest: baseFields(node), reviews };
}

export function mapCommit(
  node: GqlCommit,
  repositoryExternalId: string,
  branch: string,
): NormalizedCommit {
  return {
    sha: node.oid,
    repositoryExternalId,
    messageHeadline: node.messageHeadline,
    messageBody: node.messageBody?.trim() ? node.messageBody.replace(/^\s*\n/, '').trimEnd() : null,
    branch,
    authoredAt: new Date(node.authoredDate),
    committedAt: date(node.committedDate),
    additions: node.additions,
    deletions: node.deletions,
    changedFiles: node.changedFilesIfAvailable ?? null,
    parentsCount: node.parents.totalCount,
    associatedPrNumber: node.associatedPullRequests?.nodes[0]?.number ?? null,
    authorExternalId: node.author?.user?.id ?? null,
  };
}

/**
 * `updated:` qualifier value for GitHub search: inclusive ISO range at second precision, widened
 * outwards (floor/ceil) so nothing updated within the boundary seconds is missed.
 */
export function searchRange(from: Date, to: Date): string {
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `${fmt(Math.floor(from.getTime() / 1000) * 1000)}..${fmt(Math.ceil(to.getTime() / 1000) * 1000)}`;
}

/** Splits a window in two halves (search results are capped at 1,000 per query). */
export function splitWindow(from: Date, to: Date): [[Date, Date], [Date, Date]] {
  const mid = new Date(Math.floor((from.getTime() + to.getTime()) / 2));
  return [
    [from, mid],
    [new Date(mid.getTime() + 1000), to],
  ];
}
