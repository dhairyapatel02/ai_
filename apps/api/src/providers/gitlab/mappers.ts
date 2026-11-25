import type {
  NormalizedCommit,
  NormalizedPrState,
  NormalizedPullRequest,
  NormalizedRepository,
  NormalizedReview,
} from '@devimpact/shared';

/**
 * Pure GitLab → normalised DTO mappers (P13, D-030). GitLab ids are only unique per instance, so
 * every external id is prefixed with the instance host (`gitlab.com/123`). Merge requests map to
 * pull requests, MR notes (approvals, change requests, comments) to reviews.
 */

export interface GlUser {
  id: number;
  username: string;
  name?: string | null;
  avatar_url?: string | null;
  bot?: boolean;
}

export interface GlProject {
  id: number;
  path: string;
  path_with_namespace: string;
  namespace?: { full_path?: string } | null;
  visibility?: string;
  forked_from_project?: unknown;
  archived?: boolean;
  default_branch?: string | null;
  web_url?: string | null;
}

export interface GlMergeRequest {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description?: string | null;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  draft?: boolean;
  work_in_progress?: boolean;
  author: GlUser;
  labels?: string[];
  target_branch?: string | null;
  web_url?: string | null;
  created_at: string;
  updated_at?: string | null;
  merged_at?: string | null;
  closed_at?: string | null;
  changes_count?: string | null;
}

export interface GlNote {
  id: number;
  body: string;
  system: boolean;
  author: GlUser;
  created_at: string;
}

export interface GlCommit {
  id: string;
  title: string;
  message?: string | null;
  author_email?: string | null;
  authored_date: string;
  committed_date?: string | null;
  parent_ids?: string[];
  stats?: { additions?: number; deletions?: number } | null;
}

export const hostOf = (baseUrl: string): string => new URL(baseUrl).host;
export const glId = (host: string, kind: '' | 'mr/' | 'note/', id: number | string): string =>
  `${host}/${kind}${id}`;
/** `gitlab.com/42` → 42 (the numeric user/project id), or null. */
export function numericId(externalId: string | null | undefined): number | null {
  const match = /\/(\d+)$/.exec(externalId ?? '');
  return match ? Number(match[1]) : null;
}

export function mapProject(p: GlProject, host: string): NormalizedRepository {
  const fullName = p.path_with_namespace;
  return {
    externalId: glId(host, '', p.id),
    fullName,
    ownerLogin: p.namespace?.full_path ?? fullName.split('/').slice(0, -1).join('/'),
    name: p.path,
    isPrivate: p.visibility !== 'public',
    isFork: Boolean(p.forked_from_project),
    isArchived: Boolean(p.archived),
    defaultBranch: p.default_branch ?? null,
    htmlUrl: p.web_url ?? null,
    installationId: null,
  };
}

const date = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

export function mapMrState(state: GlMergeRequest['state']): NormalizedPrState {
  if (state === 'merged') return 'MERGED';
  if (state === 'closed') return 'CLOSED';
  return 'OPEN'; // opened, locked
}

/** Bots: GitLab's `bot` flag, project/group access-token bots and `*-bot` service accounts. */
export function isBot(user: GlUser): boolean {
  return (
    user.bot === true || /^(project|group)_\d+_bot/.test(user.username) || /-bot$/.test(user.username)
  );
}

export interface NotesAnalysis {
  readyForReviewAt: Date | null;
  /** Received-review aggregates (authored MRs): bots and the MR author excluded. */
  firstReviewAt: Date | null;
  reviewersCount: number;
  approvalsCount: number;
  changesRequestedCount: number;
  /** Reviews by the connected user (reviewed MRs). */
  myReviews: NormalizedReview[];
}

const APPROVED = /^approved this merge request$/i;
const UNAPPROVED = /^unapproved this merge request$/i;
const CHANGES = /^requested changes\b/i;
const READY = /^marked this merge request as \**ready\**$/i;
const REVIEW_REQUEST = /^requested review from (.+)$/i;

/**
 * Derives review signals from MR notes (system notes carry approvals, change requests, "marked as
 * ready" and review requests with their timestamps). The user's own comments become one
 * aggregated `COMMENTED` review per MR, so many small comments never inflate `reviews_submitted`.
 */
