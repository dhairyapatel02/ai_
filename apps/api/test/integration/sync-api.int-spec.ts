import { getQueueToken } from '@nestjs/bullmq';
import Redis from 'ioredis';
import request from 'supertest';

import { FANOUT_PATTERN, SyncScheduler } from '../../src/sync/sync-scheduler.service';
import { SYNC_QUEUE, syncJobId } from '../../src/sync/sync.constants';
import { SyncService } from '../../src/sync/sync.service';
import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';
import { installFakeGitHub, type FakeGitHubState } from '../utils/fake-github';
import { connectGitHub, loadDataset } from '../utils/github-fixtures';

import type { Queue } from 'bullmq';

describe('Sync API, status and scheduler (integration)', () => {
  let t: TestApp;
  let f: Factories;
  let gh: FakeGitHubState;
  let restore: () => void;
  const server = () => t.app.getHttpServer();
  // Queue processors (and the scheduler) live in the worker module, which tests never boot.
  const scheduler = () =>
    new SyncScheduler(
      t.app.get<Queue>(getQueueToken(SYNC_QUEUE)) as never,
      t.prisma,
      t.app.get(SyncService),
    );

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

  it('POST /api/sync → 202 with a queued SyncRun; a second request → 409 SYNC_IN_PROGRESS with the current run', async () => {
    const user = await f.user();
    const integration = await connectGitHub(t, gh, user.id);
    const as = bearer(user.id);

    const first = await request(server())
      .post('/api/sync')
      .set('authorization', as)
      .send({})
      .expect(202);
    expect(first.body.data.syncRun).toMatchObject({
      integrationId: integration.id,
      status: 'queued',
      kind: 'backfill',
      trigger: 'manual',
      progress: 0,
    });
    const queue = t.app.get<Queue>(getQueueToken(SYNC_QUEUE));
    const job = await queue.getJob(syncJobId(integration.id));
    expect(job?.name).toBe('sync.backfill');
    // Jobs carry ids only — never tokens (ADR-0005).
    expect(job?.data).toEqual({
      syncRunId: first.body.data.syncRun.id,
      integrationId: integration.id,
      userId: user.id,
    });

    const second = await request(server())
      .post('/api/sync')
      .set('authorization', as)
      .send({ integrationId: integration.id })
      .expect(409);
    expect(second.body.error).toMatchObject({
      code: 'SYNC_IN_PROGRESS',
      details: { syncRunId: first.body.data.syncRun.id },
    });
    expect(await t.prisma.syncRun.count()).toBe(1);
  });

  it('POST /api/sync is limited to 6 per hour per integration (429 + Retry-After)', async () => {
    const user = await f.user();
    const integration = await connectGitHub(t, gh, user.id);
    const as = bearer(user.id);
    for (let i = 0; i < 6; i++) {
      await request(server())
        .post('/api/sync')
        .set('authorization', as)
        .send({})
        .expect(i === 0 ? 202 : 409);
    }
    const limited = await request(server())
      .post('/api/sync')
      .set('authorization', as)
      .send({})
      .expect(429);
    expect(limited.body.error).toMatchObject({ code: 'RATE_LIMITED', details: { class: 'sync' } });
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
    expect(await t.prisma.syncRun.count({ where: { integrationId: integration.id } })).toBe(1);
  });

  it('POST /api/sync validates the body and 404s for unknown integrations', async () => {
    const user = await f.user();
    await connectGitHub(t, gh, user.id);
    const as = bearer(user.id);
    const bad = await request(server())
      .post('/api/sync')
      .set('authorization', as)
      .send({ integrationId: 'nope' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    await request(server())
      .post('/api/sync')
      .set('authorization', as)
      .send({ extra: 1 })
      .expect(400);
    await request(server())
      .post('/api/sync')
      .set('authorization', as)
      .send({ integrationId: 'cjld2cjxh0000qzrmn831i7rn' })
      .expect(404);
    // The v1 route is gone (replaced by POST /sync).
    await request(server()).post('/api/sync/trigger').set('authorization', as).expect(404);
  });

  it('GET /api/sync/status reads stage + progress from the database and works after a Redis restart', async () => {
    const user = await f.user();
    const integration = await connectGitHub(t, gh, user.id);
    const as = bearer(user.id);
    const run = await t.prisma.syncRun.create({
      data: {
        userId: user.id,
        integrationId: integration.id,
        trigger: 'MANUAL',
        kind: 'INCREMENTAL',
        status: 'RUNNING',
        stage: 'REVIEWED_PRS',
        progress: 42,
        startedAt: new Date(),
      },
    });
    const finished = await t.prisma.syncRun.create({
      data: {
        userId: user.id,
        integrationId: integration.id,
        trigger: 'INITIAL',
        kind: 'BACKFILL',
        status: 'SUCCEEDED',
        stage: 'DONE',
        progress: 100,
        queuedAt: new Date(Date.now() - 86_400_000),
        finishedAt: new Date(),
      },
    });

    // Simulate a Redis restart: every key is gone.
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    await redis.flushdb();
    redis.disconnect();

    const res = await request(server())
      .get('/api/sync/status')
      .set('authorization', as)
      .expect(200);
    expect(res.body.data).toMatchObject({
      integrationId: integration.id,
      state: 'running',
      currentRun: { id: run.id, stage: 'reviewed_prs', progress: 42, status: 'running' },
      lastRun: { id: finished.id, status: 'succeeded' },
    });
    expect(Date.parse(res.body.data.nextScheduledAt as string)).toBeGreaterThan(Date.now());

    const detail = await request(server())
      .get(`/api/integrations/${integration.id}`)
      .set('authorization', as)
      .expect(200);
    expect(detail.body.data.currentRun).toMatchObject({ id: run.id });
  });

  it('a run whose job vanished (Redis lost) is reaped so a new sync can start', async () => {
    const user = await f.user();
    const integration = await connectGitHub(t, gh, user.id);
    const stale = await t.prisma.syncRun.create({
      data: {
        userId: user.id,
        integrationId: integration.id,
        trigger: 'MANUAL',
        kind: 'INCREMENTAL',
        status: 'QUEUED',
        queuedAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    const res = await request(server())
      .post('/api/sync')
      .set('authorization', bearer(user.id))
      .send({})
      .expect(202);
    expect(res.body.data.syncRun.id).not.toBe(stale.id);
    expect(await t.prisma.syncRun.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'INTERNAL',
    });
  });

  it('GET /api/sync/runs paginates newest first and filters; GET /api/sync/runs/:id', async () => {
    const user = await f.user();
    const integration = await connectGitHub(t, gh, user.id);
    const as = bearer(user.id);
    for (let i = 0; i < 3; i++) {
      await t.prisma.syncRun.create({
        data: {
          userId: user.id,
          integrationId: integration.id,
          trigger: 'SCHEDULED',
          kind: 'INCREMENTAL',
          status: i === 0 ? 'FAILED' : 'SUCCEEDED',
          queuedAt: new Date(Date.now() - (3 - i) * 3_600_000),
        },
      });
    }
    const page1 = await request(server())
      .get('/api/sync/runs?limit=2')
      .set('authorization', as)
      .expect(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta).toMatchObject({ hasMore: true });
    const page2 = await request(server())
      .get(`/api/sync/runs?limit=2&cursor=${page1.body.meta.nextCursor as string}`)
      .set('authorization', as)
      .expect(200);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].status).toBe('failed');
    const failed = await request(server())
      .get('/api/sync/runs?status=failed')
      .set('authorization', as)
      .expect(200);
    expect(failed.body.data).toHaveLength(1);
    const one = await request(server())
      .get(`/api/sync/runs/${page2.body.data[0].id as string}`)
      .set('authorization', as)
      .expect(200);
    expect(one.body.data).toMatchObject({ id: page2.body.data[0].id, errors: [], counts: {} });
  });

  it('registers the hourly sync.fanout job scheduler; over 24 h every ACTIVE integration is queued exactly once', async () => {
    const s = scheduler();
    await s.register();
    const queue = t.app.get<Queue>(getQueueToken(SYNC_QUEUE));
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers).toEqual([
      expect.objectContaining({ key: 'sync-fanout', pattern: FANOUT_PATTERN, name: 'sync.fanout' }),
    ]);

    const users = await Promise.all([f.user(), f.user(), f.user(), f.user()]);
    const active1 = await connectGitHub(t, gh, users[0].id, { login: 'a1', nodeId: 'U_a1' });
    const active2 = await connectGitHub(t, gh, users[1].id, { login: 'a2', nodeId: 'U_a2' });
    const reauth = await connectGitHub(t, gh, users[2].id, { login: 'r1', nodeId: 'U_r1' });
    const gone = await connectGitHub(t, gh, users[3].id, { login: 'd1', nodeId: 'U_d1' });
    await t.prisma.integration.update({
      where: { id: reauth.id },
      data: { status: 'NEEDS_REAUTH' },
    });
    await t.prisma.integration.update({ where: { id: gone.id }, data: { status: 'DISCONNECTED' } });

    const day = Date.UTC(2026, 10, 20);
    for (let hour = 0; hour < 24; hour++) {
      await s.fanout(new Date(day + hour * 3_600_000 + 5 * 60_000));
      // Queued runs complete before the next day's slot in real life; simulate that.
      await t.prisma.syncRun.updateMany({
        where: { status: 'QUEUED' },
        data: { status: 'SUCCEEDED' },
      });
      await queue.obliterate({ force: true });
    }
    const runs = await t.prisma.syncRun.findMany({ where: { trigger: 'SCHEDULED' } });
    expect(runs.map((r) => r.integrationId).sort()).toEqual([active1.id, active2.id].sort());
  });

  it('fan-out delays each job to its jittered slot minute within the hour', async () => {
    const user = await f.user();
    const integration = await connectGitHub(t, gh, user.id);
    await t.prisma.integration.update({
      where: { id: integration.id },
      data: { scheduleSlotMinute: 10 * 60 + 45 },
    });
    await scheduler().fanout(new Date(Date.UTC(2026, 10, 20, 10, 0, 30)));
    const job = await t.app.get<Queue>(getQueueToken(SYNC_QUEUE)).getJob(syncJobId(integration.id));
    expect(job?.opts.delay).toBe(45 * 60_000 - 30_000);
  });
});
