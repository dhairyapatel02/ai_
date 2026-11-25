import {
  addDays,
  businessHours,
  isoWeekKey,
  isoWeekday,
  localDateOf,
  metricMeta,
  type ImplementedMetricKey,
} from '@devimpact/shared';

/**
 * `metrics@2.1.0` (2.0.0 + the §3.6 issue metrics, P13) — one pure function per metric (KPI_METHODOLOGY §3, ADR-0008). Inputs are
 * normalised fact rows (already filtered to the user, included repositories, non-stub PRs and
 * non-merge commits by the repository layer) and a metric window; outputs are the value, sample
 * size and evidence ids. No I/O, no clock: same inputs → same output, byte for byte.
 */

/** `AP` — a PR the user authored (`isAuthoredByUser = true`, `legacyStub = false`). */
export interface AuthoredPrFact {
  id: string;
  /** Source provider (`github`, `gitlab`, `jira`, `linear`) — rollup dimension only. */
  provider?: string;
  repositoryId: string;
  createdAt: Date;
  /** `readyForReviewAt` if the PR was ever a draft, else `createdAt` (§2.3). */
  readyAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
  /** `additions + deletions`, null when GitHub did not report the size. */
  changedLines: number | null;
  changesRequestedCount: number | null;
  firstReviewAt: Date | null;
  revertedAt: Date | null;
}

/** `RV` — a review the user submitted on someone else's PR (`RP`). */
export interface ReviewFact {
  id: string;
  /** Source provider (`github`, `gitlab`, `jira`, `linear`) — rollup dimension only. */
  provider?: string;
  pullRequestId: string;
  repositoryId: string;
  submittedAt: Date;
  reviewRequestedAt: Date | null;
  commentsCount: number;
  hasBody: boolean;
}

/** `CM` — a default-branch commit by the user with ≤ 1 parent. */
export interface CommitFact {
  id: string;
  /** Source provider (`github`, `gitlab`, `jira`, `linear`) — rollup dimension only. */
  provider?: string;
  repositoryId: string;
  authoredAt: Date;
}

/** `IS` — an issue assigned to the user (Jira / Linear, KPI §3.6, P13). */
export interface IssueFact {
  id: string;
  /** Source provider (`github`, `gitlab`, `jira`, `linear`) — rollup dimension only. */
  provider?: string;
  /** Set only for status DONE (cancelled issues are never completed). */
  completedAt: Date | null;
  startedAt: Date | null;
  storyPoints: number | null;
}

export interface Facts {
  authored: AuthoredPrFact[];
  reviews: ReviewFact[];
  commits: CommitFact[];
  /** Issue-tracker facts (metrics@2.1.0); absent = no issues. */
  issues?: IssueFact[];
}

/** A period as the engine sees it: local dates + their half-open UTC instants. */
export interface MetricWindow {
  start: Date;
  endExclusive: Date;
  startDate: string;
  /** Last local date (inclusive); "today" for an in-progress period. */
  endDate: string;
  timezone: string;
  /** Full calendar length of the period (§2.6). */
  periodDays: number;
}

export type MetricStatusValue = 'ok' | 'insufficient_data';

export interface MetricResult {
  value: number | null;
  n: number;
  status: MetricStatusValue;
  /** Ids of the records in the numerator/sample, newest first, at most 200 (§7). */
  evidence: string[];
  evidenceTruncated: boolean;
}

export const EVIDENCE_CAP = 200;
export const SMALL_PR_MAX_LINES = 400;

// ── Helpers (§2.6) ─────────────────────────────────────────────────────────────────────────

/** Middle value of `values`; mean of the two middle values for even sizes; null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface Ev {
  id: string;
  at: Date;
}

/** Newest first (ties by id, descending), capped at 200. */
function evidenceOf(items: Ev[]): Pick<MetricResult, 'evidence' | 'evidenceTruncated'> {
  const unique = new Map<string, number>();
  for (const item of items) {
    const t = item.at.getTime();
    const prev = unique.get(item.id);
    if (prev === undefined || t > prev) unique.set(item.id, t);
  }
  const sorted = [...unique.entries()].sort((a, b) =>
    b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0,
  );
  return {
    evidence: sorted.slice(0, EVIDENCE_CAP).map(([id]) => id),
    evidenceTruncated: sorted.length > EVIDENCE_CAP,
  };
}

