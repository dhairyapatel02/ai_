import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';

import { SyncTargetedService } from '../../src/sync/sync-targeted.service';
import { SYNC_QUEUE, targetedJobId } from '../../src/sync/sync.constants';
import { createTestApp, type TestApp } from '../utils/app';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';
import { installFakeGitHub, type FakeGitHubState } from '../utils/fake-github';
import { connectGitHub, loadDataset, loadWebhook, runSync, sign } from '../utils/github-fixtures';

import type { TargetedJobData } from '../../src/webhooks/webhooks.service';
import type { Queue } from 'bullmq';

describe('POST /api/webhooks/github (integration)', () => {
  let t: TestApp;
  let f: Factories;
  let gh: FakeGitHubState;
  let restore: () => void;
  let delivery = 0;
  const server = () => t.app.getHttpServer();
  const queue = () => t.app.get<Queue<TargetedJobData>>(getQueueToken(SYNC_QUEUE));

  function send(
    event: string,
    payload: unknown,
    options: { id?: string; signature?: string | null } = {},
  ) {
    const body = JSON.stringify(payload);
    const id = options.id ?? `d0000000-0000-4000-8000-${String(++delivery).padStart(12, '0')}`;
    const req = request(server())
      .post('/api/webhooks/github')
      .set('content-type', 'application/json')
      .set('x-github-event', event)
      .set('x-github-delivery', id);
    if (options.signature !== null) req.set('x-hub-signature-256', options.signature ?? sign(body));
    return { req: req.send(body), id };
  }

  /** Runs the queued targeted job in-process (tests never start the worker). */
  async function process(id: string) {
    const job = await queue().getJob(targetedJobId(id));
    if (!job) throw new Error(`no targeted job for ${id}`);
    await t.app.get(SyncTargetedService).handle(job.data);
  }

  beforeAll(async () => {
    t = await createTestApp();
    f = buildFactories(t.prisma);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await resetRedisState();
    ({ state: gh, restore } = installFakeGitHub());
    gh.dataset = loadDataset();
  });

  afterEach(() => {
    restore();
  });

  afterAll(async () => {
    await t.close();
  });

  async function syncedUser() {
    const user = await f.user();
    const integration = await connectGitHub(t, gh, user.id);
    await runSync(t, user.id, integration.id);
    return { user, integration };
  }

  it('rejects a bad or missing signature with 401 WEBHOOK_SIGNATURE_INVALID (nothing stored or queued)', async () => {
    const payload = loadWebhook('pull_request.edited');
    const bad = await send('pull_request', payload, {
      signature: sign(JSON.stringify(payload), 'wrong-secret'),
    }).req.expect(401);
    expect(bad.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    await send('pull_request', payload, { signature: null }).req.expect(401);
    await send('pull_request', payload, { signature: 'sha256=zz' }).req.expect(401);
    // Signature over different bytes (re-serialised body) is rejected too.
    await send('pull_request', payload, {
      signature: sign(JSON.stringify(payload, null, 2)),
    }).req.expect(401);
    expect(await t.prisma.webhookDelivery.count()).toBe(0);
    expect(await queue().count()).toBe(0);
  });

  it('400 when the event/delivery headers are missing or malformed (after the signature check)', async () => {
    const body = JSON.stringify(loadWebhook('push'));
    const res = await request(server())
      .post('/api/webhooks/github')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .send(body)
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('valid pull_request event → 202, recorded, targeted job; the job refetches and updates the PR', async () => {
    const { user } = await syncedUser();
    const pr = gh.dataset.pullRequests.find((p) => p.number === 10);
    if (pr) {
      pr.title = 'Billing v2 (renamed)';
      pr.updatedAt = new Date().toISOString();
    }
    const { req, id } = send('pull_request', loadWebhook('pull_request.edited'));
    const res = await req.expect(202);
    expect(res.body).toEqual({ success: true, data: { accepted: true, duplicate: false } });
    expect(await t.prisma.webhookDelivery.findUnique({ where: { id } })).toMatchObject({
      event: 'pull_request',
      action: 'edited',
      status: 'RECEIVED',
      installationId: 102n,
    });

    gh.log.length = 0;
    await process(id);
    const row = await t.prisma.pullRequest.findFirstOrThrow({
      where: { userId: user.id, externalId: 'PR_api_10' },
    });
    expect(row.title).toBe('Billing v2 (renamed)');
    expect(gh.log.map((e) => e.operation)).toEqual(['DevImpactPullRequest']); // one targeted call
    expect(await t.prisma.webhookDelivery.findUnique({ where: { id } })).toMatchObject({
      status: 'PROCESSED',
    });
    const runs = await t.prisma.syncRun.findMany({ where: { userId: user.id, kind: 'TARGETED' } });
    expect(runs).toEqual([
      expect.objectContaining({ trigger: 'WEBHOOK', status: 'SUCCEEDED', webhookDeliveryId: id }),
    ]);
  });

  it('a replayed delivery is acknowledged as a duplicate and ignored', async () => {
    const payload = loadWebhook('pull_request.edited');
    const { req, id } = send('pull_request', payload);
    await req.expect(202);
    const replay = await send('pull_request', payload, { id }).req.expect(202);
    expect(replay.body.data).toEqual({ accepted: true, duplicate: true });
    expect(await t.prisma.webhookDelivery.count()).toBe(1);
    expect(await queue().count()).toBe(1);
  });

  it('pull_request_review by the user creates a reviewed PR + review, never an authored PR', async () => {
    const { user } = await syncedUser();
    const pr60 = gh.dataset.pullRequests.find((p) => p.number === 60);
    if (pr60)
      pr60.reviews = [
        {
          id: 'RV_octo_60',
          author: 'octo',
          state: 'APPROVED',
          submittedAt: new Date().toISOString(),
        },
      ];
    const authoredBefore = await t.prisma.pullRequest.count({
      where: { userId: user.id, isAuthoredByUser: true },
    });
    const { req, id } = send('pull_request_review', loadWebhook('pull_request_review.submitted'));
    await req.expect(202);
    await process(id);
    const row = await t.prisma.pullRequest.findFirstOrThrow({
      where: { userId: user.id, externalId: 'PR_api_60' },
      include: { reviews: true },
    });
    expect(row).toMatchObject({ isAuthoredByUser: false, body: null });
    expect(row.reviews).toEqual([
      expect.objectContaining({ externalId: 'RV_octo_60', state: 'APPROVED' }),
    ]);
    expect(
      await t.prisma.pullRequest.count({ where: { userId: user.id, isAuthoredByUser: true } }),
    ).toBe(authoredBefore);
  });

  it('push to the default branch imports the new commits; other branches are ignored', async () => {
    const { user } = await syncedUser();
    gh.dataset.commits.push({
      sha: 'a000000000000000000000000000000000000004',
      repo: 'octo/app',
      authorNodeId: 'U_octo',
      message: 'feat: profile page',
      authoredAt: new Date().toISOString(),
      additions: 5,
      deletions: 0,
    });
    const payload = loadWebhook('push');
    payload.commits = [
      {
        id: 'a000000000000000000000000000000000000004',
        timestamp: new Date().toISOString(),
        author: { username: 'octo' },
      },
    ];
    const { req, id } = send('push', payload);
    await req.expect(202);
    await process(id);
    expect(
      await t.prisma.commit.findFirst({
        where: { userId: user.id, sha: 'a000000000000000000000000000000000000004' },
      }),
    ).toMatchObject({ branch: 'main' });

    const other = send('push', { ...payload, ref: 'refs/heads/feature' });
    await other.req.expect(202);
    expect(await t.prisma.webhookDelivery.findUnique({ where: { id: other.id } })).toMatchObject({
      status: 'IGNORED',
    });
    expect(await queue().getJob(targetedJobId(other.id))).toBeUndefined();
  });

  it('installation_repositories.removed marks private repositories inaccessible', async () => {
    const { user } = await syncedUser();
    const { req, id } = send(
      'installation_repositories',
      loadWebhook('installation_repositories.removed'),
    );
    await req.expect(202);
    await process(id);
    const web = await t.prisma.repository.findFirstOrThrow({
      where: { userId: user.id, fullName: 'acme/web' },
    });
    expect(web).toMatchObject({ accessible: false, installationId: null });
  });

  it('github_app_authorization.revoked → integration needs_reauth (tokens dropped, data kept)', async () => {
    const { user, integration } = await syncedUser();
    const prs = await t.prisma.pullRequest.count({ where: { userId: user.id } });
    const { req, id } = send(
      'github_app_authorization',
      loadWebhook('github_app_authorization.revoked'),
    );
    await req.expect(202);
    await process(id);
    expect(
      await t.prisma.integration.findUniqueOrThrow({ where: { id: integration.id } }),
    ).toMatchObject({
      status: 'NEEDS_REAUTH',
      statusReason: 'GITHUB_APP_AUTHORIZATION_REVOKED',
      accessTokenEnc: null,
    });
    expect(await t.prisma.pullRequest.count({ where: { userId: user.id } })).toBe(prs);
  });

  it('unhandled events are recorded as IGNORED without a job; bodies above the 256 KB JSON limit are accepted', async () => {
    const big = { zen: 'x'.repeat(300 * 1024), hook_id: 1 };
    const { req, id } = send('ping', big);
    await req.expect(202);
    expect(await t.prisma.webhookDelivery.findUnique({ where: { id } })).toMatchObject({
      status: 'IGNORED',
      event: 'ping',
    });
    expect(await queue().count()).toBe(0);
  });
});