export function analyzeNotes(
  notes: GlNote[],
  options: { host: string; mrId: number; authorId: number; userId: number | null; username: string | null },
): NotesAnalysis {
  const sorted = [...notes].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  let readyForReviewAt: Date | null = null;
  let firstReviewAt: Date | null = null;
  const reviewers = new Set<number>();
  let approvals = 0;
  let changes = 0;
  const myReviews: NormalizedReview[] = [];
  let reviewRequestedAt: Date | null = null;
  const myComments: GlNote[] = [];

  for (const note of sorted) {
    const at = new Date(note.created_at);
    const body = note.body.trim();
    const mine = options.userId !== null && note.author.id === options.userId;
    if (note.system) {
      if (READY.test(body) && note.author.id === options.authorId) readyForReviewAt = at;
      const request = REVIEW_REQUEST.exec(body);
      if (request && options.username && request[1].split(/[\s,]+/).includes(`@${options.username}`)) {
        reviewRequestedAt ??= at;
      }
      const approved = APPROVED.test(body);
      const changed = CHANGES.test(body);
      if (UNAPPROVED.test(body) || (!approved && !changed)) continue;
      if (note.author.id !== options.authorId && !isBot(note.author)) {
        reviewers.add(note.author.id);
        firstReviewAt ??= at;
        if (approved) approvals++;
        else changes++;
      }
      if (mine && note.author.id !== options.authorId) {
        myReviews.push({
          externalId: glId(options.host, 'note/', note.id),
          state: approved ? 'APPROVED' : 'CHANGES_REQUESTED',
          submittedAt: at,
          hasBody: false,
          commentsCount: 0,
          reviewRequestedAt,
        });
      }
      continue;
    }
    if (note.author.id !== options.authorId && !isBot(note.author)) {
      reviewers.add(note.author.id);
      firstReviewAt ??= at;
    }
    if (mine && note.author.id !== options.authorId) myComments.push(note);
  }
  if (myComments.length > 0) {
    myReviews.push({
      externalId: `${glId(options.host, 'mr/', options.mrId)}/comments/${options.userId}`,
      state: 'COMMENTED',
      submittedAt: new Date(myComments[0].created_at),
      hasBody: true,
      commentsCount: myComments.length,
      reviewRequestedAt,
    });
  }
  return {
    readyForReviewAt,
    firstReviewAt,
    reviewersCount: reviewers.size,
    approvalsCount: approvals,
    changesRequestedCount: changes,
    myReviews,
  };
}

export function mapMergeRequest(
  mr: GlMergeRequest,
  repository: NormalizedRepository,
  options: { host: string; authored: boolean; notes: NotesAnalysis | null },
): NormalizedPullRequest {
  const state = mapMrState(mr.state);
  const mergedAt = date(mr.merged_at);
  const notes = options.notes;
  const changes = mr.changes_count ? Number.parseInt(mr.changes_count, 10) : NaN;
  return {
    externalId: glId(options.host, 'mr/', mr.id),
    repository,
    number: mr.iid,
    title: mr.title,
    body: options.authored ? (mr.description ?? null) : null,
    url: mr.web_url ?? null,
    state,
    isDraft: Boolean(mr.draft ?? mr.work_in_progress),
    authorExternalId: glId(options.host, '', mr.author.id),
    authorLogin: mr.author.username,
    labels: mr.labels ?? [],
    baseRef: mr.target_branch ?? null,
    createdAt: new Date(mr.created_at),
    updatedAt: date(mr.updated_at),
    mergedAt: state === 'MERGED' ? mergedAt : null,
    closedAt: date(mr.closed_at) ?? (state === 'MERGED' ? mergedAt : null),
    readyForReviewAt: notes?.readyForReviewAt ?? null,
    // GitLab's MR list carries no line counts; sizes stay unknown (KPI §2.6 "unknown size").
    additions: null,
    deletions: null,
    changedFiles: Number.isFinite(changes) ? changes : null,
    commitsCount: null,
    firstReviewAt: options.authored ? (notes?.firstReviewAt ?? null) : null,
    reviewersCount: options.authored && notes ? notes.reviewersCount : null,
    approvalsCount: options.authored && notes ? notes.approvalsCount : null,
    changesRequestedCount: options.authored && notes ? notes.changesRequestedCount : null,
    isRevert: /^Revert "/.test(mr.title),
    revertedAt: null,
    revertedByUrl: null,
  };
}

/** `See merge request group/project!12` in a merge commit message → 12. */
export function mergeRequestNumberOf(message: string | null | undefined): number | null {
  const match = /See merge request [^\s!]+!(\d+)/.exec(message ?? '');
  return match ? Number(match[1]) : null;
}

export function mapCommit(
  c: GlCommit,
  repositoryExternalId: string,
  branch: string,
  authorExternalId: string | null,
): NormalizedCommit {
  const lines = (c.message ?? c.title).split('\n');
  const body = lines.slice(1).join('\n').trim();
  return {
    sha: c.id,
    repositoryExternalId,
    messageHeadline: c.title,
    messageBody: body === '' ? null : body,
    branch,
    authoredAt: new Date(c.authored_date),
    committedAt: date(c.committed_date),
    additions: c.stats?.additions ?? 0,
    deletions: c.stats?.deletions ?? 0,
    changedFiles: null,
    parentsCount: c.parent_ids?.length ?? 1,
    associatedPrNumber: mergeRequestNumberOf(c.message),
    authorExternalId,
  };
}
