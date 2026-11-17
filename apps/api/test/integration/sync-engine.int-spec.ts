import { getQueueToken } from '@nestjs/bullmq';
import { SyncTrigger } from '@prisma/client';
import Redis from 'ioredis';
import request from 'supertest';

import { METRICS_QUEUE, SYNC_QUEUE, syncJobId } from '../../src/sync/sync.constants';
import { SyncService } from '../../src/sync/sync.service';
import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';
import { installFakeGitHub, type FakeGitHubState } from '../utils/fake-github';
import {
  activityCounts,
  connectGitHub,
  loadDataset,
  resumeSync,
  runSync,
} from '../utils/github-fixtures';

import type { Queue } from 'bullmq';

describe('Sync engine v2 (integration, fake GitHub)', () => {
  let t: TestApp;
  let f: Factories;
  let gh: FakeGitHubState;
  let restore: () => void;

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

  async function connectedUser() {
    const user = await f.user();
    const integration = await connectGitHub(t, gh, user.id);
    return { user, integration };
  }

  it('initial backfill stores authored PRs, reviewed PRs, reviews and default-branch commits separately', async () => {
    const { user, integration } = await connectedUser();
    const { run, outcome } = await runSync(t, user.id, integration.id, SyncTrigger.INITIAL);

    expect(outcome).toEqual({ type: 'finished', status: 'SUCCEEDED' });
    expect(run).toMatchObject({
      kind: 'BACKFILL',
      status: 'SUCCEEDED',
      stage: 'DONE',
      progress: 100,
    });
    expect(run.recentWindowCompletedAt).not.toBeNull(); // A-4
    expect(run.apiCalls).toBeGreaterThan(0);

    const authored = await t.prisma.pullRequest.findMany({
      where: { userId: user.id, isAuthoredByUser: true },
      include: { repository: true },
    });
    expect(authored.map((p) => `${p.repository.fullName}#${p.number}`).sort()).toEqual([
      'acme/api#10',
      'acme/api#11',
      'octo/app#1',
      'oss/lib#4',
    ]);
    const reviewed = await t.prisma.pullRequest.findMany({
      where: { userId: user.id, isAuthoredByUser: false },
      include: { repository: true, reviews: true },
    });
    expect(reviewed.map((p) => `${p.repository.fullName}#${p.number}`).sort()).toEqual([
      'acme/api#50',
      'acme/web#7',
      'oss/lib#3',
    ]);
    // Data minimisation: reviewed PRs keep metadata only.
    for (const pr of reviewed) {
      expect(pr).toMatchObject({
        body: null,
        additions: null,
        firstReviewAt: null,
        authorLogin: 'alice',
      });
    }
    // DATA-08: one row per submitted review (pending drafts and self-reviews never stored).
    const web7 = reviewed.find((p) => p.number === 7);
    expect(web7?.reviews.map((r) => [r.state, r.commentsCount, r.hasBody]).sort()).toEqual([
      ['APPROVED', 0, false],
      ['CHANGES_REQUESTED', 4, true],
    ]);
    expect(web7?.reviews.every((r) => r.reviewRequestedAt !== null)).toBe(true); // team request counts
    expect(await t.prisma.pullRequestReview.count({ where: { userId: user.id } })).toBe(4);

    // Received-review aggregates ignore bots and the author; revert detected via cross-reference.
    const login = authored.find((p) => p.number === 1);
    expect(login).toMatchObject({
      reviewersCount: 1,
      approvalsCount: 1,
      changesRequestedCount: 1,
      isRevert: false,
    });
    expect(login?.firstReviewAt?.toISOString()).toBe(
      gh.dataset.pullRequests[0]?.reviews?.[1]?.submittedAt,
    );
    expect(login?.revertedByUrl).toBe('https://github.com/octo/app/pull/9');
    expect(authored.find((p) => p.number === 10)?.readyForReviewAt).not.toBeNull();

    // Commits: only the user's, on the default branch with its real name (DATA-05), stats without N+1.
    const commits = await t.prisma.commit.findMany({
      where: { userId: user.id },
      include: { repository: true },
    });
    expect(commits).toHaveLength(6);
    expect(commits.find((c) => c.sha.startsWith('b0') && c.parentsCount === 2)?.branch).toBe(
      'trunk',
    );
    expect(commits.find((c) => c.sha.endsWith('1') && c.sha.startsWith('a0'))).toMatchObject({
      messageHeadline: 'feat: login',
      messageBody: 'Adds the login form.',
      associatedPrNumber: 1,
    });

    // Repositories: activity → included; installation-only (no activity) → excluded by default.
    const repos = await t.prisma.repository.findMany({ where: { userId: user.id } });
    expect(Object.fromEntries(repos.map((r) => [r.fullName, r.included]))).toEqual({
      'octo/app': true,
      'acme/api': true,
      'acme/web': true,
      'acme/quiet': false,
      'oss/lib': true,
    });
    expect(repos.find((r) => r.fullName === 'oss/lib')?.installationId).toBeNull();

    const after = await t.prisma.integration.findUniqueOrThrow({ where: { id: integration.id } });
    expect(after.backfillFrom).not.toBeNull();
    expect(after.syncCursor).toMatchObject({ authoredPrsUpdatedAt: run.windowTo?.toISOString() });
    expect(after.lastSuccessfulSyncAt).not.toBeNull();

    // metrics.recompute queued for P07 (recent slice + whole window).
    const metrics = t.app.get<Queue>(getQueueToken(METRICS_QUEUE));
    expect(await metrics.count()).toBeGreaterThanOrEqual(1);
  });

  it('DATA-01: reviewing someone else’s PR never increases the authored-PR count (API)', async () => {
    const { user, integration } = await connectedUser();
    await runSync(t, user.id, integration.id);
    const as = bearer(user.id);
    const server = t.app.getHttpServer();

    const authored = await request(server)
      .get('/api/activity/prs?role=authored&limit=100')
      .set('authorization', as)
      .expect(200);
    const reviewed = await request(server)
      .get('/api/activity/prs?role=reviewed&limit=100')
      .set('authorization', as)
      .expect(200);
    const summary = await request(server)
      .get('/api/activity/summary')
      .set('authorization', as)
      .expect(200);
    expect(authored.body.data).toHaveLength(4);
    expect(reviewed.body.data).toHaveLength(3);
    // DATA-02: the deprecated summary's `totalPRs` counts merged authored PRs only.
    const merged = authored.body.data.filter((p: { state: string }) => p.state === 'merged').length;
    expect(summary.body.data).toMatchObject({ totalPRs: merged, totalReviews: 4 });

    // A new review on another PR adds a review, never an authored PR.
    const pr60 = gh.dataset.pullRequests.find((p) => p.number === 60);
    if (!pr60) throw new Error('fixture: acme/api#60 missing');
    (pr60.reviews ??= []).push({
      id: 'RV_new',
      author: 'octo',
      state: 'APPROVED',
      submittedAt: new Date().toISOString(),
    });
    pr60.updatedAt = new Date().toISOString();
    await runSync(t, user.id, integration.id);
    const again = await request(server)
      .get('/api/activity/summary')
      .set('authorization', as)
      .expect(200);
    expect(again.body.data).toMatchObject({ totalPRs: merged, totalReviews: 5 });
  });

  it('re-running the same sync produces zero new rows (idempotent)', async () => {
    const { user, integration } = await connectedUser();
    await runSync(t, user.id, integration.id);
    const before = await activityCounts(t);

    // Same window again as a full backfill and as an incremental run.
    await t.prisma.integration.update({
      where: { id: integration.id },
      data: { backfillFrom: null },
    });
    const { run: backfill } = await runSync(t, user.id, integration.id);
    const { run: incremental } = await runSync(t, user.id, integration.id);

    expect(backfill.kind).toBe('BACKFILL');
    expect(incremental.kind).toBe('INCREMENTAL');
    expect(await activityCounts(t)).toEqual(before);
    expect(backfill.counts).toMatchObject({ created: 0, updated: 0 });
    expect(incremental.counts).toMatchObject({ created: 0, updated: 0 });
  });

  it('incremental sync only requests data newer than the cursors (mock request log)', async () => {
    const { user, integration } = await connectedUser();
    const { run: first } = await runSync(t, user.id, integration.id);
    const cursor = first.windowTo?.getTime() ?? 0;
    const overlap = 60 * 60_000 + 1000; // 1 h overlap + second precision of search qualifiers

    const now = new Date().toISOString();
    gh.dataset.commits.push({
      sha: 'e000000000000000000000000000000000000001',
      repo: 'octo/app',
      authorNodeId: 'U_octo',
      message: 'feat: new',
      authoredAt: now,
      additions: 1,
      deletions: 0,
    });
    gh.dataset.pullRequests.push({
      nodeId: 'PR_app_2',
      repo: 'octo/app',
      number: 2,
      title: 'New',
      author: 'octo',
      state: 'OPEN',
      createdAt: now,
      updatedAt: now,
    });
    gh.log.length = 0;

    const { run } = await runSync(t, user.id, integration.id);
    expect(run).toMatchObject({ kind: 'INCREMENTAL', status: 'SUCCEEDED' });

    const searches = gh.log.filter((e) => e.operation?.endsWith('PRs'));
    expect(searches.length).toBeGreaterThan(0);
    for (const s of searches) {
      const from = Date.parse(/updated:(\S+)\.\./.exec(String(s.variables.q))?.[1] ?? '');
      expect(from).toBeGreaterThanOrEqual(cursor - overlap);
    }
    const history = gh.log.filter((e) => e.operation === 'DevImpactCommitHistory');
    expect(history.length).toBeGreaterThan(0);
    for (const h of history) {
      for (let i = 0; h.variables[`s${i}`] !== undefined; i++) {
        expect(Date.parse(String(h.variables[`s${i}`]))).toBeGreaterThanOrEqual(cursor - overlap);
      }
    }
    // Daily incremental stays far below the ≤ 50 request budget (ADR-0007).
    expect(gh.log.length).toBeLessThanOrEqual(10);
    expect(
      await t.prisma.commit.count({ where: { sha: 'e000000000000000000000000000000000000001' } }),
    ).toBe(1);
    expect(await t.prisma.pullRequest.count({ where: { externalId: 'PR_app_2' } })).toBe(1);
  });

  it('rate-limit exhaustion pauses the run (WAITING_RATE_LIMIT, resumeAt) and resumes without data loss', async () => {
    const { user, integration } = await connectedUser();
    gh.rateLimit.remaining = 204; // drops below the 200 threshold after a few calls

    const { run, outcome } = await runSync(t, user.id, integration.id);
    expect(outcome.type).toBe('delayed');
    expect(run.status).toBe('WAITING_RATE_LIMIT');
    expect(run.resumeAt?.getTime()).toBeGreaterThanOrEqual(gh.rateLimit.resetAt.getTime());
    expect(run.checkpoint).toMatchObject({ reposDone: true });
    expect(run.progress).toBeLessThan(100);

    const status = await request(t.app.getHttpServer())
      .get('/api/sync/status')
      .set('authorization', bearer(user.id))
      .expect(200);
    expect(status.body.data).toMatchObject({
      state: 'waiting_rate_limit',
      currentRun: { id: run.id, status: 'waiting_rate_limit' },
    });

    gh.rateLimit.remaining = 5000; // reset reached
    const resumed = await resumeSync(t, run);
    expect(resumed.run).toMatchObject({ status: 'SUCCEEDED', progress: 100 });
    expect(await t.prisma.pullRequest.count({ where: { userId: user.id } })).toBe(7);
    expect(await t.prisma.commit.count({ where: { userId: user.id } })).toBe(6);
    expect(await t.prisma.pullRequestReview.count({ where: { userId: user.id } })).toBe(4);
  });

  it('expiring token is refreshed (rotated, encrypted) before syncing; a 401 triggers one refresh + retry', async () => {
    const user = await f.user();
    const integration = await connectGitHub(t, gh, user.id, {
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    gh.refreshGrants.set('ghr_octo_refresh', { token: 'gho_new', refresh: 'ghr_new' });
    gh.users.set('gho_new', {
      id: 1,
      node_id: 'U_octo',
      login: 'octo',
      name: 'octo',
      avatar_url: null,
    });
    gh.installations.set('gho_new', gh.installations.get('gho_octo_token') ?? []);

    const { run } = await runSync(t, user.id, integration.id);
    expect(run.status).toBe('SUCCEEDED');
    expect(gh.refreshCalls).toEqual(['ghr_octo_refresh']);
    expect(new Set(gh.log.map((e) => e.token))).toEqual(new Set(['gho_new']));
    const row = await t.prisma.integration.findUniqueOrThrow({ where: { id: integration.id } });
    expect(row.accessTokenEnc).not.toContain('gho_new');
    expect(row.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 7 * 3_600_000);

    // Token revoked mid-life: 401 → refresh with the rotated refresh token → retried request works.
    gh.invalidTokens.add('gho_new');
    gh.refreshGrants.set('ghr_new', { token: 'gho_third', refresh: 'ghr_third' });
    gh.users.set('gho_third', {
      id: 1,
      node_id: 'U_octo',
      login: 'octo',
      name: 'octo',
      avatar_url: null,
    });
    gh.installations.set('gho_third', gh.installations.get('gho_new') ?? []);
    const { run: second } = await runSync(t, user.id, integration.id);
    expect(second.status).toBe('SUCCEEDED');
    expect(gh.refreshCalls).toEqual(['ghr_octo_refresh', 'ghr_new']);
  });

  it('revoked token → integration needs_reauth, run failed with a safe code, schedule paused, POST /sync 409', async () => {
    const { user, integration } = await connectedUser();
    gh.invalidTokens.add('gho_octo_token'); // and the refresh token is rejected (no grant)

    const { run } = await runSync(t, user.id, integration.id);
    expect(run).toMatchObject({ status: 'FAILED', errorCode: 'GITHUB_REAUTH_REQUIRED' });
    expect(run.errorMessage).toMatch(/Reconnect GitHub/);

    const row = await t.prisma.integration.findUniqueOrThrow({ where: { id: integration.id } });
    expect(row).toMatchObject({
      status: 'NEEDS_REAUTH',
      accessTokenEnc: null,
      refreshTokenEnc: null,
    });
    expect(row.statusReason).toMatch(/^GITHUB_/);

    const server = t.app.getHttpServer();
    const as = bearer(user.id);
    const status = await request(server)
      .get('/api/sync/status')
      .set('authorization', as)
      .expect(200);
    expect(status.body.data).toMatchObject({
      state: 'needs_reauth',
      nextScheduledAt: null,
      lastRun: { status: 'failed', errorCode: 'GITHUB_REAUTH_REQUIRED' },
    });
    const sync = await request(server)
      .post('/api/sync')
      .set('authorization', as)
      .send({})
      .expect(409);
    expect(sync.body.error).toMatchObject({
      code: 'INTEGRATION_NEEDS_REAUTH',
      details: { integrationId: integration.id },
    });
    const integrations = await request(server)
      .get('/api/integrations')
      .set('authorization', as)
      .expect(200);
    expect(integrations.body.data[0]).toMatchObject({
      status: 'needs_reauth',
      nextScheduledSyncAt: null,
    });
  });

  it('excluded repositories are never fetched and never counted; inclusion change queues a recompute', async () => {
    const { user, integration } = await connectedUser();
    await runSync(t, user.id, integration.id);
    const api = await t.prisma.repository.findFirstOrThrow({
      where: { userId: user.id, fullName: 'acme/api' },
    });
    const metrics = t.app.get<Queue>(getQueueToken(METRICS_QUEUE));
    await metrics.obliterate({ force: true });

    const server = t.app.getHttpServer();
    const as = bearer(user.id);
    const patched = await request(server)
      .patch(`/api/repos/${api.id}`)
      .set('authorization', as)
      .send({ included: false })
      .expect(200);
    expect(patched.body.data).toMatchObject({ included: false, inclusionSource: 'user' });
    expect(await metrics.count()).toBe(1);

    gh.dataset.commits.push({
      sha: 'f000000000000000000000000000000000000001',
      repo: 'acme/api',
      authorNodeId: 'U_octo',
      message: 'feat: excluded',
      authoredAt: new Date().toISOString(),
      additions: 1,
      deletions: 0,
    });
    gh.log.length = 0;
    await runSync(t, user.id, integration.id);
    const fetched = gh.log
      .filter((e) => e.operation === 'DevImpactCommitHistory')
      .flatMap((e) =>
        Object.entries(e.variables)
          .filter(([k]) => /^n\d+$/.test(k))
          .map(([, v]) => v),
      );
    expect(fetched).not.toContain('api');
    expect(
      await t.prisma.commit.count({ where: { sha: 'f000000000000000000000000000000000000001' } }),
    ).toBe(0);

    const authoredPrs = await request(server)
      .get('/api/activity/prs?role=authored&limit=100')
      .set('authorization', as)
      .expect(200);
    expect(authoredPrs.body.data).toHaveLength(2); // acme/api PRs excluded
    const commits = await request(server)
      .get('/api/activity/commits?limit=100')
      .set('authorization', as)
      .expect(200);
    expect(
      commits.body.data.every(
        (c: { repo: { fullName: string } }) => c.repo.fullName !== 'acme/api',
      ),
    ).toBe(true);
    // A later sync never re-includes a repository the user excluded.
    expect((await t.prisma.repository.findUniqueOrThrow({ where: { id: api.id } })).included).toBe(
      false,
    );
  });

  it('a repository that disappears is recorded on the run (PARTIAL), marked inaccessible, cursor kept', async () => {
    const { user, integration } = await connectedUser();
    await runSync(t, user.id, integration.id);
    const repo = gh.dataset.repos.find((r) => r.fullName === 'octo/app');
    if (repo) repo.missing = true;
    gh.dataset.commits.push({
      sha: 'a000000000000000000000000000000000000009',
      repo: 'octo/app',
      authorNodeId: 'U_octo',
      message: 'x',
      authoredAt: new Date().toISOString(),
      additions: 1,
      deletions: 0,
    });
    const before = await t.prisma.repository.findFirstOrThrow({
      where: { userId: user.id, fullName: 'octo/app' },
    });

    const { run } = await runSync(t, user.id, integration.id);
    expect(run.status).toBe('PARTIAL');
    expect(run.errors).toEqual([
      expect.objectContaining({
        stage: 'commits',
        repo: 'octo/app',
        code: 'REPOSITORY_NOT_ACCESSIBLE',
      }),
    ]);
    const after = await t.prisma.repository.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.accessible).toBe(false);
    expect(after.commitCursor?.getTime()).toBe(before.commitCursor?.getTime());
  });

  it('P06-3: the first v2 backfill upgrades legacy repositories/PRs and purges v0.1 stubs and legacy reviews', async () => {
    const { user, integration } = await connectedUser();
    const legacyRepo = await f.repository(user.id, integration.id, 'acme/api', {
      externalId: 'legacy:acme/api',
    });
    const legacyAuthored = await f.pullRequest(user.id, integration.id, {
      repo: 'acme/api',
      number: 10,
      title: 'old title',
      externalId: null,
    });
    const stub = await f.pullRequest(user.id, integration.id, {
      repo: 'acme/api',
      number: 5064,
      title: 'PR #5064',
      state: 'CLOSED',
      isAuthoredByUser: false,
      legacyStub: true,
      mergedAt: null,
      externalId: null,
    });
    await t.prisma.pullRequestReview.create({
      data: {
        userId: user.id,
        integrationId: integration.id,
        pullRequestId: stub.id,
        externalId: 'legacy:old',
        state: 'COMMENTED',
        submittedAt: new Date(),
      },
    });

    const { run } = await runSync(t, user.id, integration.id);
    expect(run.status).toBe('SUCCEEDED');
    const repo = await t.prisma.repository.findUniqueOrThrow({ where: { id: legacyRepo.id } });
    expect(repo.externalId).toBe('R_acme_api');
    const upgraded = await t.prisma.pullRequest.findUniqueOrThrow({
      where: { id: legacyAuthored.id },
    });
    expect(upgraded).toMatchObject({
      title: 'Billing v2',
      externalId: 'PR_api_10',
      isAuthoredByUser: true,
      legacyStub: false,
    });
    expect(await t.prisma.pullRequest.count({ where: { id: stub.id } })).toBe(0);
    expect(
      await t.prisma.pullRequestReview.count({ where: { externalId: { startsWith: 'legacy:' } } }),
    ).toBe(0);
  });

  it('OPS-17: test queues use the "devimpact-test" prefix so a local dev worker never sees them', async () => {
    const { user, integration } = await connectedUser();
    const queue = t.app.get<Queue>(getQueueToken(SYNC_QUEUE));
    expect(queue.opts.prefix).toBe('devimpact-test');
    await t.app
      .get(SyncService)
      .requestSync(user.id, { integrationId: integration.id, trigger: SyncTrigger.MANUAL });
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    try {
      // The job lives under the test prefix only (a dev worker may own other `devimpact:*` keys).
      expect(await redis.exists(`devimpact-test:sync:${syncJobId(integration.id)}`)).toBe(1);
      expect(await redis.exists(`devimpact:sync:${syncJobId(integration.id)}`)).toBe(0);
    } finally {
      redis.disconnect();
    }
  });
});
