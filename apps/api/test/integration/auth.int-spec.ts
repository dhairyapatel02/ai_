import request from 'supertest';

import { listRoutes, type RouteInfo } from '../../src/openapi/routes';
import { createTestApp, type TestApp } from '../utils/app';
import { bearer, signTestToken } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';

/** A syntactically valid cuid that matches no row. */
const SOME_ID = 'cmw0000000000000000000000';

const concrete = (route: RouteInfo) => route.path.replace(/:[A-Za-z0-9_]+/g, SOME_ID);

function send(t: TestApp, route: RouteInfo) {
  const agent = request(t.app.getHttpServer());
  const path = concrete(route);
  switch (route.method) {
    case 'GET':
      return agent.get(path);
    case 'POST':
      return agent.post(path).send({});
    case 'PATCH':
      return agent.patch(path).send({});
    case 'PUT':
      return agent.put(path).send({});
    case 'DELETE':
      return agent.delete(path);
  }
}

describe('Authentication on every route (integration, generated from the router)', () => {
  let t: TestApp;
  let f: Factories;
  let routes: RouteInfo[];

  beforeAll(async () => {
    t = await createTestApp();
    f = buildFactories(t.prisma);
    routes = listRoutes(t.app);
    await resetRedisState();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  afterAll(async () => {
    await t.close();
  });

  it('discovers the router (sanity check on the generator itself)', () => {
    const keys = routes.map((r) => `${r.method} ${r.path}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        'GET /api/me',
        'DELETE /api/me',
        'GET /api/integrations',
        'POST /api/integrations/github/callback',
        'DELETE /api/integrations/:id',
        'GET /api/documents/:id',
        'POST /api/documents',
        'GET /api/documents/:id/stream',
        'POST /api/ai/achievement-statement',
        'POST /api/impact/highlights',
        'GET /api/me/usage',
        'GET /api/health',
      ]),
    );
    expect(routes.length).toBeGreaterThan(20);
    // Public: health, the signature-gated GitHub webhook (P06) and token-gated unsubscribe (P12).
    expect(routes.filter((r) => r.isPublic).map((r) => r.path)).toEqual([
      '/api/health',
      '/api/health/live',
      '/api/notifications/unsubscribe',
      '/api/webhooks/github',
    ]);
  });

  it('every non-public route returns 401 UNAUTHENTICATED without a token', async () => {
    const protectedRoutes = routes.filter((r) => !r.isPublic);
    for (const route of protectedRoutes) {
      const res = await send(t, route);
      expect({ route: `${route.method} ${route.path}`, status: res.status }).toEqual({
        route: `${route.method} ${route.path}`,
        status: 401,
      });
      expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHENTICATED' } });
      expect(typeof res.body.error.requestId).toBe('string');
    }
  });

  it('every non-public route returns 401 for forged, expired or wrong-audience tokens', async () => {
    const user = await f.user();
    const bad = [
      bearer(user.id, { forged: true }),
      bearer(user.id, { expiresIn: -3600 }),
      bearer(user.id, { aud: 'other' }),
    ];
    for (const route of routes.filter((r) => !r.isPublic)) {
      for (const authorization of bad) {
        const res = await send(t, route).set('authorization', authorization);
        expect({ route: `${route.method} ${route.path}`, status: res.status }).toEqual({
          route: `${route.method} ${route.path}`,
          status: 401,
        });
      }
    }
  });

  it('the x-user-id header grants nothing (SEC-01)', async () => {
    const victim = await f.user();
    const res = await request(t.app.getHttpServer()).get('/api/me').set('x-user-id', victim.id);
    expect(res.status).toBe(401);

    const attacker = await f.user();
    const asAttacker = await request(t.app.getHttpServer())
      .get('/api/me')
      .set('authorization', bearer(attacker.id))
      .set('x-user-id', victim.id)
      .expect(200);
    expect(asAttacker.body.data.user.id).toBe(attacker.id);
  });

  it('public routes work without a token', async () => {
    await request(t.app.getHttpServer()).get('/api/health').expect(200);
    await request(t.app.getHttpServer()).get('/api/health/live').expect(200);
  });

  it('a valid token for a deleted account is rejected', async () => {
    const res = await request(t.app.getHttpServer())
      .get('/api/me')
      .set('authorization', `Bearer ${signTestToken('cdeleted0000000000000000')}`);
    expect(res.status).toBe(401);
  });

  it('v0.1 auth endpoints are gone (dev-login lives in the web app, SEC-02 / API-03)', async () => {
    for (const path of ['/api/auth/dev-login', '/api/auth/github', '/api/auth/google']) {
      const res = await request(t.app.getHttpServer()).post(path).send({ email: 'x@y.z' });
      expect([401, 404]).toContain(res.status);
      expect(res.body.success).toBe(false);
    }
  });
});
