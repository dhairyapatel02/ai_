import { localRangeToUtc } from '@devimpact/shared';

import type {
  AuthoredPrFact,
  CommitFact,
  Facts,
  MetricWindow,
  ReviewFact,
} from '../../../src/metrics/metric-definitions';

/**
 * GOLDEN DATASET (KPI_METHODOLOGY §10.1) — user in UTC, period `month:2026-10` (Oct 1–31, 31 days;
 * Oct 1 is a Thursday). Repos R1, R2, R3. All expected values below were computed by hand.
 *
 * Authored PRs (AP)                         created            ready              merged/closed       lines  CR  firstReview      reverted
 *   P1 R1                                    Mon 10-05 09:00    = created          M Mon 10-05 15:00    120    0   Mon 10-05 11:00  –
 *   P2 R1 (was a draft)                      Thu 10-08 10:00    Fri 10-09 16:00    M Mon 10-12 10:00    450    1   Mon 10-12 09:00  10-20
 *   P3 R2                                    Wed 10-14 09:00    = created          M Wed 10-14 21:00     40    0   Wed 10-14 10:00  –
 *   P4 R1 (opened in September)              Mon 09-28 09:00    = created          M Thu 10-01 09:00   null null  Tue 09-29 09:00  –
 *   P5 R2                                    Tue 10-13 09:00    = created          C Thu 10-22 12:00    (closed unmerged)
 *   P6 R3 (still open)                       Tue 10-27 08:00    = created          –                    –      –   Wed 10-28 08:00  –
 *   P7 R1 (merged in November)               Fri 10-30 12:00    = created          M Mon 11-02 10:00    –
 *
 * Reviews by the user (RV) on others' PRs (RP)   submitted          requested          comments  body
 *   Q1 R1  rA                                    Tue 10-06 14:00    Tue 10-06 10:00    2         yes
 *          rB                                    Wed 10-07 09:00    –                  1         no
 *   Q2 R2  rD (September, outside the period)    Wed 09-30 12:00    –                  3         no
 *          rC                                    Fri 10-16 18:00    Fri 10-16 12:00    0         yes
 *   Q3 R3  rE                                    Mon 10-26 11:00    Fri 10-23 17:00    5         no
 *   Q4 R1  rF                                    Wed 10-28 10:00    –                  0         no
 *   Q5 R2  rG (November)                         Tue 11-03 10:00    –                  0         no
 *
 * Commits (CM): C1 R1 Fri 10-02 10:00 · C2 R1 Mon 10-05 08:00 · C3 R3 Tue 10-13 10:00 ·
 *               C4 R2 Sat 10-31 10:00 · C5 R1 Sun 11-01 10:00 (outside)
 *
 * Hand-computed metrics:
 *   prs_merged = |{P1,P2,P3,P4}| = 4 · prs_opened = |{P1,P2,P3,P5,P6,P7}| = 6
 *   cycle (business h): P1 6 · P2 Fri 16–24 (8) + Mon 0–10 (10) = 18 · P3 12 ·
 *     P4 Mon 15 + Tue 24 + Wed 24 + Thu 9 = 72 → median(6,12,18,72) = 15, n = 4
 *   merge_rate = 4 / (4 + 1) = 0.8, n = 5
 *   small_pr_ratio: sized merged = P1 120, P2 450, P3 40 (P4 unknown) → 2/3, n = 3
 *   revert_rate = 1/4 = 0.25 · pr_size_median_lines = median(40,120,450) = 120, n = 3
 *   first_pass_approval_rate = |{P1,P3}| / |{P1,P2,P3}| = 2/3, n = 3
 *   prs_reviewed = |{Q1,Q2,Q3,Q4}| = 4
 *   review_turnaround: Q1 4 h · Q2 6 h (r₁ = rC; rD is outside) · Q3 Fri 7 + Mon 11 = 18 h ·
 *     Q4 no request → median(4,6,18) = 6, n = 3
 *   review_balance = 4 / (4 + 4) = 0.5, n = 8
 *   time_to_first_review: P1 2 · P2 Fri 8 + Mon 9 = 17 · P3 1 · P6 24 (P4's is in Sept)
 *     → median(1,2,17,24) = 9.5, n = 4
 *   review_depth: Q1 (2+1)+(1+0) = 4 · Q2 0+1 = 1 · Q3 5 · Q4 0 → median(0,1,4,5) = 2.5, n = 4
 *   repos_reviewed = {R1,R2,R3} = 3 · repos_contributed = 3 · repos_with_merged_prs = {R1,R2} = 2
 *   two_way_repos = merged {R1,R2} ∩ reviewed {R1,R2,R3} = 2
 *   active_days: 2,5,6,7,8,13,14,16,26,27,28,30,31 = 13
 *   W = ISO weeks 40..44 (5); active 40, 41, 42, 44 (week 43 = Oct 19–25 has nothing)
 *     → active_weeks_ratio = 0.8, longest_active_week_streak = 3 (weeks 40–42)
 *   commits = 4
 */