function result(
  key: ImplementedMetricKey,
  value: number | null,
  n: number,
  evidence: Ev[],
): MetricResult {
  const { minN } = metricMeta(key);
  const insufficient = value === null || n < minN;
  return {
    value: insufficient ? null : value,
    n,
    status: insufficient ? 'insufficient_data' : 'ok',
    ...evidenceOf(evidence),
  };
}

// ── Prepared context: the record sets of §2.2 restricted to the window ─────────────────────

interface Contribution {
  id: string;
  at: Date;
  date: string;
}

type MergedPr = AuthoredPrFact & { mergedAt: Date };
type FirstReviewedPr = AuthoredPrFact & { firstReviewAt: Date };
type SizedPr = MergedPr & { changedLines: number };

export interface MetricContext {
  window: MetricWindow;
  /** AP by createdAt ∈ period. */
  opened: AuthoredPrFact[];
  /** AP_m: AP by mergedAt ∈ period. */
  merged: MergedPr[];
  /** U: AP closed unmerged in period. */
  closedUnmerged: AuthoredPrFact[];
  /** AP by firstReviewAt ∈ period. */
  firstReviewed: FirstReviewedPr[];
  /** RV with submittedAt ∈ period. */
  reviews: ReviewFact[];
  /** One entry per PR counted in prs_reviewed: r₁ (earliest review in period) and all reviews. */
  reviewedPrs: {
    pullRequestId: string;
    repositoryId: string;
    first: ReviewFact;
    all: ReviewFact[];
  }[];
  /** CM with authoredAt ∈ period. */
  commits: CommitFact[];
  /** Contributions for active days/weeks: CM ∪ AP opened ∪ RV, with local dates. */
  contributions: Contribution[];
  /** W: ISO weeks with ≥ 1 weekday inside the period, in order. */
  workingWeeks: string[];
  /** IS_c: issues with completedAt ∈ period (§3.6). */
  completedIssues: (IssueFact & { completedAt: Date })[];
}

const inWindow = (t: Date | null, w: MetricWindow): t is Date =>
  t !== null && t.getTime() >= w.start.getTime() && t.getTime() < w.endExclusive.getTime();

export function prepareContext(facts: Facts, window: MetricWindow): MetricContext {
  const opened = facts.authored.filter((p) => inWindow(p.createdAt, window));
  const merged = facts.authored.filter((p): p is MergedPr => inWindow(p.mergedAt, window));
  const closedUnmerged = facts.authored.filter(
    (p) => p.mergedAt === null && inWindow(p.closedAt, window),
  );
  const firstReviewed = facts.authored.filter((p): p is FirstReviewedPr =>
    inWindow(p.firstReviewAt, window),
  );
  const reviews = facts.reviews.filter((r) => inWindow(r.submittedAt, window));
  const commits = facts.commits.filter((c) => inWindow(c.authoredAt, window));

  const byPr = new Map<string, ReviewFact[]>();
  for (const r of reviews) {
    const list = byPr.get(r.pullRequestId);
    if (list) list.push(r);
    else byPr.set(r.pullRequestId, [r]);
  }
  const reviewedPrs = [...byPr.entries()]
    .map(([pullRequestId, all]) => {
      const sorted = [...all].sort((a, b) =>
        a.submittedAt.getTime() !== b.submittedAt.getTime()
          ? a.submittedAt.getTime() - b.submittedAt.getTime()
          : a.id < b.id
            ? -1
            : 1,
      );
      const first = sorted[0];
      return { pullRequestId, repositoryId: first.repositoryId, first, all: sorted };
    })
    .sort((a, b) => (a.pullRequestId < b.pullRequestId ? -1 : 1));

  const tz = window.timezone;
  const contributions: Contribution[] = [
    ...commits.map((c) => ({ id: c.id, at: c.authoredAt })),
    ...opened.map((p) => ({ id: p.id, at: p.createdAt })),
    ...reviews.map((r) => ({ id: r.id, at: r.submittedAt })),
  ].map((c) => ({ ...c, date: localDateOf(c.at, tz) }));

  const workingWeeks: string[] = [];
  for (let d = window.startDate; d <= window.endDate; d = addDays(d, 1)) {
    if (isoWeekday(d) <= 5) {
      const key = isoWeekKey(d);
      if (workingWeeks[workingWeeks.length - 1] !== key) workingWeeks.push(key);
    }
  }

  const completedIssues = (facts.issues ?? []).filter(
    (i): i is IssueFact & { completedAt: Date } => inWindow(i.completedAt, window),
  );

  return {
    window,
    completedIssues,
    opened,
    merged,
    closedUnmerged,
    firstReviewed,
    reviews,
    reviewedPrs,
    commits,
    contributions,
    workingWeeks,
  };
}

