import request from 'supertest';

import { AIService } from '../../src/ai/ai.service';
import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';

const aiMock = {
  generateResumeBullets: jest.fn(),
  generateAppraisalReport: jest.fn(),
  generatePromotionPacket: jest.fn(),
  calculateImpactScore: jest.fn(),
};

describe('Generate + Sync API (integration, AI mocked)', () => {
  let t: TestApp;
  let f: Factories;

  beforeAll(async () => {
    t = await createTestApp((builder) => builder.overrideProvider(AIService).useValue(aiMock));
    f = buildFactories(t.prisma);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await resetRedisState();
    jest.resetAllMocks();
  });

  afterAll(async () => {
    await t.close();
  });

  it('POST /api/generate/resume returns bullets as an array and stores the document (BUG-14)', async () => {
    const user = await f.user();
    const gh = await f.integration(user.id);
    await f.commit(user.id, gh.id, { message: 'feat: add billing' });
    const bullets = [
      { text: 'Shipped billing', category: 'feature', impact: 'Unlocked revenue' },
      { text: 'Cut p95 latency 40%', category: 'performance', impact: 'Faster checkout' },
    ];
    aiMock.generateResumeBullets.mockResolvedValue({ bullets });

    const res = await request(t.app.getHttpServer())
      .post('/api/generate/resume')
      .set('authorization', bearer(user.id))
      .send({ dateRange: { from: '2026-10-01', to: '2026-10-31' }, role: 'backend' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.bullets).toEqual(bullets);
    expect(res.body.data.document.type).toBe('RESUME');
    expect(await t.prisma.generatedDocument.count({ where: { userId: user.id } })).toBe(1);

    const [activity, , role] = aiMock.generateResumeBullets.mock.calls[0];
    expect(activity.commits).toEqual([
      { message: 'feat: add billing', repo: 'acme/api', additions: 10, deletions: 2 },
    ]);
    expect(role).toBe('backend');
  });

  it('POST /api/generate/resume → 502 UPSTREAM_ERROR (and saves nothing) when the model output is malformed', async () => {
    const user = await f.user();
    aiMock.generateResumeBullets.mockResolvedValue({ unexpected: true });

    const res = await request(t.app.getHttpServer())
      .post('/api/generate/resume')
      .set('authorization', bearer(user.id))
      .send({ dateRange: { from: '2026-10-01', to: '2026-10-31' }, role: 'backend' })
      .expect(502);

    expect(res.body.error.code).toBe('UPSTREAM_ERROR');
    expect(await t.prisma.generatedDocument.count()).toBe(0);
  });

  it('POST /api/sync/trigger: 404 without an integration, 409 when it needs reauth, else 202 queued', async () => {
    const user = await f.user();
    const server = t.app.getHttpServer();
    const as = bearer(user.id);

    const missing = await request(server)
      .post('/api/sync/trigger')
      .set('authorization', as)
      .expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    const legacy = await f.integration(user.id, { status: 'NEEDS_REAUTH', mechanism: 'OAUTH_APP' });
    const reauth = await request(server)
      .post('/api/sync/trigger')
      .set('authorization', as)
      .expect(409);
    expect(reauth.body.error).toMatchObject({
      code: 'INTEGRATION_NEEDS_REAUTH',
      details: { integrationId: legacy.id },
    });

    await t.prisma.integration.update({ where: { id: legacy.id }, data: { status: 'ACTIVE' } });
    const queued = await request(server)
      .post('/api/sync/trigger')
      .set('authorization', as)
      .expect(202);
    expect(queued.body.data.status).toBe('queued');

    const status = await request(server)
      .get('/api/sync/status')
      .set('authorization', as)
      .expect(200);
    expect(status.body.data.jobId).toBe(queued.body.data.jobId);
  });
});