const t = (iso: string) => new Date(`${iso}Z`);

function pr(
  id: string,
  repositoryId: string,
  o: Partial<AuthoredPrFact> & { createdAt: Date },
): AuthoredPrFact {
  return {
    id,
    repositoryId,
    readyAt: o.createdAt,
    mergedAt: null,
    closedAt: null,
    changedLines: null,
    changesRequestedCount: null,
    firstReviewAt: null,
    revertedAt: null,
    ...o,
  };
}

function rv(
  id: string,
  pullRequestId: string,
  repositoryId: string,
  o: Partial<ReviewFact> & { submittedAt: Date },
): ReviewFact {
  return {
    id,
    pullRequestId,
    repositoryId,
    reviewRequestedAt: null,
    commentsCount: 0,
    hasBody: false,
    ...o,
  };
}

export const cm = (id: string, repositoryId: string, at: string): CommitFact => ({
  id,
  repositoryId,
  authoredAt: t(at),
});

export const GOLDEN_FACTS: Facts = {
  authored: [
    pr('P1', 'R1', {
      createdAt: t('2026-10-05T09:00'),
      mergedAt: t('2026-10-05T15:00'),
      closedAt: t('2026-10-05T15:00'),
      changedLines: 120,
      changesRequestedCount: 0,
      firstReviewAt: t('2026-10-05T11:00'),
    }),
    pr('P2', 'R1', {
      createdAt: t('2026-10-08T10:00'),
      readyAt: t('2026-10-09T16:00'),
      mergedAt: t('2026-10-12T10:00'),
      closedAt: t('2026-10-12T10:00'),
      changedLines: 450,
      changesRequestedCount: 1,
      firstReviewAt: t('2026-10-12T09:00'),
      revertedAt: t('2026-10-20T10:00'),
    }),
    pr('P3', 'R2', {
      createdAt: t('2026-10-14T09:00'),
      mergedAt: t('2026-10-14T21:00'),
      closedAt: t('2026-10-14T21:00'),
      changedLines: 40,
      changesRequestedCount: 0,
      firstReviewAt: t('2026-10-14T10:00'),
    }),
    pr('P4', 'R1', {
      createdAt: t('2026-09-28T09:00'),
      mergedAt: t('2026-10-01T09:00'),
      closedAt: t('2026-10-01T09:00'),
      firstReviewAt: t('2026-09-29T09:00'),
    }),
    pr('P5', 'R2', { createdAt: t('2026-10-13T09:00'), closedAt: t('2026-10-22T12:00') }),
    pr('P6', 'R3', { createdAt: t('2026-10-27T08:00'), firstReviewAt: t('2026-10-28T08:00') }),
    pr('P7', 'R1', {
      createdAt: t('2026-10-30T12:00'),
      mergedAt: t('2026-11-02T10:00'),
      closedAt: t('2026-11-02T10:00'),
      changedLines: 10,
      changesRequestedCount: 0,
    }),
  ],
  reviews: [
    rv('rA', 'Q1', 'R1', {
      submittedAt: t('2026-10-06T14:00'),
      reviewRequestedAt: t('2026-10-06T10:00'),
      commentsCount: 2,
      hasBody: true,
    }),
    rv('rB', 'Q1', 'R1', { submittedAt: t('2026-10-07T09:00'), commentsCount: 1 }),
    rv('rD', 'Q2', 'R2', { submittedAt: t('2026-09-30T12:00'), commentsCount: 3 }),
    rv('rC', 'Q2', 'R2', {
      submittedAt: t('2026-10-16T18:00'),
      reviewRequestedAt: t('2026-10-16T12:00'),
      hasBody: true,
    }),
    rv('rE', 'Q3', 'R3', {
      submittedAt: t('2026-10-26T11:00'),
      reviewRequestedAt: t('2026-10-23T17:00'),
      commentsCount: 5,
    }),
    rv('rF', 'Q4', 'R1', { submittedAt: t('2026-10-28T10:00') }),
    rv('rG', 'Q5', 'R2', { submittedAt: t('2026-11-03T10:00') }),
  ],
  commits: [
    cm('C1', 'R1', '2026-10-02T10:00'),
    cm('C2', 'R1', '2026-10-05T08:00'),
    cm('C3', 'R3', '2026-10-13T10:00'),
    cm('C4', 'R2', '2026-10-31T10:00'),
    cm('C5', 'R1', '2026-11-01T10:00'),
  ],
};

export function windowOf(
  startDate: string,
  endDate: string,
  timezone = 'UTC',
  periodDays?: number,
): MetricWindow {
  const { start, endExclusive } = localRangeToUtc(startDate, endDate, timezone);
  return {
    start,
    endExclusive,
    startDate,
    endDate,
    timezone,
    periodDays: periodDays ?? Math.round((endExclusive.getTime() - start.getTime()) / 86_400_000),
  };
}

export const OCTOBER = windowOf('2026-10-01', '2026-10-31');