const hours = (a: Date, b: Date, w: MetricWindow) => businessHours(a, b, w.timezone);

/** Active weeks of W and the newest contribution of each (shared by two metrics). */
function activeWeeks(ctx: MetricContext): Map<string, Contribution> {
  const weeks = new Set(ctx.workingWeeks);
  const active = new Map<string, Contribution>();
  for (const c of ctx.contributions) {
    const key = isoWeekKey(c.date);
    if (!weeks.has(key)) continue;
    const prev = active.get(key);
    if (!prev || c.at > prev.at || (c.at.getTime() === prev.at.getTime() && c.id > prev.id)) {
      active.set(key, c);
    }
  }
  return active;
}

/** One representative (newest) record per repository. */
function perRepo(items: { repositoryId: string; id: string; at: Date }[]): Map<string, Ev> {
  const repos = new Map<string, Ev>();
  for (const item of items) {
    const prev = repos.get(item.repositoryId);
    if (
      !prev ||
      item.at > prev.at ||
      (item.at.getTime() === prev.at.getTime() && item.id > prev.id)
    ) {
      repos.set(item.repositoryId, { id: item.id, at: item.at });
    }
  }
  return repos;
}

const mergedEv = (p: MergedPr): Ev => ({ id: p.id, at: p.mergedAt });
const firstReviewEv = (rp: MetricContext['reviewedPrs'][number]): Ev => ({
  id: rp.first.id,
  at: rp.first.submittedAt,
});

// ── The catalogue ──────────────────────────────────────────────────────────────────────────

type MetricFn = (ctx: MetricContext) => MetricResult;

/** §3.1 Delivery. */
export const prsMerged: MetricFn = (ctx) =>
  result('prs_merged', ctx.merged.length, ctx.merged.length, ctx.merged.map(mergedEv));

export const prsOpened: MetricFn = (ctx) =>
  result(
    'prs_opened',
    ctx.opened.length,
    ctx.opened.length,
    ctx.opened.map((p) => ({ id: p.id, at: p.createdAt })),
  );

export const prCycleTimeMedianHours: MetricFn = (ctx) => {
  const sample = ctx.merged.map((p) => hours(p.readyAt, p.mergedAt, ctx.window));
  return result(
    'pr_cycle_time_median_hours',
    median(sample),
    sample.length,
    ctx.merged.map(mergedEv),
  );
};

export const mergeRate: MetricFn = (ctx) => {
  const m = ctx.merged.length;
  const n = m + ctx.closedUnmerged.length;
  return result('merge_rate', n === 0 ? null : m / n, n, ctx.merged.map(mergedEv));
};

/** §3.2 Quality. PRs without a reported size are left out of size-based samples. */
const sized = (ctx: MetricContext) =>
  ctx.merged.filter((p): p is SizedPr => p.changedLines !== null);

export const smallPrRatio: MetricFn = (ctx) => {
  const sample = sized(ctx);
  const small = sample.filter((p) => p.changedLines <= SMALL_PR_MAX_LINES);
  return result(
    'small_pr_ratio',
    sample.length === 0 ? null : small.length / sample.length,
    sample.length,
    small.map(mergedEv),
  );
};

export const revertRate: MetricFn = (ctx) => {
  const reverted = ctx.merged.filter((p) => p.revertedAt !== null);
  const n = ctx.merged.length;
  return result('revert_rate', n === 0 ? null : reverted.length / n, n, reverted.map(mergedEv));
};

export const prSizeMedianLines: MetricFn = (ctx) => {
  const sample = sized(ctx);
  return result(
    'pr_size_median_lines',
    median(sample.map((p) => p.changedLines)),
    sample.length,
    sample.map(mergedEv),
  );
};

export const firstPassApprovalRate: MetricFn = (ctx) => {
  const sample = ctx.merged.filter((p) => p.changesRequestedCount !== null);
  const pass = sample.filter((p) => p.changesRequestedCount === 0);
  return result(
    'first_pass_approval_rate',
    sample.length === 0 ? null : pass.length / sample.length,
    sample.length,
    pass.map(mergedEv),
  );
};

