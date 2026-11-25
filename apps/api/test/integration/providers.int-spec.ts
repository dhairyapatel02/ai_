import { createHmac } from 'node:crypto';

import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';

import { RefResolver } from '../../src/evidence/ref-resolver.service';
import { RollupService } from '../../src/metrics/rollup.service';
import { SyncEngine } from '../../src/sync/sync-engine.service';
import { SyncTargetedService } from '../../src/sync/sync-targeted.service';
import { SYNC_QUEUE, targetedJobId } from '../../src/sync/sync.constants';
import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';
import {
  gitlabDataset,
  installFakeProviders,
  jiraIssue,
  linearIssue,
  type FakeProviderKind,
  type FakeProvidersState,
} from '../utils/fake-providers';
import { runSync } from '../utils/github-fixtures';

import type { TargetedJobData } from '../../src/webhooks/webhooks.service';
import type { Queue } from 'bullmq';

/** Last 30 local days as a custom period (`custom:YYYY-MM-DD..YYYY-MM-DD`). */
const LAST_30 = (() => {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return `custom:${day(Date.now() - 29 * 86_400_000)}..${day(Date.now())}`;
})();

describe('GitLab / Jira / Linear providers (integration, P13)', () => {
  let t: TestApp;
  let f: Factories;
  let fake: FakeProvidersState;
  let restore: () => void;
  const server = () => t.app.getHttpServer();
  const queue = () => t.app.get<Queue<TargetedJobData>>(getQueueToken(SYNC_QUEUE));

  beforeAll(async () => {
    t = await createTestApp();
    f = buildFactories(t.prisma);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await resetRedisState();
    ({ state: fake, restore } = installFakeProviders());
  });

  afterEach(() => {
    restore();
  });

  afterAll(async () => {
    await t.close();
  });

  function registerAccount(provider: FakeProviderKind, token: string, account?: string) {
    if (provider === 'gitlab') gitlabDataset(fake, token);
    if (provider === 'jira') {
      fake.jira.me.set(token, {
        account_id: account ?? 'acc-dana',
        email: 'Dana@Example.test',
        name: 'Dana',
        nickname: 'dana',
        picture: null,
      });
    }
    if (provider === 'linear') {
      fake.linear.viewers.set(token, {
        id: account ?? 'lin-user-dana',
        name: 'Dana',
        displayName: 'dana',
        email: 'dana@example.test',
        avatarUrl: null,
        organization: { id: 'org-acme', name: 'Acme', urlKey: 'acme' },
      });
    }
  }

  /** Full connect round trip through the API (authorize URL → callback → backfill run). */
  async function connect(
    provider: FakeProviderKind,
    userId: string,
    options: {
      token?: string;
      refresh?: string | null;
      expiresIn?: number;
      baseUrl?: string;
      account?: string;
    } = {},
  ) {
    const as = bearer(userId);
    const start = await request(server())
      .post(`/api/integrations/${provider}/connect`)
      .set('authorization', as)
      .send({
        returnTo: '/settings/integrations',
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      })
      .expect(200);
    const url = new URL(start.body.data.url);
    const token = options.token ?? `${provider}-token-${userId}`;
    registerAccount(provider, token, options.account);
    const code = `code-${provider}-${userId}`;
    fake.codes.set(code, {
      provider,
      accessToken: token,
      refreshToken:
        options.refresh === undefined ? `${provider}-refresh-${userId}` : options.refresh,
      expiresIn: options.expiresIn,
    });
    const callback = await request(server())
      .post(`/api/integrations/${provider}/callback`)
      .set('authorization', as)
      .send({ code, state: url.searchParams.get('state') })
      .expect(201);
    return { url, callback: callback.body.data, token };
  }

  async function connectAndSync(provider: FakeProviderKind, userId: string, options = {}) {
    const result = await connect(provider, userId, options);
    const outcome = await t.app.get(SyncEngine).run(result.callback.syncRun.id, userId);
    const run = await t.prisma.syncRun.findUniqueOrThrow({
      where: { id: result.callback.syncRun.id },
    });
    return { ...result, outcome, run, integrationId: result.callback.integration.id as string };
  }

  describe('GitLab', () => {
    it('connect uses PKCE + signed state; tokens are encrypted; backfill imports MRs, reviews and commits', async () => {
      const user = await f.user();
      const { url, callback, run, token, integrationId } = await connectAndSync('gitlab', user.id);
      expect(url.origin).toBe('https://gitlab.invalid');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('scope')).toBe('read_api read_user');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3000/integrations/gitlab/callback',
      );
      expect(fake.exchanges.at(-1)?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(callback.integration).toMatchObject({
        provider: 'gitlab',
        category: 'code',
        baseUrl: null,
      });

      const row = await t.prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
      expect(row.accessTokenEnc).not.toContain(token);
      expect(row.mechanism).toBe('OAUTH2');
      expect(row.externalAccountId).toBe('gitlab.invalid/10');

      expect(run.status).toBe('SUCCEEDED');
      const prs = await t.prisma.pullRequest.findMany({
        where: { userId: user.id },
        orderBy: { number: 'asc' },
      });
      expect(prs.map((p) => [p.number, p.isAuthoredByUser, p.body !== null])).toEqual([
        [12, true, true],
        [13, false, false], // reviewed MR: no body stored (ARCHITECTURE_V2 §12)
      ]);
      expect(prs[0]).toMatchObject({ approvalsCount: 1, reviewersCount: 1 });
      const reviews = await t.prisma.pullRequestReview.findMany({ where: { userId: user.id } });
      expect(reviews.map((r) => r.state).sort()).toEqual(['APPROVED', 'COMMENTED']);
      // Only commits by a linked (verified) email: the old-laptop commit is not the user's yet.
      const commits = await t.prisma.commit.findMany({ where: { userId: user.id } });
      expect(commits.map((c) => c.messageHeadline)).toEqual(['Add idempotency key column']);

      // Verified identities linked; unconfirmed emails are not.
      const ids = await request(server())
        .get(`/api/integrations/${integrationId}/identities`)
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(
        ids.body.data.map((i: { kind: string; value: string }) => `${i.kind}:${i.value}`).sort(),
      ).toEqual(['account:gitlab.invalid/10', 'email:dana@example.test', 'username:dana']);

      // Activity: MR refs, provider on repo refs and feed items.
      const feed = await request(server())
        .get('/api/activity/feed?providers=gitlab&types=pr_merged')
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(feed.body.data[0]).toMatchObject({
        ref: 'MR-acme/platform/billing!12',
        provider: 'gitlab',
        repo: { fullName: 'acme/platform/billing', provider: 'gitlab' },
      });
      const none = await request(server())
        .get('/api/activity/feed?providers=jira&types=pr_merged')
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(none.body.data).toEqual([]);
    });

    it('manual email linking imports older commits on the next backfill; duplicates and foreign removals are refused', async () => {
      const user = await f.user();
      const other = await f.user();
      const { integrationId } = await connectAndSync('gitlab', user.id);
      const added = await request(server())
        .post(`/api/integrations/${integrationId}/identities`)
        .set('authorization', bearer(user.id))
        .send({ email: 'Dana@Old-Laptop.test' })
        .expect(201);
      expect(added.body.data).toMatchObject({
        kind: 'email',
        value: 'dana@old-laptop.test',
        source: 'manual',
        verified: false,
      });

      await runSync(t, user.id, integrationId);
      expect(await t.prisma.commit.count({ where: { userId: user.id } })).toBe(2);

      // Same email already linked (by anyone) → 409.
      await request(server())
        .post(`/api/integrations/${integrationId}/identities`)
        .set('authorization', bearer(user.id))
        .send({ email: 'dana@old-laptop.test' })
        .expect(409);
      // Other users can neither list nor remove these identities.
      await request(server())
        .get(`/api/integrations/${integrationId}/identities`)
        .set('authorization', bearer(other.id))
        .expect(404);
      await request(server())
        .delete(`/api/integrations/${integrationId}/identities/${added.body.data.id}`)
        .set('authorization', bearer(other.id))
        .expect(404);
      // Provider-verified identities cannot be removed by the user.
      const provided = await t.prisma.providerIdentity.findFirstOrThrow({
        where: { integrationId, source: 'PROVIDER' },
      });
      await request(server())
        .delete(`/api/integrations/${integrationId}/identities/${provided.id}`)
        .set('authorization', bearer(user.id))
        .expect(409);
      await request(server())
        .delete(`/api/integrations/${integrationId}/identities/${added.body.data.id}`)
        .set('authorization', bearer(user.id))
        .expect(204);
    });

    it('deduplicates commits mirrored between GitHub and GitLab by SHA (first provider wins)', async () => {
      const user = await f.user();
      const gh = await f.integration(user.id, { externalAccountId: 'U_dana' });
      const repo = await t.prisma.repository.create({
        data: {
          userId: user.id,
          integrationId: gh.id,
          externalId: 'R_1',
          fullName: 'acme/billing',
          ownerLogin: 'acme',
          name: 'billing',
        },
      });
      await t.prisma.commit.create({
        data: {
          userId: user.id,
          integrationId: gh.id,
          repositoryId: repo.id,
          sha: 'a1'.padEnd(40, '0'),
          messageHeadline: 'Add idempotency key column',
          branch: 'main',
          authoredAt: new Date(),
        },
      });
      await connectAndSync('gitlab', user.id);
      const rows = await t.prisma.commit.findMany({
        where: { userId: user.id, sha: 'a1'.padEnd(40, '0') },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.integrationId).toBe(gh.id);
    });

    it('incremental sync reads from the cursor − 1 h; re-running creates nothing', async () => {
      const user = await f.user();
      const { integrationId } = await connectAndSync('gitlab', user.id);
      const before = await t.prisma.pullRequest.count();
      fake.log.length = 0;
      const { run } = await runSync(t, user.id, integrationId);
      expect(run.kind).toBe('INCREMENTAL');
      expect(await t.prisma.pullRequest.count()).toBe(before);
      const mrQuery = fake.log.find((e) => e.path === '/api/v4/merge_requests')?.query;
      const cursor = (
        await t.prisma.integration.findUniqueOrThrow({ where: { id: integrationId } })
      ).syncCursor;
      expect(Date.parse(mrQuery?.updated_after ?? '')).toBeGreaterThan(Date.now() - 2 * 3_600_000);
      expect(cursor).toHaveProperty('authoredPrsUpdatedAt');
    });

    it('webhook: X-Gitlab-Token required, idempotent per delivery, queues an incremental sync of the matching integration', async () => {
      const user = await f.user();
      const { integrationId } = await connectAndSync('gitlab', user.id);
      const payload = JSON.stringify({
        object_kind: 'merge_request',
        project: { id: 42, web_url: 'https://gitlab.invalid/acme/platform/billing' },
        user: { id: 20 },
        object_attributes: { author_id: 10, action: 'update' },
      });
      const send = (token?: string, uuid = '6f2d0e64-0000-4000-8000-000000000001') => {
        const req = request(server())
          .post('/api/webhooks/gitlab')
          .set('content-type', 'application/json')
          .set('x-gitlab-event', 'Merge Request Hook')
          .set('x-gitlab-event-uuid', uuid);
        if (token) req.set('x-gitlab-token', token);
        return req.send(payload);
      };
      await send().expect(401);
      await send('wrong').expect(401);
      const ok = await send('test-gitlab-webhook-token').expect(202);
      expect(ok.body.data).toEqual({ accepted: true, duplicate: false });
      expect((await send('test-gitlab-webhook-token').expect(202)).body.data.duplicate).toBe(true);

      const id = 'gl-6f2d0e64-0000-4000-8000-000000000001';
      const job = await queue().getJob(targetedJobId(id));
      expect(job?.data.event).toMatchObject({ kind: 'activity_changed', provider: 'gitlab' });
      await t.app.get(SyncTargetedService).handle(job!.data);
      const runs = await t.prisma.syncRun.findMany({
        where: { integrationId },
        orderBy: { queuedAt: 'desc' },
      });
      expect(runs[0]).toMatchObject({ trigger: 'WEBHOOK', kind: 'INCREMENTAL', status: 'QUEUED' });
      expect((await t.prisma.webhookDelivery.findUniqueOrThrow({ where: { id } })).status).toBe(
        'PROCESSED',
      );
    });

    it('self-managed instances must be allow-listed (SSRF guard); allowed ones are stored as baseUrl', async () => {
      const user = await f.user();
      await request(server())
        .post('/api/integrations/gitlab/connect')
        .set('authorization', bearer(user.id))
        .send({ baseUrl: 'https://evil.example.com' })
        .expect(400);
      await request(server())
        .post('/api/integrations/gitlab/connect')
        .set('authorization', bearer(user.id))
        .send({ baseUrl: 'https://gitlab.selfhosted.invalid/path' })
        .expect(400);
      const { url, callback } = await connect('gitlab', user.id, {
        baseUrl: 'https://gitlab.selfhosted.invalid',
      });
      expect(url.origin).toBe('https://gitlab.selfhosted.invalid');
      expect(url.searchParams.get('client_id')).toBe('sh-client');
      expect(callback.integration.baseUrl).toBe('https://gitlab.selfhosted.invalid');
    });

    it('disconnect revokes at GitLab, drops tokens and identities, keeps or purges data', async () => {
      const user = await f.user();
      const { integrationId, token } = await connectAndSync('gitlab', user.id);
      const res = await request(server())
        .delete(`/api/integrations/${integrationId}?purgeData=true`)
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(res.body.data).toMatchObject({
        status: 'disconnected',
        purged: true,
        tokenRevoked: true,
      });
      expect(fake.revoked).toContainEqual({ provider: 'gitlab', token });
      const row = await t.prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
      expect(row.accessTokenEnc).toBeNull();
      expect(await t.prisma.providerIdentity.count({ where: { integrationId } })).toBe(0);
      expect(await t.prisma.pullRequest.count({ where: { integrationId } })).toBe(0);
    });
  });

  describe('Jira', () => {
    it('connect without PKCE (3LO), discovers sites + story points field, imports assigned issues', async () => {
      const user = await f.user();
      fake.jira.issues = [
        jiraIssue('PAY-1', { accountId: 'acc-dana', points: 5 }),
        jiraIssue('PAY-2', { accountId: 'acc-dana', status: 'indeterminate' }),
        jiraIssue('PAY-3', { accountId: 'acc-dana', resolution: "Won't Do" }),
        jiraIssue('PAY-4', { accountId: 'someone-else' }),
      ];
      const { url, run, integrationId, callback } = await connectAndSync('jira', user.id);
      expect(url.origin).toBe('https://auth.atlassian.invalid');
      expect(url.searchParams.get('code_challenge')).toBeNull();
      expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
      expect(url.searchParams.get('scope')).toContain('offline_access');
      expect(callback.integration).toMatchObject({ provider: 'jira', category: 'issues' });
      expect(run).toMatchObject({ status: 'SUCCEEDED' });
      expect(run.counts).toMatchObject({ issues: 3 });

      const issues = await t.prisma.issue.findMany({
        where: { userId: user.id },
        orderBy: { key: 'asc' },
      });
      expect(issues.map((i) => [i.key, i.status, i.storyPoints, i.completedAt !== null])).toEqual([
        ['PAY-1', 'DONE', 5, true],
        ['PAY-2', 'IN_PROGRESS', 3, false],
        ['PAY-3', 'CANCELLED', 3, false],
      ]);
      expect(issues[0]?.startedAt).not.toBeNull();

      const detail = await request(server())
        .get(`/api/integrations/${integrationId}`)
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(detail.body.data.settings).toMatchObject({
        sites: [{ id: 'cloud-acme', name: 'Acme', url: 'https://acme.atlassian.net/' }],
        storyPointsFieldDetected: 'customfield_10016',
        storyPointsField: null,
      });

      // Issues API + feed + KPIs + evidence refs.
      const list = await request(server())
        .get('/api/activity/issues?status=done')
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(list.body.data).toEqual([
        expect.objectContaining({
          ref: 'JIRA-PAY-1',
          provider: 'jira',
          storyPoints: 5,
          status: 'done',
        }),
      ]);
      const feed = await request(server())
        .get('/api/activity/feed?types=issue')
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(feed.body.data.map((i: { ref: string }) => i.ref)).toEqual(['JIRA-PAY-1']);
      const kpis = await request(server())
        .get(`/api/metrics/kpis?period=${LAST_30}`)
        .set('authorization', bearer(user.id))
        .expect(200);
      const section = kpis.body.data.sections.find((s: { key: string }) => s.key === 'issues');
      expect(section.available).toBe(true);
      expect(
        section.metrics.find((m: { key: string }) => m.key === 'issues_completed'),
      ).toMatchObject({ value: 1 });
      expect(
        section.metrics.find((m: { key: string }) => m.key === 'story_points_completed'),
      ).toMatchObject({ value: 5 });
      expect(kpis.body.data.metricsVersion).toBe('metrics@2.1.0');
      const evidence = await request(server())
        .get(`/api/metrics/evidence?metric=issues_completed&period=${LAST_30}`)
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(evidence.body.data[0]).toMatchObject({ ref: 'JIRA-PAY-1', kind: 'issue' });

      // Provider rollups.
      await t.app
        .get(RollupService)
        .recompute(user.id, new Date(Date.now() - 40 * 86_400_000), new Date(), new Date());
      const providers = await request(server())
        .get(`/api/metrics/providers?period=${LAST_30}`)
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(providers.body.data.providers).toEqual([
        expect.objectContaining({ provider: 'jira', issuesCompleted: 1, storyPoints: 5 }),
      ]);
    });

    it('story points field override re-reads issues with the chosen field', async () => {
      const user = await f.user();
      fake.jira.fields.push({ id: 'customfield_20000', name: 'Effort', custom: true });
      const issue = jiraIssue('PAY-9', { accountId: 'acc-dana', points: 1 });
      (issue.fields as Record<string, unknown>).customfield_20000 = 13;
      fake.jira.issues = [issue];
      const { integrationId } = await connectAndSync('jira', user.id);
      const patched = await request(server())
        .patch(`/api/integrations/${integrationId}`)
        .set('authorization', bearer(user.id))
        .send({ storyPointsField: 'customfield_20000' })
        .expect(200);
      expect(patched.body.data.settings.storyPointsField).toBe('customfield_20000');
      const run = await t.prisma.syncRun.findFirstOrThrow({
        where: { integrationId, status: 'QUEUED' },
      });
      expect(run.kind).toBe('BACKFILL');
      await t.app.get(SyncEngine).run(run.id, user.id);
      expect((await t.prisma.issue.findFirstOrThrow({ where: { key: 'PAY-9' } })).storyPoints).toBe(
        13,
      );
      await request(server())
        .patch(`/api/integrations/${integrationId}`)
        .set('authorization', bearer(user.id))
        .send({ storyPointsField: 'summary' })
        .expect(400);
    });

    it('incremental + webhook (X-Hub-Signature) pick up an updated issue', async () => {
      const user = await f.user();
      fake.jira.issues = [jiraIssue('PAY-1', { accountId: 'acc-dana', status: 'indeterminate' })];
      const { integrationId } = await connectAndSync('jira', user.id);
      fake.jira.issues = [jiraIssue('PAY-1', { accountId: 'acc-dana', updatedMsAgo: 60_000 })];

      const body = JSON.stringify({
        webhookEvent: 'jira:issue_updated',
        issue: {
          self: 'https://acme.atlassian.net/rest/api/3/issue/10001',
          fields: { assignee: { accountId: 'acc-dana' } },
        },
      });
      const sig = createHmac('sha256', 'test-jira-webhook-secret').update(body).digest('hex');
      await request(server())
        .post('/api/webhooks/jira')
        .set('content-type', 'application/json')
        .set('x-hub-signature', `sha256=${'0'.repeat(64)}`)
        .send(body)
        .expect(401);
      await request(server())
        .post('/api/webhooks/jira')
        .set('content-type', 'application/json')
        .set('x-atlassian-webhook-identifier', '777')
        .set('x-hub-signature', `sha256=${sig}`)
        .send(body)
        .expect(202);
      const job = await queue().getJob(targetedJobId('jira-777'));
      await t.app.get(SyncTargetedService).handle(job!.data);
      const run = await t.prisma.syncRun.findFirstOrThrow({
        where: { integrationId, trigger: 'WEBHOOK' },
      });
      await t.app.get(SyncEngine).run(run.id, user.id);
      const issue = await t.prisma.issue.findFirstOrThrow({ where: { key: 'PAY-1' } });
      expect(issue.status).toBe('DONE');
      const jql = fake.log.filter((e) => e.path.endsWith('/search/jql')).at(-1)?.body as {
        jql: string;
      };
      expect(jql.jql).toMatch(/assignee = "acc-dana" AND updated >= -\d+m/);
    });

    it('expiring token is refreshed (rotating refresh token); revoked refresh → NEEDS_REAUTH + sync-problem email job', async () => {
      const user = await f.user();
      fake.jira.issues = [jiraIssue('PAY-1', { accountId: 'acc-dana' })];
      const { callback } = await connect('jira', user.id, { expiresIn: 60 });
      const integrationId = callback.integration.id as string;
      fake.refreshGrants.set(`jira-refresh-${user.id}`, {
        provider: 'jira',
        accessToken: 'jira-token-rotated',
        refreshToken: 'jira-refresh-rotated',
      });
      fake.jira.me.set('jira-token-rotated', fake.jira.me.get(`jira-token-${user.id}`)!);
      await t.app.get(SyncEngine).run(callback.syncRun.id, user.id);
      const run = await t.prisma.syncRun.findUniqueOrThrow({ where: { id: callback.syncRun.id } });
      expect(run.status).toBe('SUCCEEDED');
      const refreshed = await t.prisma.integration.findUniqueOrThrow({
        where: { id: integrationId },
      });
      expect(refreshed.refreshTokenEnc).not.toBeNull();
      expect(fake.exchanges.at(-1)).toMatchObject({
        grant_type: 'refresh_token',
        refresh_token: `jira-refresh-${user.id}`,
      });

      // Token revoked at Atlassian and the refresh token is gone too.
      fake.invalidTokens.add('jira-token-rotated');
      const failed = await runSync(t, user.id, integrationId);
      expect(failed.run).toMatchObject({ status: 'FAILED', errorCode: 'JIRA_REAUTH_REQUIRED' });
      expect(failed.run.errorMessage).toContain('Reconnect Jira');
      const row = await t.prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
      expect(row).toMatchObject({
        status: 'NEEDS_REAUTH',
        accessTokenEnc: null,
        refreshTokenEnc: null,
      });
      await request(server())
        .post('/api/sync')
        .set('authorization', bearer(user.id))
        .send({ integrationId })
        .expect(409);
      // Reconnect goes back through Atlassian for the same integration.
      const reconnect = await request(server())
        .post(`/api/integrations/${integrationId}/reconnect`)
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(new URL(reconnect.body.data.url).origin).toBe('https://auth.atlassian.invalid');
    });

    it('Jira has no revocation endpoint: disconnect reports tokenRevoked false and drops tokens', async () => {
      const user = await f.user();
      const { integrationId } = await connectAndSync('jira', user.id);
      const res = await request(server())
        .delete(`/api/integrations/${integrationId}`)
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(res.body.data).toMatchObject({ tokenRevoked: false, purged: false });
      expect(await t.prisma.issue.count({ where: { integrationId } })).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Linear', () => {
    it('connect with PKCE, imports assigned issues (estimates → points), webhook HMAC + timestamp, disconnect revokes', async () => {
      const user = await f.user();
      fake.linear.issues = [
        linearIssue('ENG-1', { assigneeId: 'lin-user-dana', estimate: 3 }),
        linearIssue('ENG-2', { assigneeId: 'lin-user-dana', type: 'canceled' }),
        linearIssue('ENG-3', { assigneeId: 'lin-user-other' }),
      ];
      const { url, run, integrationId, token, callback } = await connectAndSync('linear', user.id);
      expect(url.origin).toBe('https://linear.invalid');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(callback.integration.provider).toBe('linear');
      expect(run.status).toBe('SUCCEEDED');
      const detail = await request(server())
        .get(`/api/integrations/${integrationId}`)
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(detail.body.data.settings.workspace).toEqual({
        id: 'org-acme',
        name: 'Acme',
        urlKey: 'acme',
      });
      const issues = await t.prisma.issue.findMany({
        where: { userId: user.id },
        orderBy: { key: 'asc' },
      });
      expect(issues.map((i) => [i.key, i.status, i.storyPoints, i.cycleName])).toEqual([
        ['ENG-1', 'DONE', 3, 'Cycle 7'],
        ['ENG-2', 'CANCELLED', 2, 'Cycle 7'],
      ]);

      const payload = {
        type: 'Issue',
        action: 'update',
        organizationId: 'org-acme',
        data: { assigneeId: 'lin-user-dana' },
      };
      const send = (body: string, sig: string) =>
        request(server())
          .post('/api/webhooks/linear')
          .set('content-type', 'application/json')
          .set('linear-event', 'Issue')
          .set('linear-delivery', 'aaaaaaaa-1111-4000-8000-000000000001')
          .set('linear-signature', sig)
          .send(body);
      const hmac = (b: string) =>
        createHmac('sha256', 'test-linear-webhook-secret').update(b).digest('hex');
      const stale = JSON.stringify({ ...payload, webhookTimestamp: Date.now() - 5 * 60_000 });
      await send(stale, hmac(stale)).expect(401); // replayed outside the 60 s window
      const fresh = JSON.stringify({ ...payload, webhookTimestamp: Date.now() });
      await send(fresh, hmac(fresh)).expect(202);
      const job = await queue().getJob(targetedJobId('lin-aaaaaaaa-1111-4000-8000-000000000001'));
      await t.app.get(SyncTargetedService).handle(job!.data);
      expect(await t.prisma.syncRun.count({ where: { integrationId, trigger: 'WEBHOOK' } })).toBe(
        1,
      );

      const res = await request(server())
        .delete(`/api/integrations/${integrationId}`)
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(res.body.data.tokenRevoked).toBe(true);
      expect(fake.revoked).toContainEqual({ provider: 'linear', token });
    });

    it('rate limit (429) pauses the run with resumeAt and resumes from the checkpoint', async () => {
      const user = await f.user();
      fake.linear.issues = [linearIssue('ENG-1', { assigneeId: 'lin-user-dana' })];
      const { callback } = await connect('linear', user.id);
      fake.throttle.add('linear');
      const outcome = await t.app.get(SyncEngine).run(callback.syncRun.id, user.id);
      expect(outcome.type).toBe('delayed');
      const paused = await t.prisma.syncRun.findUniqueOrThrow({
        where: { id: callback.syncRun.id },
      });
      expect(paused.status).toBe('WAITING_RATE_LIMIT');
      expect(paused.resumeAt).not.toBeNull();
      const resumed = await t.app.get(SyncEngine).run(callback.syncRun.id, user.id);
      expect(resumed).toEqual({ type: 'finished', status: 'SUCCEEDED' });
      expect(await t.prisma.issue.count({ where: { userId: user.id } })).toBe(1);
    });
  });

  describe('cross-cutting', () => {
    it('state is bound to the provider and the user (a GitLab state is refused on the Jira callback)', async () => {
      const user = await f.user();
      const other = await f.user();
      const start = await request(server())
        .post('/api/integrations/gitlab/connect')
        .set('authorization', bearer(user.id))
        .send({})
        .expect(200);
      const state = new URL(start.body.data.url).searchParams.get('state');
      await request(server())
        .post('/api/integrations/jira/callback')
        .set('authorization', bearer(user.id))
        .send({ code: 'x', state })
        .expect(400);
      const again = await request(server())
        .post('/api/integrations/gitlab/connect')
        .set('authorization', bearer(user.id))
        .send({})
        .expect(200);
      const res = await request(server())
        .post('/api/integrations/gitlab/callback')
        .set('authorization', bearer(other.id))
        .send({ code: 'x', state: new URL(again.body.data.url).searchParams.get('state') })
        .expect(400);
      expect(res.body.error.code).toBe('OAUTH_STATE_INVALID');
      await request(server())
        .post('/api/integrations/github-enterprise/connect')
        .set('authorization', bearer(user.id))
        .send({})
        .expect(400);
    });

    it('denied consent → OAUTH_DENIED; one provider account cannot join two DevImpact users', async () => {
      const user = await f.user();
      const start = await request(server())
        .post('/api/integrations/linear/connect')
        .set('authorization', bearer(user.id))
        .send({})
        .expect(200);
      const denied = await request(server())
        .post('/api/integrations/linear/callback')
        .set('authorization', bearer(user.id))
        .send({
          error: 'access_denied',
          state: new URL(start.body.data.url).searchParams.get('state'),
        })
        .expect(400);
      expect(denied.body.error.code).toBe('OAUTH_DENIED');

      await connect('linear', user.id, { token: 'shared-linear-token' });
      const second = await f.user();
      const next = await request(server())
        .post('/api/integrations/linear/connect')
        .set('authorization', bearer(second.id))
        .send({})
        .expect(200);
      fake.codes.set('code-shared', {
        provider: 'linear',
        accessToken: 'shared-linear-token',
        refreshToken: null,
      });
      const res = await request(server())
        .post('/api/integrations/linear/callback')
        .set('authorization', bearer(second.id))
        .send({ code: 'code-shared', state: new URL(next.body.data.url).searchParams.get('state') })
        .expect(409);
      expect(res.body.error.code).toBe('INTEGRATION_ACCOUNT_IN_USE');
      // The token we could not store was revoked again.
      expect(fake.revoked.map((r) => r.token)).toContain('shared-linear-token');
    });

    it('entitlements: FREE = 2 sources, one per provider; PRO = 4 (403 ENTITLEMENT_REQUIRED)', async () => {
      const free = await f.user();
      await f.integration(free.id, { externalAccountId: 'U_free' }); // GitHub
      await connect('jira', free.id);
      const full = await request(server())
        .post('/api/integrations/linear/connect')
        .set('authorization', bearer(free.id))
        .send({})
        .expect(403);
      expect(full.body.error).toMatchObject({
        code: 'ENTITLEMENT_REQUIRED',
        details: { entitlement: 'integrations', limit: 2, used: 2, plan: 'free' },
      });
      const pro = await f.user({ plan: 'PRO' });
      await connect('jira', pro.id, { token: 'pro-jira', account: 'acc-pro' });
      const dup = await request(server())
        .post('/api/integrations/jira/connect')
        .set('authorization', bearer(pro.id))
        .send({})
        .expect(403);
      expect(dup.body.error.details).toMatchObject({
        entitlement: 'integrations_per_provider',
        provider: 'jira',
      });
      await request(server())
        .post('/api/integrations/linear/connect')
        .set('authorization', bearer(pro.id))
        .send({})
        .expect(200);
      const ent = await request(server())
        .get('/api/me/entitlements')
        .set('authorization', bearer(pro.id))
        .expect(200);
      expect(ent.body.data).toMatchObject({
        limits: { integrations: 4, integrationsPerProvider: 1 },
        usage: { integrations: 1, byProvider: { jira: 1 } },
      });
    });

    it('GET /integrations/providers lists configured providers and GitLab instances', async () => {
      const user = await f.user();
      const res = await request(server())
        .get('/api/integrations/providers')
        .set('authorization', bearer(user.id))
        .expect(200);
      expect(res.body.data).toEqual([
        { provider: 'github', category: 'code', configured: true, instances: [] },
        {
          provider: 'gitlab',
          category: 'code',
          configured: true,
          instances: [
            { url: 'https://gitlab.invalid', label: 'gitlab.invalid' },
            { url: 'https://gitlab.selfhosted.invalid', label: 'Self-managed' },
          ],
        },
        { provider: 'jira', category: 'issues', configured: true, instances: [] },
        { provider: 'linear', category: 'issues', configured: true, instances: [] },
      ]);
    });

    it('issues are user-scoped: another user cannot read them; RefResolver resolves JIRA-/LIN- refs for the owner only', async () => {
      const user = await f.user();
      const other = await f.user();
      fake.jira.issues = [jiraIssue('PAY-1', { accountId: 'acc-dana' })];
      await connectAndSync('jira', user.id);
      const issue = await t.prisma.issue.findFirstOrThrow({ where: { userId: user.id } });
      await request(server())
        .get(`/api/activity/issues/${issue.id}`)
        .set('authorization', bearer(other.id))
        .expect(404);
      await request(server())
        .get(`/api/activity/issues/${issue.id}`)
        .set('authorization', bearer(user.id))
        .expect(200);
      const resolver = t.app.get(RefResolver);
      expect((await resolver.resolve(user.id, ['JIRA-PAY-1']))[0]).toMatchObject({
        kind: 'issue',
        id: issue.id,
      });
      expect(await resolver.resolve(other.id, ['JIRA-PAY-1'])).toEqual([]);
    });
  });
});
