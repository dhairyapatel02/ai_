import { Writable } from 'node:stream';

import request from 'supertest';

import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories } from '../utils/factories';

/** Structured logs carry request ids and user ids, and never tokens or secrets (ARCHITECTURE_V2 §10–11). */
describe('Structured request logging (integration)', () => {
  let t: TestApp;
  const lines: string[] = [];

  beforeAll(async () => {
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
        done();
      },
    });
    t = await createTestApp(undefined, { logStream: stream });
    await resetDatabase(t.prisma);
    await resetRedisState();
  });

  afterAll(async () => {
    await t.close();
  });

  it('logs request id, user id, status and latency; redacts Authorization and cookies', async () => {
    const user = await buildFactories(t.prisma).user();
    const authorization = bearer(user.id);
    const token = authorization.slice('Bearer '.length);
    const requestId = '0f8fad5b-d9cb-469f-a165-70867728950e';

    await request(t.app.getHttpServer())
      .get('/api/me?secret=query-value')
      .set('authorization', authorization)
      .set('cookie', 'better-auth.session_token=session-cookie-secret')
      .set('x-request-id', requestId)
      .expect(200);
    await request(t.app.getHttpServer())
      .post('/api/integrations/github/callback')
      .set('authorization', authorization)
      .send({ code: 'oauth-code-secret', state: 'oauth-state-secret' })
      .expect(400);

    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const meLog = entries.find((e) => (e.req as { id?: string } | undefined)?.id === requestId);
    expect(meLog).toMatchObject({
      userId: user.id,
      res: { statusCode: 200 },
      responseTime: expect.any(Number),
      req: {
        method: 'GET',
        url: '/api/me',
        headers: { authorization: '[REDACTED]', cookie: '[REDACTED]' },
      },
    });

    const all = lines.join('\n');
    expect(all).not.toContain(token);
    expect(all).not.toContain('session-cookie-secret');
    expect(all).not.toContain('query-value');
    expect(all).not.toContain('oauth-code-secret');
    expect(all).not.toContain('integration-test-oauth-state-secret');
  });
});