/** §3.3 Collaboration. */
export const prsReviewed: MetricFn = (ctx) =>
  result(
    'prs_reviewed',
    ctx.reviewedPrs.length,
    ctx.reviewedPrs.length,
    ctx.reviewedPrs.map(firstReviewEv),
  );

export const reviewTurnaroundMedianHours: MetricFn = (ctx) => {
  const requested = ctx.reviewedPrs.flatMap((rp) =>
    rp.first.reviewRequestedAt ? [{ rp, requestedAt: rp.first.reviewRequestedAt }] : [],
  );
  const sample = requested.map(({ rp, requestedAt }) =>
    hours(requestedAt, rp.first.submittedAt, ctx.window),
  );
  return result(
    'review_turnaround_median_hours',
    median(sample),
    sample.length,
    requested.map(({ rp }) => firstReviewEv(rp)),
  );
};

export const reviewBalance: MetricFn = (ctx) => {
  const reviewed = ctx.reviewedPrs.length;
  const n = reviewed + ctx.merged.length;
  return result('review_balance', n === 0 ? null : reviewed / n, n, [
    ...ctx.reviewedPrs.map(firstReviewEv),
    ...ctx.merged.map(mergedEv),
  ]);
};

export const timeToFirstReviewMedianHours: MetricFn = (ctx) => {
  const sample = ctx.firstReviewed.map((p) => hours(p.readyAt, p.firstReviewAt, ctx.window));
  return result(
    'time_to_first_review_median_hours',
    median(sample),
    sample.length,
    ctx.firstReviewed.map((p) => ({ id: p.id, at: p.firstReviewAt })),
  );
};

export const reviewDepthMedian: MetricFn = (ctx) => {
  const sample = ctx.reviewedPrs.map((rp) =>
    rp.all.reduce((sum, r) => sum + r.commentsCount + (r.hasBody ? 1 : 0), 0),
  );
  return result(
    'review_depth_median',
    median(sample),
    sample.length,
    ctx.reviewedPrs.map(firstReviewEv),
  );
};

export const reposReviewed: MetricFn = (ctx) => {
  const repos = perRepo(
    ctx.reviewedPrs.map((rp) => ({
      repositoryId: rp.repositoryId,
      id: rp.first.id,
      at: rp.first.submittedAt,
    })),
  );
  return result('repos_reviewed', repos.size, repos.size, [...repos.values()]);
};

/** §3.4 Ownership. */
export const reposContributed: MetricFn = (ctx) => {
  const repos = perRepo([
    ...ctx.commits.map((c) => ({ repositoryId: c.repositoryId, id: c.id, at: c.authoredAt })),
    ...ctx.opened.map((p) => ({ repositoryId: p.repositoryId, id: p.id, at: p.createdAt })),
    ...ctx.merged.map((p) => ({ repositoryId: p.repositoryId, id: p.id, at: p.mergedAt })),
    ...ctx.reviewedPrs.map((rp) => ({
      repositoryId: rp.repositoryId,
      id: rp.first.id,
      at: rp.first.submittedAt,
    })),
  ]);
  return result('repos_contributed', repos.size, repos.size, [...repos.values()]);
};

export const twoWayRepos: MetricFn = (ctx) => {
  const mergedRepos = perRepo(
    ctx.merged.map((p) => ({ repositoryId: p.repositoryId, id: p.id, at: p.mergedAt })),
  );
  const reviewedRepos = perRepo(
    ctx.reviewedPrs.map((rp) => ({
      repositoryId: rp.repositoryId,
      id: rp.first.id,
      at: rp.first.submittedAt,
    })),
  );
  const evidence: Ev[] = [];
  let count = 0;
  for (const [repo, ev] of mergedRepos) {
    const review = reviewedRepos.get(repo);
    if (!review) continue;
    count++;
    evidence.push(ev, review);
  }
  return result('two_way_repos', count, count, evidence);
};

export const reposWithMergedPrs: MetricFn = (ctx) => {
  const repos = perRepo(
    ctx.merged.map((p) => ({ repositoryId: p.repositoryId, id: p.id, at: p.mergedAt })),
  );
  return result('repos_with_merged_prs', repos.size, repos.size, [...repos.values()]);
};

/** §3.5 Consistency. */
export const activeDays: MetricFn = (ctx) => {
  const days = new Map<string, Contribution>();
  for (const c of ctx.contributions) {
    const prev = days.get(c.date);
    if (!prev || c.at > prev.at || (c.at.getTime() === prev.at.getTime() && c.id > prev.id)) {
      days.set(c.date, c);
    }
  }
  return result('active_days', days.size, days.size, [...days.values()]);
};

