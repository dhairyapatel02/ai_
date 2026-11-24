import request from 'supertest';

import { RefResolver } from '../../src/evidence/ref-resolver.service';
import { MetricsQueueService } from '../../src/metrics/metrics-queue.service';
import { RollupService } from '../../src/metrics/rollup.service';
import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';

/**
 * Achievements (§15) and goals (§16): CRUD, validation, ownership (incl. evidence refs to other
 * users' records), achievements in the feed, career timeline, evidence packs and RefResolver, and
 * goal progress from the metrics engine.
 */
describe('Achievements and goals (integration)', () => {
  let t: TestApp;
  let f: Factories;
  let userId: string;
  let as: string;
  const server = () => t.app.getHttpServer();
  const enqueue = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    t = await createTestApp();
    f = buildFactories(t.prisma);
    jest.spyOn(t.app.get(MetricsQueueService), 'enqueueRecompute').mockImplementation(enqueue);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await resetRedisState();
    enqueue.mockClear();
    const user = await f.user();
    userId = user.id;
    as = bearer(user.id);
  });

  afterAll(async () => {
    await t.close();
  });

  const post = (body: object, auth = as) =>
    request(server()).post('/api/achievements').set('authorization', auth).send(body);

  describe('achievements', () => {
    it('requires authentication', async () => {
      await request(server()).get('/api/achievements').expect(401);
      await request(server()).post('/api/achievements').send({}).expect(401);
    });

    it('creates, reads, lists, updates and deletes; enqueues a recompute for the date', async () => {
      const gh = await f.integration(userId);
      const pr = await f.pullRequest(userId, gh.id, { title: 'Ship refunds' });
      const created = await post({
        title: 'Led the refunds launch',
        category: 'delivery',
        occurredOn: '2026-10-20',
        impact: 'Refund time from 3 days to 1 hour',
        links: [{ url: 'https://example.com/doc', label: 'Doc' }],
        evidence: [{ kind: 'pull_request', id: pr.id }],
      }).expect(201);
      const a = created.body.data;
      expect(a).toMatchObject({
        title: 'Led the refunds launch',
        category: 'delivery',
        occurredOn: '2026-10-20',
        source: 'manual',
        ref: `ACH-${a.id}`,
        links: [{ url: 'https://example.com/doc', label: 'Doc' }],
        goalIds: [],
      });
      expect(a.evidence).toEqual([
        expect.objectContaining({
          ref: 'PR-acme/api#' + String(pr.number),
          kind: 'pull_request',
          id: pr.id,
        }),
      ]);
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ userId, reason: 'achievement' }),
      );

      await request(server()).get(`/api/achievements/${a.id}`).set('authorization', as).expect(200);
      const list = await request(server())
        .get('/api/achievements')
        .set('authorization', as)
        .expect(200);
      expect(list.body.meta).toMatchObject({ total: 1, hasMore: false });

      const patched = await request(server())
        .patch(`/api/achievements/${a.id}`)
        .set('authorization', as)
        .send({ title: 'Led the refunds v2 launch', evidence: [], impact: null })
        .expect(200);
      expect(patched.body.data).toMatchObject({
        title: 'Led the refunds v2 launch',
        evidence: [],
        impact: null,
      });

      await request(server())
        .delete(`/api/achievements/${a.id}`)
        .set('authorization', as)
        .expect(200);
      await request(server()).get(`/api/achievements/${a.id}`).set('authorization', as).expect(404);
    });

    it('validates input (title, category, date in the future, links, unknown keys)', async () => {
      const bad = [
        { title: '', category: 'delivery', occurredOn: '2026-10-01' },
        { title: 'x'.repeat(201), category: 'delivery', occurredOn: '2026-10-01' },
        { title: 'ok', category: 'heroics', occurredOn: '2026-10-01' },
        { title: 'ok', category: 'delivery', occurredOn: '2026-13-01' },
        {
          title: 'ok',
          category: 'delivery',
          occurredOn: '2026-10-01',
          links: [{ url: 'javascript:alert(1)' }],
        },
        { title: 'ok', category: 'delivery', occurredOn: '2026-10-01', visibility: 'public' },
        { title: 'ok', category: 'delivery', occurredOn: '2099-01-01' },
      ];
      for (const body of bad) {
        const res = await post(body);
        expect([res.status, res.body.error.code]).toEqual([400, 'VALIDATION_FAILED']);
      }
    });

    it("rejects evidence that is not the user's own (404) and never leaks other users' achievements", async () => {
      const bob = await f.user();
      const bobGh = await f.integration(bob.id, { externalAccountId: 'node-bob' });
      const bobPr = await f.pullRequest(bob.id, bobGh.id);
      const bobCommit = await f.commit(bob.id, bobGh.id);
      const bobReview = await f.review(bob.id, bobGh.id);
      const myGh = await f.integration(userId, { externalAccountId: 'node-me' });
      const reviewedPr = await f.pullRequest(userId, myGh.id, { isAuthoredByUser: false });
      for (const evidence of [
        { kind: 'pull_request', id: bobPr.id },
        { kind: 'commit', id: bobCommit.id },
        { kind: 'review', id: bobReview.id },
        // A reviewed (not authored) PR is not "your PR"; link the review instead.
        { kind: 'pull_request', id: reviewedPr.id },
        { kind: 'commit', id: bobPr.id }, // id of the wrong kind
      ]) {
        const res = await post({
          title: 'x',
          category: 'other',
          occurredOn: '2026-10-01',
          evidence: [evidence],
        });
        expect([res.status, res.body.error.code]).toEqual([404, 'NOT_FOUND']);
      }
      const bobAch = await post(
        { title: 'Bob win', category: 'other', occurredOn: '2026-10-01' },
        bearer(bob.id),
      ).expect(201);
      const id = bobAch.body.data.id as string;
      await request(server()).get(`/api/achievements/${id}`).set('authorization', as).expect(404);
      await request(server())
        .patch(`/api/achievements/${id}`)
        .set('authorization', as)
        .send({ title: 'mine' })
        .expect(404);
      await request(server())
        .delete(`/api/achievements/${id}`)
        .set('authorization', as)
        .expect(404);
      const list = await request(server())
        .get('/api/achievements')
        .set('authorization', as)
        .expect(200);
      expect(list.body.data).toEqual([]);
      expect(await t.prisma.achievement.count({ where: { userId: bob.id } })).toBe(1);
    });

    it('filters by category, period and q; paginates with a cursor', async () => {
      for (const [i, cat] of ['mentoring', 'incident', 'mentoring', 'learning'].entries()) {
        await post({ title: `Win ${i}`, category: cat, occurredOn: `2026-0${i + 6}-15` }).expect(
          201,
        );
      }
      const mentoring = await request(server())
        .get('/api/achievements?category=mentoring')
        .set('authorization', as)
        .expect(200);
      expect(mentoring.body.data.map((a: { title: string }) => a.title)).toEqual([
        'Win 2',
        'Win 0',
      ]);
      const q3 = await request(server())
        .get('/api/achievements?period=quarter:2026-Q3')
        .set('authorization', as)
        .expect(200);
      expect(q3.body.data.map((a: { title: string }) => a.title)).toEqual([
        'Win 3',
        'Win 2',
        'Win 1',
      ]);
      const q = await request(server())
        .get('/api/achievements?q=win%201')
        .set('authorization', as)
        .expect(200);
      expect(q.body.data).toHaveLength(1);
      const p1 = await request(server())
        .get('/api/achievements?limit=3')
        .set('authorization', as)
        .expect(200);
      expect(p1.body.meta).toMatchObject({ hasMore: true, total: 4 });
      const p2 = await request(server())
        .get(`/api/achievements?limit=3&cursor=${p1.body.meta.nextCursor as string}`)
        .set('authorization', as)
        .expect(200);
      expect(p2.body.data.map((a: { title: string }) => a.title)).toEqual(['Win 0']);
      await request(server())
        .get('/api/achievements?period=bogus')
        .set('authorization', as)
        .expect(400);
    });

    it('appears in the activity feed (type filter, no repo filter), PR detail and the career timeline', async () => {
      const gh = await f.integration(userId);
      const pr = await f.pullRequest(userId, gh.id, { mergedAt: new Date('2026-10-16T12:00:00Z') });
      const a = (
        await post({
          title: 'Mentored the new hire',
          category: 'mentoring',
          occurredOn: '2026-10-16',
          evidence: [{ kind: 'pull_request', id: pr.id }],
        }).expect(201)
      ).body.data;

      const feed = await request(server())
        .get('/api/activity/feed?period=month:2026-10')
        .set('authorization', as)
        .expect(200);
      const item = feed.body.data.find((i: { type: string }) => i.type === 'achievement');
      expect(item).toMatchObject({
        id: `achievement:${a.id}`,
        ref: `ACH-${a.id}`,
        repo: null,
        url: null,
        title: 'Mentored the new hire',
        meta: expect.objectContaining({ category: 'mentoring', recordId: a.id }),
      });
      const only = await request(server())
        .get('/api/activity/feed?types=achievement')
        .set('authorization', as)
        .expect(200);
      expect(only.body.data).toHaveLength(1);
      const repoFiltered = await request(server())
        .get(`/api/activity/feed?repoIds=${pr.repositoryId}`)
        .set('authorization', as)
        .expect(200);
      expect(repoFiltered.body.data.some((i: { type: string }) => i.type === 'achievement')).toBe(
        false,
      );

      // Cursor pagination across sources keeps every item exactly once.
      await post({ title: 'Second', category: 'other', occurredOn: '2026-10-16' }).expect(201);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: request.Response = await request(server())
          .get(`/api/activity/feed?limit=1${cursor ? `&cursor=${cursor}` : ''}`)
          .set('authorization', as)
          .expect(200);
        seen.push(...page.body.data.map((i: { id: string }) => i.id));
        cursor = page.body.meta.nextCursor as string | null;
      } while (cursor);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.filter((id) => id.startsWith('achievement:'))).toHaveLength(2);

      const detail = await request(server())
        .get(`/api/activity/prs/${pr.id}`)
        .set('authorization', as)
        .expect(200);
      expect(detail.body.data.achievementIds).toEqual([a.id]);

      const career = await request(server())
        .get('/api/career/timeline?year=2026')
        .set('authorization', as)
        .expect(200);
      const q4 = career.body.data.quarters.find((q: { quarter: number }) => q.quarter === 4);
      expect(q4.totals.achievements).toBe(2);
      expect(q4.achievements.map((i: { title: string }) => i.title)).toContain(
        'Mentored the new hire',
      );
      expect(q4.milestones.some((m: { kind: string }) => m.kind === 'achievement')).toBe(true);
      expect(career.body.data.years).toContain(2026);
    });

    it('counts achievements in daily snapshots (rollup)', async () => {
      await post({ title: 'A', category: 'other', occurredOn: '2026-10-05' }).expect(201);
      await post({ title: 'B', category: 'other', occurredOn: '2026-10-05' }).expect(201);
      await t.app
        .get(RollupService)
        .recompute(userId, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-31T00:00:00Z'));
      const snap = await t.prisma.metricSnapshot.findFirst({
        where: { userId, date: new Date('2026-10-05T00:00:00Z') },
      });
      expect(snap).toMatchObject({ achievements: 2, active: false });
    });

    it('feeds evidence packs (ACH- refs, counts) and RefResolver; never resolves other users’ achievements', async () => {
      const gh = await f.integration(userId);
      await f.pullRequest(userId, gh.id, { mergedAt: new Date('2026-10-16T12:00:00Z') });
      const a = (
        await post({
          title: 'On-call hero',
          category: 'incident',
          occurredOn: '2026-10-12',
        }).expect(201)
      ).body.data;
      const preview = await request(server())
        .post('/api/documents/preview-evidence')
        .set('authorization', as)
        .send({ type: 'appraisal', period: 'month:2026-10' })
        .expect(200);
      expect(preview.body.data.counts.achievements).toBe(1);
      expect(preview.body.data.topEvidence.map((e: { ref: string }) => e.ref)).toContain(
        `ACH-${a.id}`,
      );

      const bob = await f.user();
      const bobAch = (
        await post(
          { title: 'Bob', category: 'other', occurredOn: '2026-10-12' },
          bearer(bob.id),
        ).expect(201)
      ).body.data;
      const resolved = await t.app
        .get(RefResolver)
        .resolve(userId, [`ACH-${a.id}`, `ACH-${bobAch.id}`, 'ACH-nope']);
      expect(resolved).toEqual([
        {
          ref: `ACH-${a.id}`,
          kind: 'achievement',
          id: a.id,
          title: 'On-call hero',
          repo: null,
          url: null,
          occurredAt: '2026-10-12T12:00:00.000Z',
        },
      ]);
    });
  });

  describe('goals', () => {
    async function octoberActivity() {
      const gh = await f.integration(userId);
      for (let i = 0; i < 4; i++) {
        await f.pullRequest(userId, gh.id, {
          createdAtRemote: new Date(`2026-10-0${i + 1}T09:00:00Z`),
          mergedAt: new Date(`2026-10-0${i + 2}T09:00:00Z`),
        });
      }
    }

    it('creates goals with progress from the engine: met, not met, no metric; validates; isolates users', async () => {
      await octoberActivity();
      const create = (body: object) =>
        request(server()).post('/api/goals').set('authorization', as).send(body);
      const met = (
        await create({
          title: 'Merge at least 3 PRs',
          startDate: '2026-07-01',
          metricTarget: { metricKey: 'prs_merged', comparator: 'gte', targetValue: 3 },
        }).expect(201)
      ).body.data;
      expect(met.progress).toMatchObject({
        current: 4,
        target: 3,
        status: 'met',
        evaluatedPeriod: expect.objectContaining({ spec: 'month:2026-10' }),
      });
      const notMet = (
        await create({
          title: 'Merge at least 10',
          startDate: '2026-07-01',
          metricTarget: { metricKey: 'prs_merged', comparator: 'gte', targetValue: 10 },
        }).expect(201)
      ).body.data;
      expect(notMet.progress.status).toBe('not_met');
      const a = (
        await post({ title: 'Mentoring', category: 'mentoring', occurredOn: '2026-10-01' }).expect(
          201,
        )
      ).body.data;
      const plain = (
        await create({ title: 'Grow', startDate: '2026-07-01', achievementIds: [a.id] }).expect(201)
      ).body.data;
      expect(plain.progress).toEqual({
        current: null,
        target: null,
        status: 'no_metric',
        evaluatedPeriod: null,
      });
      expect(plain.achievementIds).toEqual([a.id]);

      const detail = await request(server())
        .get(`/api/goals/${plain.id}`)
        .set('authorization', as)
        .expect(200);
      expect(detail.body.data.achievements.map((x: { id: string }) => x.id)).toEqual([a.id]);
      const ach = await request(server())
        .get(`/api/achievements/${a.id}`)
        .set('authorization', as)
        .expect(200);
      expect(ach.body.data.goalIds).toEqual([plain.id]);

      const list = await request(server()).get('/api/goals').set('authorization', as).expect(200);
      expect(list.body.meta.total).toBe(3);

      for (const body of [
        { title: '', startDate: '2026-07-01' },
        { title: 'x', startDate: '2026-07-01', targetDate: '2026-06-01' },
        {
          title: 'x',
          startDate: '2026-07-01',
          metricTarget: { metricKey: 'loc', comparator: 'gte', targetValue: 1 },
        },
        {
          title: 'x',
          startDate: '2026-07-01',
          metricTarget: { metricKey: 'prs_merged', comparator: 'eq', targetValue: 1 },
        },
        {
          title: 'x',
          startDate: '2026-07-01',
          metricTarget: { metricKey: 'prs_merged', comparator: 'gte', targetValue: -1 },
        },
      ]) {
        const res = await create(body);
        expect([res.status, res.body.error.code]).toEqual([400, 'VALIDATION_FAILED']);
      }

      const bob = await f.user();
      const bobAch = (
        await post(
          { title: 'Bob', category: 'other', occurredOn: '2026-10-01' },
          bearer(bob.id),
        ).expect(201)
      ).body.data;
      await create({ title: 'Steal', startDate: '2026-07-01', achievementIds: [bobAch.id] }).expect(
        404,
      );
      await request(server())
        .get(`/api/goals/${met.id}`)
        .set('authorization', bearer(bob.id))
        .expect(404);
      await request(server())
        .patch(`/api/goals/${met.id}`)
        .set('authorization', bearer(bob.id))
        .send({ title: 'x' })
        .expect(404);
      await request(server())
        .delete(`/api/goals/${met.id}`)
        .set('authorization', bearer(bob.id))
        .expect(404);
    });

    it('reports no_data when the metric is insufficient and updates status / target / links', async () => {
      const g = (
        await request(server())
          .post('/api/goals')
          .set('authorization', as)
          .send({
            title: 'Fast reviews',
            startDate: '2026-07-01',
            metricTarget: {
              metricKey: 'review_turnaround_median_hours',
              comparator: 'lte',
              targetValue: 8,
            },
          })
          .expect(201)
      ).body.data;
      expect(g.progress).toMatchObject({ status: 'no_data', current: null, target: 8 });
      const patched = await request(server())
        .patch(`/api/goals/${g.id}`)
        .set('authorization', as)
        .send({ status: 'achieved', metricTarget: null })
        .expect(200);
      expect(patched.body.data).toMatchObject({
        status: 'achieved',
        metricTarget: null,
        progress: { status: 'no_metric' },
      });
      await request(server())
        .patch(`/api/goals/${g.id}`)
        .set('authorization', as)
        .send({ targetDate: '2026-01-01' })
        .expect(400);
      const archived = await request(server())
        .get('/api/goals?status=archived')
        .set('authorization', as)
        .expect(200);
      expect(archived.body.data).toEqual([]);
      await request(server()).delete(`/api/goals/${g.id}`).set('authorization', as).expect(200);
    });
  });
});
