import { IMPLEMENTED_METRIC_KEYS, METRIC_CATALOGUE } from '@devimpact/shared';

import { GOLDEN_FACTS, OCTOBER, cm, windowOf } from '../../test/fixtures/metrics/golden';
import { computeMetrics, median, type Facts } from './metric-definitions';
import { emptyCounters, rollupDays } from './rollup';

describe('metrics@2.0.0 golden dataset (KPI_METHODOLOGY §10.1)', () => {
  const r = computeMetrics(GOLDEN_FACTS, OCTOBER);

  it('covers every metric of the catalogue', () => {
    const implemented = METRIC_CATALOGUE.filter((m) => !m.deferred).map((m) => m.key);
    expect(Object.keys(r).sort()).toEqual([...implemented].sort());
    expect([...IMPLEMENTED_METRIC_KEYS].sort()).toEqual([...implemented].sort());
  });

  it.each([
    ['prs_merged', 4, 4],
    ['prs_opened', 6, 6],
    ['pr_cycle_time_median_hours', 15, 4],
    ['merge_rate', 0.8, 5],
    ['small_pr_ratio', 2 / 3, 3],
    ['revert_rate', 0.25, 4],
    ['pr_size_median_lines', 120, 3],
    ['first_pass_approval_rate', 2 / 3, 3],
    ['prs_reviewed', 4, 4],
    ['review_turnaround_median_hours', 6, 3],
    ['review_balance', 0.5, 8],
    ['time_to_first_review_median_hours', 9.5, 4],
    ['review_depth_median', 2.5, 4],
    ['repos_reviewed', 3, 3],
    ['repos_contributed', 3, 3],
    ['two_way_repos', 2, 2],
    ['repos_with_merged_prs', 2, 2],
    ['active_days', 13, 13],
    ['active_weeks_ratio', 0.8, 5],
    ['commits', 4, 4],
    ['longest_active_week_streak', 3, 5],
  ] as const)('%s = %d (n = %d)', (key, value, n) => {
    expect(r[key].value).toBeCloseTo(value, 12);
    expect(r[key].n).toBe(n);
    expect(r[key].status).toBe('ok');
  });

  it('lists evidence newest first (numerator / sample records)', () => {
    expect(r.prs_merged.evidence).toEqual(['P3', 'P2', 'P1', 'P4']);
    expect(r.revert_rate.evidence).toEqual(['P2']);
    expect(r.small_pr_ratio.evidence).toEqual(['P3', 'P1']);
    expect(r.prs_reviewed.evidence).toEqual(['rF', 'rE', 'rC', 'rA']);
    expect(r.review_turnaround_median_hours.evidence).toEqual(['rE', 'rC', 'rA']);
    expect(r.commits.evidence).toEqual(['C4', 'C3', 'C2', 'C1']);
    expect(r.two_way_repos.evidence).toEqual(['rF', 'rC', 'P3', 'P2']);
    // Newest contribution of each streak week: W42 rC, W41 P2 (opened), W40 C1.
    expect(r.longest_active_week_streak.evidence).toEqual(['rC', 'P2', 'C1']);
    expect(r.prs_merged.evidenceTruncated).toBe(false);
  });

  it('marks small samples insufficient (value null) and keeps n', () => {
    const lateOctober = computeMetrics(GOLDEN_FACTS, windowOf('2026-10-19', '2026-10-31'));
    expect(lateOctober.pr_cycle_time_median_hours).toMatchObject({
      value: null,
      n: 0,
      status: 'insufficient_data',
    });
    expect(lateOctober.merge_rate).toMatchObject({
      value: null,
      n: 1,
      status: 'insufficient_data',
    });
    expect(lateOctober.prs_merged).toMatchObject({ value: 0, status: 'ok' });
  });

  it('is deterministic: identical output across runs and input order', () => {
    const shuffled: Facts = {
      authored: [...GOLDEN_FACTS.authored].reverse(),
      reviews: [...GOLDEN_FACTS.reviews].reverse(),
      commits: [...GOLDEN_FACTS.commits].reverse(),
    };
    expect(JSON.stringify(computeMetrics(shuffled, OCTOBER))).toBe(JSON.stringify(r));
    expect(JSON.stringify(computeMetrics(GOLDEN_FACTS, OCTOBER))).toBe(JSON.stringify(r));
  });

  it('assigns events to local dates in the user time zone', () => {
    // C4 (Sat 10-31 10:00 UTC) is Sat 10-31 in Auckland too, but C5 (11-01 10:00 UTC) is
    // Nov 1 23:00 NZDT — outside; and Oct 1 00:30 NZDT is Sep 30 11:30 UTC (inside in Auckland).
    const facts: Facts = {
      authored: [],
      reviews: [],
      commits: [cm('early', 'R1', '2026-09-30T11:30'), cm('late', 'R1', '2026-10-31T11:30')],
    };
    const auckland = computeMetrics(
      facts,
      windowOf('2026-10-01', '2026-10-31', 'Pacific/Auckland'),
    );
    expect(auckland.commits.evidence).toEqual(['early']);
    const utc = computeMetrics(facts, OCTOBER);
    expect(utc.commits.evidence).toEqual(['late']);
  });
});

