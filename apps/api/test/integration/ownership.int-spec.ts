import request from 'supertest';

import { AIService } from '../../src/ai/ai.service';
import { GitHubAppClient } from '../../src/integrations/github-app.client';
import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';

const aiMock = {
  generateResumeBullets: jest.fn().mockResolvedValue({ bullets: [{ text: 'x' }] }),
  generateAppraisalReport: jest.fn().mockResolvedValue({}),
  generatePromotionPacket: jest.fn().mockResolvedValue({}),
};
const githubMock = {
  revokeToken: jest.fn().mockResolvedValue(true),
  manageUrl: () => 'https://github.com/apps/devimpact-test',
};

/**
 * User A can never read, modify or delete user B's resources (ARCHITECTURE_V2 §12). Foreign ids
 * return 404 (not 403/500) so existence does not leak.
 */
describe('Cross-user isolation (integration)', () => {
  let t: TestApp;
  let f: Factories;

  beforeAll(async () => {
    t = await createTestApp((b) =>
      b
        .overrideProvider(AIService)
        .useValue(aiMock)
        .overrideProvider(GitHubAppClient)
        .useValue(githubMock),
    );
    f = buildFactories(t.prisma);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await resetRedisState();
  });

  afterAll(async () => {
    await t.close();
  });

  async function twoTenants() {
    const alice = await f.user();
    const bob = await f.user();
    const bobGh = await f.integration(bob.id, { externalAccountId: 'node-bob' });
    const bobDoc = await f.document(bob.id);
    const bobCommit = await f.commit(bob.id, bobGh.id, { message: 'bob secret commit' });
    const bobPr = await f.pullRequest(bob.id, bobGh.id, { title: 'bob secret PR' });
    await f.review(bob.id, bobGh.id);
    return {
      alice,
      bob,
      bobGh,
      bobDoc,
      bobCommit,
      bobPr,
      server: t.app.getHttpServer(),
      as: bearer(alice.id),
    };
  }

  it('documents: get / delete of a foreign id → 404, list shows only own', async () => {
    const { bobDoc, server, as, alice } = await twoTenants();
    await f.document(alice.id);

    const get = await request(server)
      .get(`/api/documents/${bobDoc.id}`)
      .set('authorization', as)
      .expect(404);
    expect(get.body.error.code).toBe('NOT_FOUND');
    await request(server)
      .delete(`/api/documents/${bobDoc.id}`)
      .set('authorization', as)
      .expect(404);
    expect(await t.prisma.generatedDocument.count({ where: { id: bobDoc.id } })).toBe(1);

    const list = await request(server).get('/api/documents').set('authorization', as).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].userId).toBe(alice.id);
  });

  it('integrations: get / reconnect / delete of a foreign id → 404; list shows only own', async () => {
    const { bobGh, server, as } = await twoTenants();
    await request(server).get(`/api/integrations/${bobGh.id}`).set('authorization', as).expect(404);
    await request(server)
      .post(`/api/integrations/${bobGh.id}/reconnect`)
      .set('authorization', as)
      .expect(404);
    await request(server)
      .delete(`/api/integrations/${bobGh.id}`)
      .set('authorization', as)
      .expect(404);
    await request(server)
      .delete(`/api/integrations/${bobGh.id}?purgeData=true`)
      .set('authorization', as)
      .expect(404);

    const row = await t.prisma.integration.findUniqueOrThrow({ where: { id: bobGh.id } });
    expect(row.status).toBe('ACTIVE');
    expect(await t.prisma.commit.count({ where: { integrationId: bobGh.id } })).toBe(1);
    expect(githubMock.revokeToken).not.toHaveBeenCalled();

    const list = await request(server)
      .get('/api/integrations')
      .set('authorization', as)
      .expect(200);
    expect(list.body.data).toEqual([]);
  });

  it('activity: lists and summaries never include another user’s rows', async () => {
    const { server, as } = await twoTenants();
    const commits = await request(server)
      .get('/api/activity/commits')
      .set('authorization', as)
      .expect(200);
    const prs = await request(server)
      .get('/api/activity/prs?role=authored')
      .set('authorization', as)
      .expect(200);
    const summary = await request(server)
      .get('/api/activity/summary')
      .set('authorization', as)
      .expect(200);
    expect(commits.body.data).toEqual([]);
    expect(prs.body.data).toEqual([]);
    expect(summary.body.data).toMatchObject({ totalCommits: 0, totalPRs: 0, totalReviews: 0 });
  });

  it('generation reads only the caller’s activity', async () => {
    const { server, as } = await twoTenants();
    await request(server)
      .post('/api/generate/resume')
      .set('authorization', as)
      .send({ dateRange: { from: '2020-01-01', to: '2030-12-31' }, role: 'backend' })
      .expect(201);
    const [activity] = aiMock.generateResumeBullets.mock.calls[0] as [
      { commits: unknown[]; prs: unknown[] },
    ];
    expect(activity.commits).toEqual([]);
    expect(activity.prs).toEqual([]);
  });

  it('sync and repos: only the caller’s integration, runs and repositories', async () => {
    const { server, as, bobGh, bob } = await twoTenants();
    const bobRun = await t.prisma.syncRun.create({
      data: { userId: bob.id, integrationId: bobGh.id, trigger: 'MANUAL', kind: 'INCREMENTAL' },
    });
    const bobRepo = await f.repository(bob.id, bobGh.id, 'acme/api');
    // Alice has no integration — Bob's must not be used, even when named explicitly.
    for (const body of [{}, { integrationId: bobGh.id }]) {
      const res = await request(server)
        .post('/api/sync')
        .set('authorization', as)
        .send(body)
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    await request(server).get('/api/sync/status').set('authorization', as).expect(404);
    await request(server)
      .get(`/api/sync/status?integrationId=${bobGh.id}`)
      .set('authorization', as)
      .expect(404);
    await request(server).get(`/api/sync/runs/${bobRun.id}`).set('authorization', as).expect(404);
    const runs = await request(server).get('/api/sync/runs').set('authorization', as).expect(200);
    expect(runs.body.data).toEqual([]);
    const repos = await request(server).get('/api/repos').set('authorization', as).expect(200);
    expect(repos.body.data).toEqual([]);
    await request(server)
      .patch(`/api/repos/${bobRepo.id}`)
      .set('authorization', as)
      .send({ included: false })
      .expect(404);
    await request(server)
      .post(`/api/repos/${bobRepo.id}/purge`)
      .set('authorization', as)
      .expect(404);
    const bulk = await request(server)
      .patch('/api/repos')
      .set('authorization', as)
      .send({ ids: [bobRepo.id], included: false })
      .expect(200);
    expect(bulk.body.data).toEqual({ updated: 0 });
    expect(
      (await t.prisma.repository.findUniqueOrThrow({ where: { id: bobRepo.id } })).included,
    ).toBe(true);
  });

  it('me: profile, settings and account deletion only ever touch the caller', async () => {
    const { alice, bob, server, as } = await twoTenants();
    const me = await request(server).get('/api/me').set('authorization', as).expect(200);
    expect(me.body.data.user.email).toBe(alice.email);

    // Typing someone else's email does not delete them (or you).
    await request(server)
      .delete('/api/me')
      .set('authorization', as)
      .send({ confirmEmail: bob.email })
      .expect(400);
    expect(await t.prisma.user.count()).toBe(2);
  });
});
