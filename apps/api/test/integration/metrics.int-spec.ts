import { getQueueToken } from '@nestjs/bullmq';
import { PRState } from '@prisma/client';
import { Queue } from 'bullmq';
import request from 'supertest';

import { AiClient } from '../../src/ai/ai-client';
import { computeImpact } from '../../src/metrics/impact';
import { MetricsQueueService } from '../../src/metrics/metrics-queue.service';
import { MetricsRecomputeService } from '../../src/metrics/metrics-recompute.service';
import { MetricsScheduler, NIGHTLY_PATTERN } from '../../src/metrics/metrics-scheduler.service';
import { MetricsRepository } from '../../src/metrics/metrics.repository';
import { RollupService } from '../../src/metrics/rollup.service';
import {
  METRICS_NIGHTLY_SCHEDULER_ID,
  METRICS_QUEUE,
  metricsJobId,
} from '../../src/sync/sync.constants';
import { GOLDEN_FACTS } from '../fixtures/metrics/golden';
import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';

import type { ImpactInputs } from '../../src/metrics/score-inputs';

/**
 * Metrics, impact and career endpoints against the real database, with the golden dataset of
 * `test/fixtures/metrics/golden.ts` loaded through the same tables the sync writes. The AI client
 * is replaced by one that throws on every call: no metrics/impact GET may reach Anthropic
 * (P07 acceptance criterion; ADR-0008).
 */
const aiCalls: string[] = [];
const aiThatThrows = {
  configured: true,
  modelFor: () => 'test-model',
  generate: () => {
    aiCalls.push('generate');
    throw new Error('Anthropic must not be called (AiClient.generate)');
  },
};

const REPO = { R1: 'acme/r1', R2: 'acme/r2', R3: 'acme/r3' } as const;
type RepoKey = keyof typeof REPO;