describe('median (§2.6)', () => {
  it('handles odd, even and empty samples', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('daily rollups (§4)', () => {
  const rows = rollupDays(GOLDEN_FACTS, '2026-10-01', '2026-10-31', 'UTC');

  it('stores additive counters per local date', () => {
    const byDate = new Map(rows.map((row) => [row.date, row]));
    expect(byDate.get('2026-10-05')).toEqual({
      ...emptyCounters('2026-10-05'),
      commits: 1,
      prsOpened: 1,
      prsMerged: 1,
      active: true,
      byProvider: {
        github: { commits: 1, prsMerged: 1, prsReviewed: 0, issuesCompleted: 0, storyPoints: 0 },
      },
    });
    expect(byDate.get('2026-10-01')).toEqual({
      ...emptyCounters('2026-10-01'),
      prsMerged: 1,
      byProvider: {
        github: { commits: 0, prsMerged: 1, prsReviewed: 0, issuesCompleted: 0, storyPoints: 0 },
      },
    });
    expect(byDate.get('2026-10-22')).toEqual({
      ...emptyCounters('2026-10-22'),
      prsClosedUnmerged: 1,
    });
    expect(byDate.get('2026-10-06')).toMatchObject({
      reviewsSubmitted: 1,
      prsReviewed: 1,
      reviewComments: 3,
    });
    expect(rows.filter((row) => row.active)).toHaveLength(13); // = active_days
    expect(rows.reduce((s, row) => s + row.prsMerged, 0)).toBe(4); // = prs_merged
    expect(rows.reduce((s, row) => s + row.commits, 0)).toBe(4); // = commits
  });
});

describe('issue metrics (§3.6, metrics@2.1.0)', () => {
  const at = (iso: string) => new Date(iso);
  const facts: Facts = {
    authored: [],
    reviews: [],
    commits: [],
    issues: [
      // Mon 09:00 → Tue 09:00 UTC = 24 business hours (weekends excluded, §2.4)
      {
        id: 'I1',
        completedAt: at('2026-10-06T09:00:00Z'),
        startedAt: at('2026-10-05T09:00:00Z'),
        storyPoints: 5,
        provider: 'jira',
      },
      {
        id: 'I2',
        completedAt: at('2026-10-14T10:00:00Z'),
        startedAt: at('2026-10-13T10:00:00Z'),
        storyPoints: null,
        provider: 'linear',
      },
      {
        id: 'I3',
        completedAt: at('2026-10-20T12:00:00Z'),
        startedAt: null,
        storyPoints: 2.5,
        provider: 'linear',
      },
      // completed outside the period / never completed (cancelled): not counted
      { id: 'I4', completedAt: at('2026-09-30T12:00:00Z'), startedAt: null, storyPoints: 8 },
      { id: 'I5', completedAt: null, startedAt: at('2026-10-02T12:00:00Z'), storyPoints: 3 },
    ],
  };
  const results = computeMetrics(facts, OCTOBER);

  it('issues_completed counts completedAt ∈ period with evidence newest first', () => {
    expect(results.issues_completed).toMatchObject({ value: 3, n: 3, status: 'ok' });
    expect(results.issues_completed.evidence).toEqual(['I3', 'I2', 'I1']);
  });

  it('story_points_completed sums points, n = issues with points', () => {
    expect(results.story_points_completed).toMatchObject({ value: 7.5, n: 2, status: 'ok' });
    expect(results.story_points_completed.evidence).toEqual(['I3', 'I1']);
  });

  it('issue cycle time needs n ≥ 3 started issues (insufficient here)', () => {
    expect(results.issue_cycle_time_median_hours).toMatchObject({
      value: null,
      n: 2,
      status: 'insufficient_data',
    });
    const more = computeMetrics(
      {
        ...facts,
        issues: [
          ...(facts.issues ?? []),
          {
            id: 'I6',
            completedAt: at('2026-10-22T13:00:00Z'),
            startedAt: at('2026-10-22T09:00:00Z'),
            storyPoints: 1,
          },
        ],
      },
      OCTOBER,
    );
    expect(more.issue_cycle_time_median_hours).toMatchObject({ value: 24, n: 3, status: 'ok' });
  });

  it('no issues → zero counts, never affects code metrics', () => {
    const none = computeMetrics(GOLDEN_FACTS, OCTOBER);
    expect(none.issues_completed).toMatchObject({ value: 0, n: 0, status: 'ok' });
    expect(none.prs_merged.value).toBe(
      computeMetrics({ ...GOLDEN_FACTS, issues: facts.issues }, OCTOBER).prs_merged.value,
    );
  });

  it('rollups carry issue counters and the provider dimension', () => {
    const rows = rollupDays(facts, '2026-10-01', '2026-10-31', 'UTC');
    expect(rows.find((r) => r.date === '2026-10-06')).toMatchObject({
      issuesCompleted: 1,
      storyPoints: 5,
      active: false,
      byProvider: { jira: { issuesCompleted: 1, storyPoints: 5 } },
    });
    expect(rows.reduce((s, r) => s + r.issuesCompleted, 0)).toBe(3);
  });
});

describe('provider dimension (P13)', () => {
  it('splits code counters by provider; reviewed PRs counted per provider per day', () => {
    const rows = rollupDays(
      {
        authored: [],
        commits: [
          {
            id: 'C1',
            repositoryId: 'r1',
            authoredAt: new Date('2026-10-05T10:00:00Z'),
            provider: 'github',
          },
          {
            id: 'C2',
            repositoryId: 'r2',
            authoredAt: new Date('2026-10-05T11:00:00Z'),
            provider: 'gitlab',
          },
        ],
        reviews: [
          {
            id: 'V1',
            pullRequestId: 'P1',
            repositoryId: 'r2',
            submittedAt: new Date('2026-10-05T12:00:00Z'),
            reviewRequestedAt: null,
            commentsCount: 0,
            hasBody: false,
            provider: 'gitlab',
          },
          {
            id: 'V2',
            pullRequestId: 'P1',
            repositoryId: 'r2',
            submittedAt: new Date('2026-10-05T13:00:00Z'),
            reviewRequestedAt: null,
            commentsCount: 0,
            hasBody: false,
            provider: 'gitlab',
          },
        ],
      },
      '2026-10-01',
      '2026-10-31',
      'UTC',
    );
    expect(rows[0]?.byProvider).toEqual({
      github: { commits: 1, prsMerged: 0, prsReviewed: 0, issuesCompleted: 0, storyPoints: 0 },
      gitlab: { commits: 1, prsMerged: 0, prsReviewed: 1, issuesCompleted: 0, storyPoints: 0 },
    });
  });
});