export const activeWeeksRatio: MetricFn = (ctx) => {
  const active = activeWeeks(ctx);
  const total = ctx.workingWeeks.length;
  return result('active_weeks_ratio', total === 0 ? null : active.size / total, total, [
    ...active.values(),
  ]);
};

export const commits: MetricFn = (ctx) =>
  result(
    'commits',
    ctx.commits.length,
    ctx.commits.length,
    ctx.commits.map((c) => ({ id: c.id, at: c.authoredAt })),
  );

export const longestActiveWeekStreak: MetricFn = (ctx) => {
  const active = activeWeeks(ctx);
  let best: string[] = [];
  let run: string[] = [];
  for (const week of ctx.workingWeeks) {
    if (active.has(week)) {
      run.push(week);
      if (run.length > best.length) best = [...run];
    } else {
      run = [];
    }
  }
  return result(
    'longest_active_week_streak',
    best.length,
    ctx.workingWeeks.length,
    best.flatMap((week) => {
      const c = active.get(week);
      return c ? [c] : [];
    }),
  );
};

/** §3.6 Issues (Jira / Linear) — informational, never in the impact score. */
const issueEv = (i: IssueFact & { completedAt: Date }): Ev => ({ id: i.id, at: i.completedAt });

export const issuesCompleted: MetricFn = (ctx) =>
  result(
    'issues_completed',
    ctx.completedIssues.length,
    ctx.completedIssues.length,
    ctx.completedIssues.map(issueEv),
  );

export const storyPointsCompleted: MetricFn = (ctx) => {
  const pointed = ctx.completedIssues.filter((i) => i.storyPoints !== null);
  const total = pointed.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  return result(
    'story_points_completed',
    Math.round(total * 100) / 100,
    pointed.length,
    pointed.map(issueEv),
  );
};

export const issueCycleTimeMedianHours: MetricFn = (ctx) => {
  const started = ctx.completedIssues.filter(
    (i): i is IssueFact & { completedAt: Date; startedAt: Date } =>
      i.startedAt !== null && i.startedAt.getTime() <= i.completedAt.getTime(),
  );
  const sample = started.map((i) => hours(i.startedAt, i.completedAt, ctx.window));
  return result('issue_cycle_time_median_hours', median(sample), sample.length, started.map(issueEv));
};

export const METRIC_FUNCTIONS: Record<ImplementedMetricKey, MetricFn> = {
  prs_merged: prsMerged,
  prs_opened: prsOpened,
  pr_cycle_time_median_hours: prCycleTimeMedianHours,
  merge_rate: mergeRate,
  small_pr_ratio: smallPrRatio,
  revert_rate: revertRate,
  pr_size_median_lines: prSizeMedianLines,
  first_pass_approval_rate: firstPassApprovalRate,
  prs_reviewed: prsReviewed,
  review_turnaround_median_hours: reviewTurnaroundMedianHours,
  review_balance: reviewBalance,
  time_to_first_review_median_hours: timeToFirstReviewMedianHours,
  review_depth_median: reviewDepthMedian,
  repos_reviewed: reposReviewed,
  repos_contributed: reposContributed,
  two_way_repos: twoWayRepos,
  repos_with_merged_prs: reposWithMergedPrs,
  active_days: activeDays,
  active_weeks_ratio: activeWeeksRatio,
  commits,
  longest_active_week_streak: longestActiveWeekStreak,
  issues_completed: issuesCompleted,
  story_points_completed: storyPointsCompleted,
  issue_cycle_time_median_hours: issueCycleTimeMedianHours,
};

export type MetricResults = Record<ImplementedMetricKey, MetricResult>;

/** Every implemented metric for one window. */
export function computeMetrics(facts: Facts, window: MetricWindow): MetricResults {
  const ctx = prepareContext(facts, window);
  const out = {} as MetricResults;
  for (const key of Object.keys(METRIC_FUNCTIONS) as ImplementedMetricKey[]) {
    out[key] = METRIC_FUNCTIONS[key](ctx);
  }
  return out;
}

/** One metric for one window (timeseries buckets). */
export function computeMetric(
  key: ImplementedMetricKey,
  facts: Facts,
  window: MetricWindow,
): MetricResult {
  return METRIC_FUNCTIONS[key](prepareContext(facts, window));
}