describe('Metrics engine API (integration)', () => {
  let t: TestApp;
  let f: Factories;
  let server: ReturnType<TestApp['app']['getHttpServer']>;

  beforeAll(async () => {
    t = await createTestApp((b) => b.overrideProvider(AiClient).useValue(aiThatThrows));
    f = buildFactories(t.prisma);
    server = t.app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await resetRedisState();
  });

  afterAll(async () => {
    await t.close();
  });

  /** Loads the golden dataset for a new user; returns golden id → DB id. */
  async function goldenUser(timezone = 'UTC') {
    const user = await f.user();
    await t.prisma.userSettings.create({ data: { userId: user.id, timezone } });
    const gh = await f.integration(user.id, { externalAccountId: `U_${user.id}` });
    const repos = new Map<string, string>();
    for (const key of Object.keys(REPO) as RepoKey[]) {
      const row = await f.repository(user.id, gh.id, REPO[key], {
        htmlUrl: `https://github.com/${REPO[key]}`,
      });
      repos.set(key, row.id);
    }
    const ids = new Map<string, string>();
    let number = 100;
    for (const p of GOLDEN_FACTS.authored) {
      const row = await f.pullRequest(user.id, gh.id, {
        repo: REPO[p.repositoryId as RepoKey],
        number: ++number,
        title: `Golden ${p.id}`,
        url: `https://github.com/${REPO[p.repositoryId as RepoKey]}/pull/${number}`,
        state: p.mergedAt ? PRState.MERGED : p.closedAt ? PRState.CLOSED : PRState.OPEN,
        createdAtRemote: p.createdAt,
        readyForReviewAt: p.readyAt.getTime() === p.createdAt.getTime() ? null : p.readyAt,
        mergedAt: p.mergedAt,
        closedAt: p.closedAt,
        additions: p.changedLines,
        deletions: p.changedLines === null ? null : 0,
        changesRequestedCount: p.changesRequestedCount,
        firstReviewAt: p.firstReviewAt,
        revertedAt: p.revertedAt,
        labels: ['golden'],
      });
      ids.set(p.id, row.id);
    }
    const reviewedPr = new Map<string, string>();
    for (const r of GOLDEN_FACTS.reviews) {
      let prId = reviewedPr.get(r.pullRequestId);
      if (!prId) {
        const pr = await f.pullRequest(user.id, gh.id, {
          repo: REPO[r.repositoryId as RepoKey],
          number: ++number,
          title: `Teammate ${r.pullRequestId}`,
          isAuthoredByUser: false,
          authorLogin: 'teammate',
          body: null,
          mergedAt: null,
          state: PRState.OPEN,
        });
        prId = pr.id;
        reviewedPr.set(r.pullRequestId, prId);
        ids.set(r.pullRequestId, prId);
      }
      const row = await t.prisma.pullRequestReview.create({
        data: {
          userId: user.id,
          integrationId: gh.id,
          pullRequestId: prId,
          externalId: `golden-${r.id}-${user.id}`,
          state: 'COMMENTED',
          submittedAt: r.submittedAt,
          reviewRequestedAt: r.reviewRequestedAt,
          commentsCount: r.commentsCount,
          hasBody: r.hasBody,
        },
      });
      ids.set(r.id, row.id);
    }
    for (const c of GOLDEN_FACTS.commits) {
      const row = await f.commit(user.id, gh.id, {
        repo: REPO[c.repositoryId as RepoKey],
        authoredAt: c.authoredAt,
        message: `Golden commit ${c.id}`,
      });
      ids.set(c.id, row.id);
    }

    // Noise that must never count (KPI §2.2): excluded repository, merge commit, legacy stub.
    const excluded = await f.repository(user.id, gh.id, 'acme/excluded', { included: false });
    await f.commit(user.id, gh.id, {
      repo: 'acme/excluded',
      authoredAt: new Date('2026-10-20T10:00:00Z'),
    });
    await f.pullRequest(user.id, gh.id, {
      repositoryId: excluded.id,
      repo: 'acme/excluded',
      createdAtRemote: new Date('2026-10-20T10:00:00Z'),
      mergedAt: new Date('2026-10-21T10:00:00Z'),
    });
    await f.commit(user.id, gh.id, {
      repo: REPO.R1,
      authoredAt: new Date('2026-10-21T10:00:00Z'),
      parentsCount: 2,
      message: 'Merge branch main',
    });
    const stub = await f.pullRequest(user.id, gh.id, {
      repo: REPO.R1,
      title: 'PR #9',
      number: 9,
      state: PRState.CLOSED,
      isAuthoredByUser: false,
      legacyStub: true,
      mergedAt: null,
      createdAtRemote: new Date('2026-10-21T10:00:00Z'),
    });
    await t.prisma.pullRequestReview.create({
      data: {
        userId: user.id,
        integrationId: gh.id,
        pullRequestId: stub.id,
        externalId: `legacy:${user.id}`,
        state: 'APPROVED',
        submittedAt: new Date('2026-10-21T11:00:00Z'),
      },
    });
    return { user, gh, ids, repos, as: bearer(user.id) };
  }

  const get = (path: string, as: string) => request(server).get(path).set('authorization', as);

  describe('GET /metrics/kpis — every metric matches the golden dataset', () => {
    it('returns the five sections with hand-computed values, deltas and DB evidence ids', async () => {
      const { as, ids } = await goldenUser();
      const res = await get('/api/metrics/kpis?period=month:2026-10', as).expect(200);
      const { data } = res.body;
      expect(data.period).toMatchObject({
        spec: 'month:2026-10',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        periodDays: 31,
        inProgress: false,
        label: 'October 2026',
        timezone: 'UTC',
      });
      expect(data.sections.map((s: { key: string }) => s.key)).toEqual([
        'delivery',
        'quality',
        'collaboration',
        'ownership',
        'consistency',
        'issues', // P13: always present; `available: false` without Jira / Linear
      ]);
      expect(data.sections.at(-1).available).toBe(false);
      const values = Object.fromEntries(
        data.sections.flatMap((s: { metrics: { key: string; value: number; n: number }[] }) =>
          s.metrics.map((m) => [m.key, [m.value, m.n]]),
        ),
      );
      expect(values).toEqual({
        // §3.6 issue metrics (P13): no Jira / Linear data in the golden dataset.
        issues_completed: [0, 0],
        story_points_completed: [0, 0],
        issue_cycle_time_median_hours: [null, 0],
        prs_merged: [4, 4],
        prs_opened: [6, 6],
        pr_cycle_time_median_hours: [15, 4],
        merge_rate: [0.8, 5],
        small_pr_ratio: [2 / 3, 3],
        revert_rate: [0.25, 4],
        pr_size_median_lines: [120, 3],
        first_pass_approval_rate: [2 / 3, 3],
        prs_reviewed: [4, 4],
        review_turnaround_median_hours: [6, 3],
        review_balance: [0.5, 8],
        time_to_first_review_median_hours: [9.5, 4],
        review_depth_median: [2.5, 4],
        repos_reviewed: [3, 3],
        repos_contributed: [3, 3],
        two_way_repos: [2, 2],
        repos_with_merged_prs: [2, 2],
        active_days: [13, 13],
        active_weeks_ratio: [0.8, 5],
        commits: [4, 4],
        longest_active_week_streak: [3, 5],
      });
      const prsMerged = data.sections[0].metrics[0];
      expect(prsMerged).toMatchObject({
        key: 'prs_merged',
        label: 'PRs merged',
        unit: 'count',
        status: 'ok',
        previousValue: 0,
        delta: 4,
        deltaPct: null,
        direction: 'higher_is_better',
        inScore: true,
        evidenceTruncated: false,
      });
      expect(prsMerged.evidence).toEqual(['P3', 'P2', 'P1', 'P4'].map((k) => ids.get(k)));
      expect(data.impactStatus).toBe('ok');
      expect(data.comparison).toBe('full');
      expect(data.previousPeriod.spec).toBe('month:2026-09');
    });
  });

  describe('GET /impact', () => {
    it('computes the deterministic score lazily, caches it and stores reproducible inputs', async () => {
      const { as, user } = await goldenUser();
      const first = await get('/api/impact?period=month:2026-10', as).expect(200);
      const d = first.body.data;
      expect(d).toMatchObject({
        status: 'ok',
        scoreVersion: 'impact@2.0.0',
        overall: 64,
        band: 'Strong',
        highlights: null,
      });
      expect(d.dimensions.map((x: { key: string; score: number }) => [x.key, x.score])).toEqual([
        ['delivery', 67],
        ['quality', 50],
        ['collaboration', 65],
        ['ownership', 78],
      ]);
      expect(d.explanation).toContain('Your impact score: 64 (Strong)');
      expect(d.explanation).toContain('October 2026');

      const inputs = d.inputs as ImpactInputs;
      const again = computeImpact(inputs.metrics, inputs.period);
      expect(again.overall).toBe(inputs.overall);

      const rows = await t.prisma.impactScore.findMany({ where: { userId: user.id } });
      // The October score plus nothing else (one row per requested period).
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        scoreVersion: 'impact@2.0.0',
        status: 'OK',
        periodType: 'MONTH',
      });

      const second = await get('/api/impact?period=month:2026-10', as).expect(200);
      expect(second.body.data.computedAt).toBe(d.computedAt); // cache hit
      // JSONB does not keep key order; the values are identical.
      expect(second.body.data.inputs).toEqual(d.inputs);
    });

    it('returns insufficient_data with the §5 copy when there is too little activity', async () => {
      const user = await f.user();
      const gh = await f.integration(user.id);
      await f.pullRequest(user.id, gh.id, { mergedAt: new Date('2026-10-16T12:00:00Z') });
      const res = await get('/api/impact?period=month:2026-10', bearer(user.id)).expect(200);
      expect(res.body.data).toMatchObject({
        status: 'insufficient_data',
        overall: null,
        band: null,
      });
      expect(res.body.data.dimensions.every((x: { score: null }) => x.score === null)).toBe(true);
      expect(res.body.data.explanation).toContain(
        'Not enough activity in this period to compute a fair score — try a longer period.',
      );
    });

    it('history lists one point per month ending with the current one', async () => {
      const { as } = await goldenUser();
      const res = await get('/api/impact/history?periodType=month&count=3', as).expect(200);
      expect(res.body.data.points).toHaveLength(3);
      expect(res.body.data.points[2].period.inProgress).toBe(true);
      expect(res.body.data.scoreVersion).toBe('impact@2.0.0');
      expect(Object.keys(res.body.data.points[0].dimensions)).toEqual([
        'delivery',
        'quality',
        'collaboration',
        'ownership',
      ]);
    });
  });

  describe('GET /metrics/overview', () => {
    it('returns the three stat cards with deltas vs the previous month and the impact summary', async () => {
      const { as } = await goldenUser();
      const res = await get('/api/metrics/overview?period=month:2026-10', as).expect(200);
      const { data } = res.body;
      expect(
        data.cards.map((c: { key: string; value: number; previousValue: number }) => [
          c.key,
          c.value,
          c.previousValue,
        ]),
      ).toEqual([
        ['commits', 4, 0],
        ['prs_merged', 4, 0],
        ['prs_reviewed', 4, 1], // rD (Sep 30) is in September
      ]);
      expect(data.cards[2]).toMatchObject({ delta: 3, deltaPct: 3 });
      expect(data.impact).toEqual({ status: 'ok', overall: 64, delta: null, band: 'Strong' });
      expect(data.dataFreshness).toEqual({ lastSuccessfulSyncAt: null, syncing: false });
    });

    it('defaults to the current month in progress and compares the same elapsed days', async () => {
      const { as } = await goldenUser();
      const res = await get('/api/metrics/overview', as).expect(200);
      expect(res.body.data.period.inProgress).toBe(true);
      expect(res.body.data.period.type).toBe('month');
      expect(res.body.data.comparison).toBe('same_elapsed');
    });
  });

  describe('timeseries, heatmap, repos, trends, evidence, definitions', () => {
    it('GET /metrics/timeseries buckets snapshot counters by ISO week and medians by month', async () => {
      const { as, user } = await goldenUser();
      await t.app
        .get(RollupService)
        .recompute(user.id, new Date('2026-09-01T00:00:00Z'), new Date('2026-11-05T00:00:00Z'));
      const weekly = await get(
        '/api/metrics/timeseries?metric=commits&period=month:2026-10&interval=week',
        as,
      ).expect(200);
      expect(weekly.body.data).toMatchObject({
        metric: 'commits',
        interval: 'week',
        unit: 'count',
        timezone: 'UTC',
      });
      expect(weekly.body.data.points).toEqual([
        { start: '2026-10-01', end: '2026-10-04', value: 1, n: 1 },
        { start: '2026-10-05', end: '2026-10-11', value: 1, n: 1 },
        { start: '2026-10-12', end: '2026-10-18', value: 1, n: 1 },
        { start: '2026-10-19', end: '2026-10-25', value: 0, n: 0 },
        { start: '2026-10-26', end: '2026-10-31', value: 1, n: 1 },
      ]);
      const monthly = await get(
        '/api/metrics/timeseries?metric=pr_cycle_time_median_hours&from=2026-09-01&to=2026-10-31&interval=month',
        as,
      ).expect(200);
      expect(monthly.body.data.points).toEqual([
        { start: '2026-09-01', end: '2026-09-30', value: null, n: 0 },
        { start: '2026-10-01', end: '2026-10-31', value: 15, n: 4 },
      ]);
      const reviewed = await get(
        '/api/metrics/timeseries?metric=prs_reviewed&period=month:2026-10&interval=month',
        as,
      ).expect(200);
      expect(reviewed.body.data.points[0]).toMatchObject({ value: 4, n: 4 });
    });

    it('rejects an interval that is too fine for the range', async () => {
      const { as } = await goldenUser();
      const res = await get(
        '/api/metrics/timeseries?metric=commits&from=2024-01-01&to=2026-01-01&interval=day',
        as,
      ).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.issues[0].path).toBe('query.interval');
    });

    it('GET /metrics/heatmap fills every day from snapshots', async () => {
      const { as, user } = await goldenUser();
      await t.app
        .get(RollupService)
        .recompute(user.id, new Date('2026-09-01T00:00:00Z'), new Date('2026-11-05T00:00:00Z'));
      const res = await get('/api/metrics/heatmap?from=2026-10-01&to=2026-10-31', as).expect(200);
      const { data } = res.body;
      expect(data.days).toHaveLength(31);
      expect(data.days[4]).toEqual({
        date: '2026-10-05',
        count: 2,
        commits: 1,
        prsOpened: 1,
        prsMerged: 1,
        reviews: 0,
      });
      expect(data.activeDays).toBe(13);
      expect(data.max).toBe(2);
      const tooLong = await get('/api/metrics/heatmap?from=2025-01-01&to=2026-10-31', as).expect(
        400,
      );
      expect(tooLong.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('GET /metrics/repos aggregates contributions per repository', async () => {
      const { as, repos } = await goldenUser();
      const res = await get('/api/metrics/repos?period=month:2026-10', as).expect(200);
      expect(res.body.data.total).toBe(3);
      expect(res.body.data.repos[0]).toMatchObject({
        repositoryId: repos.get('R1'),
        fullName: REPO.R1,
        commits: 2,
        prsMerged: 3,
        prsReviewed: 2,
        twoWay: true,
      });
      expect(res.body.data.repos.map((r: { fullName: string }) => r.fullName)).not.toContain(
        'acme/excluded',
      );
    });

    it('GET /metrics/trends returns the same values as /metrics/kpis for consecutive periods', async () => {
      const { as } = await goldenUser();
      const res = await get(
        '/api/metrics/trends?period=month:2026-10&count=3&metrics=prs_merged,commits',
        as,
      ).expect(200);
      expect(res.body.data.periodType).toBe('month');
      expect(res.body.data.points.map((p: { period: { spec: string } }) => p.period.spec)).toEqual([
        'month:2026-08',
        'month:2026-09',
        'month:2026-10',
      ]);
      expect(res.body.data.series).toEqual([
        { metric: 'prs_merged', values: [0, 0, 4] },
        { metric: 'commits', values: [0, 0, 4] },
      ]);
    });

    it('GET /metrics/evidence resolves ids to linkable items, paginated', async () => {
      const { as, ids } = await goldenUser();
      const first = await get(
        '/api/metrics/evidence?metric=prs_merged&period=month:2026-10&limit=2',
        as,
      ).expect(200);
      expect(first.body.data.map((e: { id: string }) => e.id)).toEqual([
        ids.get('P3'),
        ids.get('P2'),
      ]);
      expect(first.body.data[0]).toMatchObject({
        kind: 'pull_request',
        ref: expect.stringMatching(/^PR-acme\/r2#\d+$/),
        title: 'Golden P3',
        repo: REPO.R2,
        url: expect.stringMatching(/^https:\/\/github\.com\/acme\/r2\/pull\/\d+$/),
        occurredAt: '2026-10-14T21:00:00.000Z',
      });
      expect(first.body.meta).toMatchObject({ total: 4, hasMore: true, truncated: false });
      const second = await get(
        `/api/metrics/evidence?metric=prs_merged&period=month:2026-10&limit=2&cursor=${first.body.meta.nextCursor as string}`,
        as,
      ).expect(200);
      expect(second.body.data.map((e: { id: string }) => e.id)).toEqual([
        ids.get('P1'),
        ids.get('P4'),
      ]);
      const reviews = await get(
        '/api/metrics/evidence?metric=prs_reviewed&period=month:2026-10',
        as,
      ).expect(200);
      expect(reviews.body.data[0]).toMatchObject({
        kind: 'review',
        ref: expect.stringMatching(/^REV-acme\/r1#\d+$/),
      });
      const commits = await get(
        '/api/metrics/evidence?metric=commits&period=month:2026-10',
        as,
      ).expect(200);
      expect(commits.body.data[0]).toMatchObject({
        kind: 'commit',
        ref: expect.stringMatching(/^C-acme\/r2@[0-9a-z]{7}$/),
        url: expect.stringMatching(/^https:\/\/github\.com\/acme\/r2\/commit\//),
      });
    });

    it('GET /metrics/definitions lists the catalogue with versions and is cacheable', async () => {
      const { as } = await goldenUser();
      const res = await get('/api/metrics/definitions', as).expect(200);
      expect(res.headers['cache-control']).toBe('private, max-age=3600');
      expect(res.body.data.metricsVersion).toBe('metrics@2.1.0');
      expect(res.body.data.scoreVersion).toBe('impact@2.0.0');
      expect(res.body.data.metrics).toHaveLength(24);
      // P13 implemented the §3.6 issue metrics: nothing is deferred any more.
      expect(res.body.data.metrics.filter((m: { deferred: boolean }) => m.deferred)).toHaveLength(
        0,
      );
      expect(res.body.data.bands).toHaveLength(4);
    });
  });

  describe('validation and periods', () => {
    it.each([
      ['/api/metrics/kpis?period=custom:2026-10-01..2026-10-06', 'INVALID_PERIOD'],
      ['/api/impact?period=month:2099-01', 'INVALID_PERIOD'],
      ['/api/metrics/overview?period=week:2026-W01', 'VALIDATION_FAILED'],
      ['/api/metrics/kpis?period=month:2026-10&extra=1', 'VALIDATION_FAILED'],
      ['/api/metrics/timeseries?metric=issues_closed', 'VALIDATION_FAILED'],
      ['/api/metrics/trends?count=13', 'VALIDATION_FAILED'],
      ['/api/metrics/evidence?metric=commits&cursor=@@', 'VALIDATION_FAILED'],
      ['/api/impact/history?periodType=year', 'VALIDATION_FAILED'],
      ['/api/career/timeline?year=1999', 'VALIDATION_FAILED'],
    ])('%s → 400 %s', async (path, code) => {
      const user = await f.user();
      const res = await get(path, bearer(user.id)).expect(400);
      expect(res.body.error.code).toBe(code);
      if (code === 'INVALID_PERIOD')
        expect(res.body.error.details.period).toEqual(expect.any(String));
    });

    it('period boundaries follow UserSettings.timezone and include the whole last day', async () => {
      const user = await f.user();
      await t.prisma.userSettings.create({
        data: { userId: user.id, timezone: 'Pacific/Auckland' },
      });
      const gh = await f.integration(user.id);
      // Oct 31 23:30 NZDT = Oct 31 10:30 UTC (inside); Nov 1 00:30 NZDT = Oct 31 11:30 UTC (outside);
      // Oct 1 00:30 NZDT = Sep 30 11:30 UTC (inside).
      for (const iso of ['2026-10-31T10:30:00Z', '2026-10-31T11:30:00Z', '2026-09-30T11:30:00Z']) {
        await f.commit(user.id, gh.id, { authoredAt: new Date(iso) });
      }
      const res = await get('/api/metrics/kpis?period=month:2026-10', bearer(user.id)).expect(200);
      const commits = res.body.data.sections[4].metrics.find(
        (m: { key: string }) => m.key === 'commits',
      );
      expect(commits.value).toBe(2);
      expect(res.body.data.period.timezone).toBe('Pacific/Auckland');
    });
  });

  describe('recompute (metrics.recompute) and cache invalidation', () => {
    it('DATA-09: new data in a past month invalidates its cached score; rollups are idempotent', async () => {
      const { as, user, gh } = await goldenUser();
      const before = await get('/api/impact?period=month:2026-10', as).expect(200);
      expect(before.body.data.inputs.metrics.prs_merged.value).toBe(4);

      await f.pullRequest(user.id, gh.id, {
        repo: REPO.R3,
        createdAtRemote: new Date('2026-10-20T09:00:00Z'),
        mergedAt: new Date('2026-10-20T15:00:00Z'),
        additions: 10,
        deletions: 0,
      });
      const producer = t.app.get(MetricsQueueService);
      await producer.enqueueRecompute({
        userId: user.id,
        from: '2026-10-20T00:00:00.000Z',
        to: '2026-10-21T00:00:00.000Z',
        reason: 'sync',
      });
      await producer.enqueueRecompute({
        userId: user.id,
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-02T00:00:00.000Z',
        reason: 'webhook',
      });

      // Debounced: one delayed job per user; the ranges are merged in Redis.
      const queue = t.app.get<Queue>(getQueueToken(METRICS_QUEUE));
      const delayed = await queue.getDelayed();
      expect(delayed.filter((j) => j.data.userId === user.id)).toHaveLength(1);
      expect(await queue.getDeduplicationJobId(metricsJobId(user.id))).toBeTruthy();

      const job = delayed[0];
      if (!job) throw new Error('job missing');
      const results = await t.app.get(MetricsRecomputeService).handle(job.data);
      expect(results[0]).toMatchObject({ fromDate: '2026-07-01', toDate: '2026-10-21' });
      expect(results[0]?.scoresInvalidated).toBe(1);

      const after = await get('/api/impact?period=month:2026-10', as).expect(200);
      expect(after.body.data.inputs.metrics.prs_merged.value).toBe(5);

      const snapshots = async () =>
        (
          await t.prisma.metricSnapshot.findMany({
            where: { userId: user.id },
            orderBy: { date: 'asc' },
          })
        ).map(({ id: _id, computedAt: _c, ...rest }) => rest);
      const once = await snapshots();
      await t.app
        .get(RollupService)
        .recompute(user.id, new Date('2026-07-01T00:00:00Z'), new Date('2026-10-21T00:00:00Z'));
      expect(await snapshots()).toEqual(once);
      expect(once.reduce((s, r) => s + r.prsMerged, 0)).toBe(5);
    });

    it('excluding a repository changes the results (PATCH /repos/:id queues a full recompute)', async () => {
      const { as, user, repos } = await goldenUser();
      await get('/api/metrics/kpis?period=month:2026-10', as).expect(200);
      await request(server)
        .patch(`/api/repos/${repos.get('R3')!}`)
        .set('authorization', as)
        .send({ included: false })
        .expect(200);
      await t.app.get(MetricsRecomputeService).handle({
        userId: user.id,
        from: new Date(0).toISOString(),
        to: new Date().toISOString(),
        reason: 'repository_inclusion',
      });
      const res = await get('/api/metrics/kpis?period=month:2026-10', as).expect(200);
      const ownership = res.body.data.sections[3].metrics;
      expect(ownership.find((m: { key: string }) => m.key === 'repos_contributed').value).toBe(2);
    });

    it('a time-zone change drops cached scores, queues a full recompute and re-buckets days', async () => {
      const { as, user } = await goldenUser();
      await t.app
        .get(RollupService)
        .recompute(user.id, new Date('2026-09-01T00:00:00Z'), new Date('2026-11-05T00:00:00Z'));
      await get('/api/impact?period=month:2026-10', as).expect(200);
      expect(await t.prisma.impactScore.count({ where: { userId: user.id } })).toBe(1);

      const res = await request(server)
        .patch('/api/me/settings')
        .set('authorization', as)
        .send({ timezone: 'Asia/Tokyo' })
        .expect(200);
      expect(res.body.meta).toEqual({ recomputeQueued: true });
      expect(await t.prisma.impactScore.count({ where: { userId: user.id } })).toBe(0);
      expect(await t.prisma.metricSnapshot.count({ where: { userId: user.id } })).toBe(0);

      const pending = await t.app.get(MetricsQueueService).takePending(user.id);
      expect(pending?.from.getTime()).toBe(0);
      await t.app.get(RollupService).recompute(user.id, new Date(0), new Date());
      // P3 merged Wed 10-14 21:00 UTC = Thu 10-15 06:00 JST.
      const day = await t.prisma.metricSnapshot.findFirst({
        where: { userId: user.id, prsMerged: 1, date: new Date('2026-10-15T00:00:00Z') },
      });
      expect(day?.timezone).toBe('Asia/Tokyo');

      const same = await request(server)
        .patch('/api/me/settings')
        .set('authorization', as)
        .send({ timezone: 'Asia/Tokyo' })
        .expect(200);
      expect(same.body.meta).toEqual({ recomputeQueued: false });
    });
  });

  describe('metrics.nightly (job scheduler)', () => {
    it('registers the 02:30 UTC scheduler and queues recomputes for users with active integrations', async () => {
      const queue = t.app.get<Queue>(getQueueToken(METRICS_QUEUE));
      const scheduler = new MetricsScheduler(
        queue,
        t.prisma,
        t.app.get(MetricsQueueService),
        t.app.get(MetricsRepository),
      );
      await scheduler.register();
      await scheduler.register(); // idempotent upsert
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers).toEqual([
        expect.objectContaining({
          key: METRICS_NIGHTLY_SCHEDULER_ID,
          pattern: NIGHTLY_PATTERN,
          tz: 'UTC',
        }),
      ]);

      const active = await goldenUser();
      const withSnapshots = await goldenUser();
      await t.app
        .get(RollupService)
        .recompute(
          withSnapshots.user.id,
          new Date('2026-10-01T00:00:00Z'),
          new Date('2026-10-02T00:00:00Z'),
        );
      const paused = await f.user();
      await f.integration(paused.id, { status: 'NEEDS_REAUTH' });

      const now = new Date('2026-11-17T02:30:00Z');
      expect(await scheduler.nightly(now)).toEqual({ queued: 2, full: 1 });
      const producer = t.app.get(MetricsQueueService);
      // No snapshots yet → full history; otherwise the last 35 days.
      expect((await producer.takePending(active.user.id))?.from.getTime()).toBe(0);
      expect((await producer.takePending(withSnapshots.user.id))?.from.toISOString()).toBe(
        '2026-10-13T02:30:00.000Z',
      );
      expect(await producer.takePending(paused.id)).toBeNull();
    });
  });

  describe('ownership and isolation', () => {
    it('another user sees none of the golden user’s metrics or evidence', async () => {
      const { ids } = await goldenUser();
      const other = await f.user();
      const as = bearer(other.id);
      const kpis = await get('/api/metrics/kpis?period=month:2026-10', as).expect(200);
      const all = kpis.body.data.sections.flatMap(
        (s: { metrics: { evidence: string[]; value: number | null }[] }) => s.metrics,
      );
      expect(all.every((m: { evidence: string[] }) => m.evidence.length === 0)).toBe(true);
      const evidence = await get(
        '/api/metrics/evidence?metric=prs_merged&period=month:2026-10',
        as,
      ).expect(200);
      expect(evidence.body.data).toEqual([]);
      await get(`/api/activity/prs/${ids.get('P1')!}`, as).expect(404);
      await get(`/api/activity/commits/${ids.get('C1')!}`, as).expect(404);
      const timeline = await get('/api/career/timeline?year=2026', as).expect(200);
      expect(timeline.body.data.years).toEqual([]);
    });
  });

  describe('activity', () => {
    it('GET /activity/feed merges commits, PR events and reviews newest first with a stable cursor', async () => {
      const { as } = await goldenUser();
      const all = await get('/api/activity/feed?period=month:2026-10&limit=100', as).expect(200);
      const types = all.body.data.map((i: { type: string }) => i.type);
      expect(types).toContain('commit');
      expect(types).toContain('pr_merged');
      expect(types).toContain('pr_closed');
      expect(types).toContain('review');
      const times = all.body.data.map((i: { occurredAt: string }) => i.occurredAt);
      expect([...times].sort().reverse()).toEqual(times);
      expect(
        all.body.data.some(
          (i: { repo: { fullName: string } }) => i.repo.fullName === 'acme/excluded',
        ),
      ).toBe(false);
      expect(all.body.data.some((i: { title: string }) => i.title.startsWith('Merge'))).toBe(false);

      const pages: string[] = [];
      let cursor: string | null = null;
      do {
        const page: request.Response = await get(
          `/api/activity/feed?period=month:2026-10&limit=4${cursor ? `&cursor=${cursor}` : ''}`,
          as,
        ).expect(200);
        pages.push(...page.body.data.map((i: { id: string }) => i.id));
        cursor = page.body.meta.nextCursor as string | null;
      } while (cursor);
      expect(pages).toEqual(all.body.data.map((i: { id: string }) => i.id));

      const merged = await get(
        '/api/activity/feed?types=pr_merged&period=month:2026-10',
        as,
      ).expect(200);
      expect(merged.body.data).toHaveLength(4);
      expect(merged.body.data[0]).toMatchObject({
        type: 'pr_merged',
        title: 'Golden P3',
        ref: expect.stringMatching(/^PR-acme\/r2#/),
      });
      const search = await get('/api/activity/feed?q=golden%20p2', as).expect(200);
      expect(search.body.data.every((i: { title: string }) => i.title === 'Golden P2')).toBe(true);
    });

    it('GET /activity/prs returns v2 items with cycle time; reviewed PRs carry myReviews', async () => {
      const { as, ids, repos } = await goldenUser();
      const authored = await get(
        '/api/activity/prs?role=authored&state=merged&sort=-mergedAt&period=month:2026-10',
        as,
      ).expect(200);
      expect(authored.body.data.map((p: { id: string }) => p.id)).toEqual(
        ['P3', 'P2', 'P1', 'P4'].map((k) => ids.get(k)),
      );
      const p2 = authored.body.data[1];
      expect(p2).toMatchObject({
        state: 'merged',
        cycleTimeHours: 18,
        firstReviewHours: 17,
        reverted: true,
        additions: 450,
      });
      const bySize = await get(
        '/api/activity/prs?role=authored&sort=-changedLines&limit=2',
        as,
      ).expect(200);
      expect(bySize.body.data.map((p: { id: string }) => p.id)).toEqual([
        ids.get('P2'),
        ids.get('P1'),
      ]);
      expect(bySize.body.meta.hasMore).toBe(true);
      const reviewed = await get(
        `/api/activity/prs?role=reviewed&repoIds=${repos.get('R1')!}`,
        as,
      ).expect(200);
      expect(reviewed.body.data.map((p: { title: string }) => p.title).sort()).toEqual([
        'Teammate Q1',
        'Teammate Q4',
      ]);
      expect(
        reviewed.body.data.find((p: { title: string }) => p.title === 'Teammate Q1').myReviews,
      ).toEqual({ count: 2, latestState: 'commented' });
      await get('/api/activity/prs', as).expect(400); // role is required
    });

    it('detail endpoints return the record; excluded repositories are 404', async () => {
      const { as, ids } = await goldenUser();
      const pr = await get(`/api/activity/prs/${ids.get('P2')!}`, as).expect(200);
      expect(pr.body.data).toMatchObject({
        labels: ['golden'],
        changesRequestedCount: 1,
        myReviews: [],
        achievementIds: [],
      });
      const q1 = await get(`/api/activity/prs/${ids.get('Q1')!}`, as).expect(200);
      expect(q1.body.data.body).toBeNull();
      expect(q1.body.data.myReviews).toHaveLength(2);
      const commit = await get(`/api/activity/commits/${ids.get('C1')!}`, as).expect(200);
      expect(commit.body.data).toMatchObject({
        messageHeadline: 'Golden commit C1',
        messageBody: null,
      });
      const excluded = await t.prisma.commit.findFirstOrThrow({
        where: { repository: { fullName: 'acme/excluded' } },
      });
      await get(`/api/activity/commits/${excluded.id}`, as).expect(404);
    });

    it('GET /activity/reviews lists reviews with business-hour turnaround', async () => {
      const { as } = await goldenUser();
      const res = await get('/api/activity/reviews?period=month:2026-10', as).expect(200);
      expect(res.body.data).toHaveLength(5); // rA rB rC rE rF; rD/rG outside, the stub's review excluded
      const rE = res.body.data.find(
        (r: { pullRequest: { title: string } }) => r.pullRequest.title === 'Teammate Q3',
      );
      expect(rE.turnaroundHours).toBe(18);
    });
  });

  describe('GET /career/timeline', () => {
    it('groups the year by quarter with review clusters and milestones', async () => {
      const { as } = await goldenUser();
      const res = await get('/api/career/timeline?year=2026', as).expect(200);
      const { data } = res.body;
      expect(data.years).toEqual([2026]);
      const q4 = data.quarters.find((q: { quarter: number }) => q.quarter === 4);
      // Q4 = October + November: P7 (merged Nov 2) and Q5 (rG, Nov 3) count too.
      expect(q4.totals).toEqual({
        prsMerged: 5,
        prsReviewed: 5,
        achievements: 0,
        issuesCompleted: 0,
        storyPoints: 0,
      });
      const r1 = q4.repos.find((r: { fullName: string }) => r.fullName === REPO.R1);
      expect(r1.items.filter((i: { type: string }) => i.type === 'pr_merged')).toHaveLength(4);
      expect(r1.items.find((i: { type: string }) => i.type === 'review_cluster')).toMatchObject({
        title: 'Reviewed 2 pull requests by teammates',
        count: 2,
      });
      expect(q4.milestones.map((m: { kind: string }) => m.kind)).toEqual(
        expect.arrayContaining([
          'first_merged_pr_in_repo',
          'largest_merged_pr',
          'longest_active_week_streak',
        ]),
      );
      expect(JSON.stringify(data)).not.toContain('acme/excluded');
      const q3 = data.quarters.find((q: { quarter: number }) => q.quarter === 3);
      expect(q3.totals).toEqual({
        prsMerged: 0,
        prsReviewed: 1,
        achievements: 0,
        issuesCompleted: 0,
        storyPoints: 0,
      });
    });
  });

  describe('no Anthropic call on any metrics/impact GET', () => {
    it('every read endpoint answers while the AI client throws', async () => {
      const { as, ids } = await goldenUser();
      for (const path of [
        '/api/metrics/definitions',
        '/api/metrics/overview',
        '/api/metrics/overview?period=month:2026-10',
        '/api/metrics/kpis?period=quarter:2026-Q4',
        '/api/metrics/timeseries?metric=review_balance&period=half:2026-H2&interval=month',
        '/api/metrics/heatmap',
        '/api/metrics/repos?period=year:2026',
        '/api/metrics/trends?period=month:2026-10',
        '/api/metrics/evidence?metric=commits&period=month:2026-10',
        '/api/impact?period=custom:2026-09-15..2026-10-31',
        '/api/impact/history?periodType=quarter&count=4',
        '/api/career/timeline',
        '/api/activity/feed',
        `/api/activity/prs/${ids.get('P1')!}`,
      ]) {
        const res = await get(path, as);
        expect([path, res.status]).toEqual([path, 200]);
      }
      await get('/api/generate/impact-score?month=10&year=2026', as).expect(404);
      expect(aiCalls).toEqual([]);
    });
  });
});
