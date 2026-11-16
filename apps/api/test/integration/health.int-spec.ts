import request from 'supertest';

import { createTestApp, type TestApp } from '../utils/app';

describe('Health endpoints (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('GET /api/health (readiness) returns 200 when Postgres and Redis are reachable', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({
      success: true,
      data: { status: 'ok', checks: { database: 'ok', redis: 'ok' } },
    });
  });

  it('GET /api/health/live (liveness) needs no dependencies', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/health/live').expect(200);
    expect(res.body.data).toMatchObject({
      status: 'ok',
      version: expect.any(String),
      uptimeSeconds: expect.any(Number),
    });
  });
});
