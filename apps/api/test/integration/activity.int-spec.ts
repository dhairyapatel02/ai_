import request from 'supertest';

import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
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
    await resetRedisState();
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
    await f.pullRequest(alice.id, aliceGh.id);
    await f.review(alice.id, aliceGh.id);
    // Another user's data must never leak in:
    await f.commit(bob.id, bobGh.id);

    const res = await request(t.app.getHttpServer())
      .get('/api/activity/summary')
      .query({ from: '2026-10-01', to: '2026-10-31' })
      .set('authorization', bearer(alice.id))
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

  it('GET /api/activity/commits paginates newest first with a cursor', async () => {
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
      .query({ limit: 2 })
      .set('authorization', bearer(user.id))
      .expect(200);

    expect(res.body.meta.hasMore).toBe(true);
    expect(res.body.data.map((c: { message: string }) => c.message)).toEqual(['day 3', 'day 2']);
  });

  it('respects the user’s time zone for date-only bounds (D-019)', async () => {
    const user = await f.user();
    await t.prisma.userSettings.create({ data: { userId: user.id, timezone: 'Asia/Tokyo' } });
    const gh = await f.integration(user.id);
    // 2026-10-01 local in Tokyo is [2026-09-30T15:00Z, 2026-10-01T15:00Z).
    await f.commit(user.id, gh.id, { timestamp: new Date('2026-09-30T16:00:00Z') });
    await f.commit(user.id, gh.id, { timestamp: new Date('2026-10-01T16:00:00Z') });

    const res = await request(t.app.getHttpServer())
      .get('/api/activity/summary')
      .query({ from: '2026-10-01', to: '2026-10-01' })
      .set('authorization', bearer(user.id))
      .expect(200);
    expect(res.body.data.totalCommits).toBe(1);
  });

  it('SEC-01 fixed: requests without a token get 401 with the error envelope', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/activity/summary').expect(401);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
        requestId: expect.any(String),
      },
    });
  });
});
