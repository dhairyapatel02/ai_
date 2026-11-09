import request from 'supertest';

import { createTestApp, type TestApp } from '../utils/app';

describe('GET /api/health (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('returns 200 when Postgres and Redis are reachable', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({
      success: true,
      data: { status: 'ok', checks: { database: 'up', redis: 'up' } },
    });
  });
});
