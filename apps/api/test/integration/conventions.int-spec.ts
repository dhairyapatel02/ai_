import request from 'supertest';

import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';

describe('API conventions: validation, errors, envelope, headers, rate limits (integration)', () => {
  let t: TestApp;
  let f: Factories;
  let as: string;
  let userId: string;

  beforeAll(async () => {
    t = await createTestApp();
    f = buildFactories(t.prisma);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await resetDatabase(t.prisma);
    await resetRedisState();
    const user = await f.user();
    userId = user.id;
    as = bearer(user.id);
  });

  afterAll(async () => {
    await t.close();
  });

  const server = () => t.app.getHttpServer();

  describe('validation (BUG-04, BUG-07, SEC-06, API-02)', () => {
    it.each([
      ['/api/activity/commits?limit=100000', 'query.limit'],
      ['/api/activity/commits?limit=-5', 'query.limit'],
      ['/api/activity/commits?from=garbage', 'query.from'],
      ['/api/activity/commits?page=0', 'query'],
      ['/api/activity/commits?from=2026-10-10&to=2026-10-01', 'query.from'],
      ['/api/activity/commits?to=2026-13-01', 'query.to'],
      ['/api/documents?cursor=%25%25', 'query.cursor'],
      ['/api/metrics/overview?period=month:2026-13', 'query.period'],
      ['/api/metrics/timeseries?metric=nope', 'query.metric'],
      [`/api/documents/not-a-cuid`, 'params.id'],
    ])('GET %s → 400 VALIDATION_FAILED mentioning %s', async (path, issuePath) => {
      const res = await request(server()).get(path).set('authorization', as).expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.issues.map((i: { path: string }) => i.path)).toContain(
        issuePath,
      );
    });

    it.each([
      ['/api/documents', {}],
      ['/api/documents', { type: 'resume', period: 'month:2026-10', role: 'x'.repeat(100_000) }],
      ['/api/documents', { type: 'appraisal', period: 'weird' }],
      ['/api/documents', { type: 'promotion' }],
      [
        '/api/documents',
        { type: 'promotion', currentRole: 'IC', targetRole: 'Senior', injected: true },
      ],
      ['/api/ai/achievement-statement', { source: { kind: 'issue', id: 'x' } }],
      ['/api/impact/highlights', { period: 'month:2026-13' }],
      ['/api/integrations/github/callback', { code: 12345 }],
    ])('POST %s with invalid body → 400 before any AI/GitHub call', async (path, body) => {
      const res = await request(server())
        .post(path)
        .set('authorization', as)
        .send(body)
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await t.prisma.generatedDocument.count()).toBe(0);
    });

    it('malformed JSON → 400 with the envelope', async () => {
      const res = await request(server())
        .post('/api/documents')
        .set('authorization', as)
        .set('content-type', 'application/json')
        .send('{"currentRole": ')
        .expect(400);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'Malformed JSON body',
      });
    });

    it('bodies over 256 KB → 413 PAYLOAD_TOO_LARGE', async () => {
      const res = await request(server())
        .post('/api/documents')
        .set('authorization', as)
        .send({ type: 'promotion', currentRole: 'a'.repeat(300 * 1024), targetRole: 'b' })
        .expect(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('errors never return 200 (API-01, SEC-12)', () => {
    it('unknown route → 404 envelope without internals', async () => {
      const res = await request(server())
        .get('/api/does-not-exist')
        .set('authorization', as)
        .expect(404);
      expect(res.body).toEqual({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Route not found', requestId: expect.any(String) },
      });
    });

    it('AI without ANTHROPIC_API_KEY → 503 UPSTREAM_UNAVAILABLE with no internals', async () => {
      const gh = await f.integration(userId);
      await f.pullRequest(userId, gh.id, { mergedAt: new Date('2026-10-16T12:00:00Z') });
      const res = await request(server())
        .post('/api/documents')
        .set('authorization', as)
        .send({ type: 'appraisal', period: 'month:2026-10' })
        .expect(503);
      expect(res.body.error).toMatchObject({
        code: 'UPSTREAM_UNAVAILABLE',
        details: { provider: 'anthropic', reason: 'not_configured' },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/ANTHROPIC_API_KEY|stack/);
      expect(await t.prisma.generatedDocument.count()).toBe(0);
    });
  });

  describe('envelope, pagination and dates', () => {
    it('cursor-paginates commits newest first with meta', async () => {
      const gh = await f.integration(userId);
      for (let day = 1; day <= 3; day++) {
        await f.commit(userId, gh.id, {
          message: `day ${day}`,
          timestamp: new Date(`2026-10-0${day}T10:00:00Z`),
        });
      }
      const first = await request(server())
        .get('/api/activity/commits?limit=2')
        .set('authorization', as)
        .expect(200);
      expect(first.body.data.map((c: { messageHeadline: string }) => c.messageHeadline)).toEqual([
        'day 3',
        'day 2',
      ]);
      expect(first.body.meta).toMatchObject({ hasMore: true, nextCursor: expect.any(String) });

      const second = await request(server())
        .get(`/api/activity/commits?limit=2&cursor=${first.body.meta.nextCursor as string}`)
        .set('authorization', as)
        .expect(200);
      expect(second.body.data.map((c: { messageHeadline: string }) => c.messageHeadline)).toEqual([
        'day 1',
      ]);
      expect(second.body.meta).toEqual({ nextCursor: null, hasMore: false });
    });

    it('BUG-05: `to=YYYY-MM-DD` includes the whole last day', async () => {
      const gh = await f.integration(userId);
      for (const hour of [0, 9, 18, 23]) {
        await f.commit(userId, gh.id, { timestamp: new Date(Date.UTC(2026, 9, 23, hour, 30)) });
      }
      const res = await request(server())
        .get('/api/activity/commits?from=2026-10-23&to=2026-10-23')
        .set('authorization', as)
        .expect(200);
      expect(res.body.data).toHaveLength(4);
    });
  });

  describe('headers', () => {
    it('sets security headers, hides x-powered-by, echoes or generates x-request-id', async () => {
      const res = await request(server()).get('/api/health/live').expect(200);
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

      const id = '123e4567-e89b-12d3-a456-426614174000';
      const echoed = await request(server()).get('/api/health/live').set('x-request-id', id);
      expect(echoed.headers['x-request-id']).toBe(id);
      const replaced = await request(server())
        .get('/api/health/live')
        .set('x-request-id', 'not a valid id; drop table');
      expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('marks authenticated responses private, no-store', async () => {
      const res = await request(server()).get('/api/me').set('authorization', as).expect(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('CORS allows the configured web origin only, without credentials', async () => {
      const ok = await request(server())
        .options('/api/me')
        .set('origin', 'http://localhost:3000')
        .set('access-control-request-method', 'GET')
        .set('access-control-request-headers', 'authorization');
      expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(ok.headers['access-control-allow-credentials']).toBeUndefined();

      const evil = await request(server())
        .options('/api/me')
        .set('origin', 'https://evil.example')
        .set('access-control-request-method', 'GET');
      expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('rate limits (SEC-07, API_CONTRACT_V2 §1.1)', () => {
    it('AI endpoints allow 10 per minute per user, then 429 RATE_LIMITED with Retry-After', async () => {
      // No activity: each request reaches the handler and answers 409 no_evidence (no AI call).
      const body = { type: 'appraisal', period: 'month:2026-10' };
      for (let i = 0; i < 10; i++) {
        const res = await request(server())
          .post('/api/documents')
          .set('authorization', as)
          .send(body);
        expect(res.status).toBe(409);
        expect(res.body.error.details).toEqual({ reason: 'no_evidence' });
        expect(res.headers['ratelimit-limit']).toBe('10');
      }
      const blocked = await request(server())
        .post('/api/documents')
        .set('authorization', as)
        .send(body)
        .expect(429);
      expect(blocked.body.error).toMatchObject({ code: 'RATE_LIMITED', details: { class: 'ai' } });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

      // Limits are per user: another user is unaffected.
      const other = await f.user();
      await request(server())
        .post('/api/documents')
        .set('authorization', bearer(other.id))
        .send(body)
        .expect(409);
    });

    it('the AI class shares one budget across AI endpoints', async () => {
      for (let i = 0; i < 10; i++) {
        await request(server())
          .post('/api/documents')
          .set('authorization', as)
          .send({ type: 'appraisal', period: 'month:2026-10' })
          .expect(409);
      }
      const res = await request(server())
        .post('/api/impact/highlights')
        .set('authorization', as)
        .send({ period: 'month:2026-10' });
      expect(res.status).toBe(429);
    });

    it('destructive routes allow 5 per hour', async () => {
      for (let i = 0; i < 5; i++) {
        await request(server())
          .delete('/api/me')
          .set('authorization', as)
          .send({ confirmEmail: 'wrong@example.test' })
          .expect(400);
      }
      await request(server())
        .delete('/api/me')
        .set('authorization', as)
        .send({ confirmEmail: 'wrong@example.test' })
        .expect(429);
    });
  });

  describe('OpenAPI (non-production)', () => {
    it('serves an OpenAPI 3.1 document generated from the Zod schemas, and Swagger UI', async () => {
      const res = await request(server()).get('/api/docs/openapi.json').expect(200);
      expect(res.body.openapi).toBe('3.1.0');
      const connect = res.body.paths['/api/integrations/github/callback'].post;
      expect(connect.requestBody.content['application/json'].schema.properties).toHaveProperty(
        'state',
      );
      expect(res.body.paths['/api/health'].get.security).toEqual([]);
      expect(res.body.paths['/api/documents'].post['x-rate-limit-class']).toBe('ai');
      expect(res.body.paths['/api/documents/{id}/stream'].get['x-rate-limit-class']).toBe('sse');
      const ui = await request(server()).get('/api/docs').expect(200);
      expect(ui.text).toContain('swagger-ui');
    });
  });
});
