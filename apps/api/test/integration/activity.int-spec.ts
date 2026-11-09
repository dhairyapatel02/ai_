import request from 'supertest';

import { createTestApp, type TestApp } from '../utils/app';
import { resetDatabase } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';

describe('Activity API (integration)', () => {
  let t: TestApp;
  let f: Factories;

  beforeAll(async () => {
    t = await createTestApp();
    f = buildFactories(t.prisma);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  afterAll(async () => {
    await t.close();
  });

  it('GET /api/activity/summary aggregates only the caller’s activity within the range', async () => {
    const alice = await f.user();
    const bob = await f.user();
    const aliceGh = await f.integration(alice.id);
    const bobGh = await f.integration(bob.id);

    await f.commit(alice.id, aliceGh.id, { repo: 'acme/api' });
    await f.commit(alice.id, aliceGh.id, { repo: 'acme/api' });
    await f.commit(alice.id, aliceGh.id, { repo: 'acme/web' });
    // Outside the requested range:
    await f.commit(alice.id, aliceGh.id, { timestamp: new Date('2025-01-01T00:00:00Z') });
    const pr = await f.pullRequest(alice.id, aliceGh.id);
    await f.codeReview(alice.id, pr.id);
    // Another user's data must never leak in:
    await f.commit(bob.id, bobGh.id);

    const res = await request(t.app.getHttpServer())
      .get('/api/activity/summary')
      .query({ from: '2026-10-01T00:00:00Z', to: '2026-10-31T23:59:59Z' })
      .set('x-user-id', alice.id)
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      data: {
        totalCommits: 3,
        totalPRs: 1,
        totalReviews: 1,
        totalIssues: 0,
        topRepos: [
          { repo: 'acme/api', commits: 2 },
          { repo: 'acme/web', commits: 1 },
        ],
        impactScore: null,
      },
    });
  });

  it('GET /api/activity/commits paginates newest first', async () => {
    const user = await f.user();
    const gh = await f.integration(user.id);
    for (let day = 1; day <= 3; day++) {
      await f.commit(user.id, gh.id, {
        message: `day ${day}`,
        timestamp: new Date(`2026-10-0${day}T10:00:00Z`),
      });
    }

    const res = await request(t.app.getHttpServer())
      .get('/api/activity/commits')
      .query({ page: 1, limit: 2 })
      .set('x-user-id', user.id)
      .expect(200);

    expect(res.body.data.total).toBe(3);
    expect(res.body.data.data.map((c: { message: string }) => c.message)).toEqual([
      'day 3',
      'day 2',
    ]);
  });

  it('characterization (SEC-01, fixed in P05): requests without x-user-id get a 200 error body', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/activity/summary').expect(200);
    expect(res.body).toEqual({ success: false, error: 'Not authenticated' });
  });
});
