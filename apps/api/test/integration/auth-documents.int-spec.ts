import request from 'supertest';

import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';

describe('Me + Documents API (integration)', () => {
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

  it('GET /api/me returns user, lazily created settings, entitlements and integrations', async () => {
    const user = await f.user({ plan: 'PRO' });
    await f.integration(user.id, { externalLogin: 'octocat', externalAccountId: 'node-1' });

    const res = await request(t.app.getHttpServer())
      .get('/api/me')
      .set('authorization', bearer(user.id))
      .expect(200);
    expect(res.body.data).toMatchObject({
      user: { id: user.id, email: user.email, plan: 'pro', image: null },
      settings: { timezone: 'UTC', defaultPeriodType: 'month', digestEnabled: false },
      entitlements: {
        plan: 'pro',
        limits: { integrations: 4, integrationsPerProvider: 1, historyMonths: 36 },
        usage: { integrations: 1, byProvider: { github: 1 } },
      },
      integrations: [{ provider: 'github', status: 'active', externalLogin: 'octocat' }],
      onboarding: { step: null, completed: false },
    });
    expect(await t.prisma.userSettings.count({ where: { userId: user.id } })).toBe(1);
  });

  it('PATCH /api/me/settings validates the IANA time zone and updates settings', async () => {
    const user = await f.user();
    const as = bearer(user.id);
    const server = t.app.getHttpServer();

    const bad = await request(server)
      .patch('/api/me/settings')
      .set('authorization', as)
      .send({ timezone: 'Mars/Olympus' })
      .expect(400);
    expect(bad.body.error.details.issues[0].path).toBe('body.timezone');
    await request(server)
      .patch('/api/me/settings')
      .set('authorization', as)
      .send({ plan: 'pro' })
      .expect(400);

    const ok = await request(server)
      .patch('/api/me/settings')
      .set('authorization', as)
      .send({ timezone: 'Europe/Berlin', defaultPeriodType: 'quarter', onboardingCompleted: true })
      .expect(200);
    expect(ok.body.data).toMatchObject({ timezone: 'Europe/Berlin', defaultPeriodType: 'quarter' });
    expect(ok.body.data.onboardingCompletedAt).toEqual(expect.any(String));
  });

  it('PATCH /api/me cannot change the plan (unknown keys rejected)', async () => {
    const user = await f.user();
    const as = bearer(user.id);
    await request(t.app.getHttpServer())
      .patch('/api/me')
      .set('authorization', as)
      .send({ name: 'New', plan: 'PRO' })
      .expect(400);
    const ok = await request(t.app.getHttpServer())
      .patch('/api/me')
      .set('authorization', as)
      .send({ name: 'New Name' })
      .expect(200);
    expect(ok.body.data.user).toMatchObject({ name: 'New Name', plan: 'free' });
  });

  it('DELETE /api/me requires the account email, then deletes every user-owned row (cascade)', async () => {
    const user = await f.user();
    const gh = await f.integration(user.id);
    await f.commit(user.id, gh.id);
    await f.document(user.id);
    await t.prisma.session.create({
      data: {
        userId: user.id,
        token: 'session-token',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const keep = await f.user();
    const server = t.app.getHttpServer();

    await request(server)
      .delete('/api/me')
      .set('authorization', bearer(user.id))
      .send({})
      .expect(400);
    const res = await request(server)
      .delete('/api/me')
      .set('authorization', bearer(user.id))
      .send({ confirmEmail: user.email.toUpperCase() })
      .expect(202);
    expect(res.body).toEqual({ success: true, data: { deleted: true } });

    expect(await t.prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect(await t.prisma.integration.count({ where: { userId: user.id } })).toBe(0);
    expect(await t.prisma.commit.count({ where: { userId: user.id } })).toBe(0);
    expect(await t.prisma.generatedDocument.count({ where: { userId: user.id } })).toBe(0);
    expect(await t.prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await t.prisma.user.count({ where: { id: keep.id } })).toBe(1);

    // The still-valid JWT no longer works for the deleted account.
    await request(server).get('/api/me').set('authorization', bearer(user.id)).expect(401);
  });

  it('documents are scoped to their owner (404 for others, BUG-12 typed not-found)', async () => {
    const owner = await f.user();
    const other = await f.user();
    const doc = await f.document(owner.id);
    const server = t.app.getHttpServer();

    const list = await request(server)
      .get('/api/documents')
      .set('authorization', bearer(owner.id))
      .expect(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data).toHaveLength(1);

    const foreign = await request(server)
      .get(`/api/documents/${doc.id}`)
      .set('authorization', bearer(other.id))
      .expect(404);
    expect(foreign.body.error.code).toBe('NOT_FOUND');

    await request(server)
      .delete(`/api/documents/${doc.id}`)
      .set('authorization', bearer(other.id))
      .expect(404);
    expect(await t.prisma.generatedDocument.count()).toBe(1);

    const deleted = await request(server)
      .delete(`/api/documents/${doc.id}`)
      .set('authorization', bearer(owner.id))
      .expect(200);
    expect(deleted.body.data).toEqual({ deleted: true });
    expect(await t.prisma.generatedDocument.count()).toBe(0);
  });
});
