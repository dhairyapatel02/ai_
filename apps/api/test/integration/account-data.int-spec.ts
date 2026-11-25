import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import request from 'supertest';

import { TokenCipher, TokenCipherService } from '../../src/crypto/token-cipher';
import { GitHubAppClient } from '../../src/integrations/github-app.client';
import {
  EXPORT_EXCLUDED,
  EXPORT_OMITTED_COLUMNS,
  EXPORT_SECTIONS,
} from '../../src/me/data-export.service';
import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';

const githubMock = {
  revokeToken: jest.fn().mockResolvedValue(true),
  manageUrl: () => 'https://github.com/apps/devimpact-test',
};

const SECRET_TOKEN = 'gho_super_secret_access_token_value';
const SESSION_TOKEN = 'better-auth-session-token-value-xyz';

/**
 * F-03 / F-04 / F-06: `GET /me/export` completeness (every user-owned model, no secrets, safe
 * attachment header, 3/day), `DELETE /me` cascade (zero rows left in every table, GitHub tokens
 * revoked through the intercepted client, Redis state removed), and plan limits enforced
 * server-side (history window, entitlements shape).
 */
describe('Account data: export, deletion, entitlements (integration)', () => {
  let t: TestApp;
  let f: Factories;
  const server = () => t.app.getHttpServer();

  beforeAll(async () => {
    t = await createTestApp((b) => b.overrideProvider(GitHubAppClient).useValue(githubMock));
    f = buildFactories(t.prisma);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await resetRedisState();
    githubMock.revokeToken.mockClear();
  });

  afterAll(async () => {
    await t.close();
  });

  /** A user with at least one row in every user-owned table. */
  async function fullUser(email = 'alice@example.test') {
    const user = await f.user({
      email,
      settings: { create: { timezone: 'UTC', digestEnabled: true } },
      sessions: {
        create: { token: `${SESSION_TOKEN}-${email}`, expiresAt: new Date('2099-01-01T00:00:00Z') },
      },
      accounts: {
        create: {
          providerId: 'github',
          accountId: `gh-${email}`,
          accessToken: 'oauth-secret',
          password: 'pw-hash',
        },
      },
    });
    const gh = await f.integration(user.id, { externalAccountId: `node-${email}` });
    const cipher = t.app.get(TokenCipherService);
    await t.prisma.integration.update({
      where: { id: gh.id },
      data: { accessTokenEnc: cipher.encrypt(SECRET_TOKEN, TokenCipher.aad(gh.id, 'accessToken')) },
    });
    await t.prisma.gitHubInstallation.create({
      data: {
        integrationId: gh.id,
        installationId: BigInt(42),
        accountLogin: 'acme',
        accountType: 'Organization',
        repositorySelection: 'all',
      },
    });
    const pr = await f.pullRequest(user.id, gh.id);
    const commit = await f.commit(user.id, gh.id);
    const review = await f.review(user.id, gh.id);
    await t.prisma.issue.create({
      data: {
        userId: user.id,
        integrationId: gh.id,
        externalId: 'issue-1',
        key: 'PAY-1',
        title: 'Issue',
        createdAtRemote: new Date(),
        updatedAtRemote: new Date(),
      },
    });
    await t.prisma.providerIdentity.create({
      data: {
        userId: user.id,
        integrationId: gh.id,
        provider: 'GITHUB',
        kind: 'EMAIL',
        value: `${user.id}@example.test`,
        source: 'MANUAL',
      },
    });
    await t.prisma.syncRun.create({
      data: { userId: user.id, integrationId: gh.id, trigger: 'MANUAL', kind: 'INCREMENTAL' },
    });
    await t.prisma.metricSnapshot.create({
      data: {
        userId: user.id,
        date: new Date('2026-10-01T00:00:00Z'),
        timezone: 'UTC',
        metricsVersion: 'metrics@2.0.0',
      },
    });
    await t.prisma.impactScore.create({
      data: {
        userId: user.id,
        periodType: 'MONTH',
        periodStart: new Date('2026-10-01T00:00:00Z'),
        periodEnd: new Date('2026-10-31T00:00:00Z'),
        timezone: 'UTC',
        scoreVersion: 'impact@2.0.0',
        metricsVersion: 'metrics@2.0.0',
        status: 'OK',
        inputs: {},
        explanation: 'x',
      },
    });
    await t.prisma.impactScoreLegacy.create({
      data: {
        userId: user.id,
        month: 1,
        year: 2026,
        overall: 1,
        featureDelivery: 1,
        codeQuality: 1,
        collaboration: 1,
        leadership: 1,
      },
    });
    const doc = await f.document(user.id);
    await t.prisma.aiUsage.create({
      data: {
        userId: user.id,
        documentId: doc.id,
        feature: 'RESUME',
        promptId: 'resume',
        promptVersion: 1,
        model: 'm',
        latencyMs: 1,
        status: 'SUCCEEDED',
      },
    });
    const ach = await t.prisma.achievement.create({
      data: {
        userId: user.id,
        title: 'Win',
        category: 'DELIVERY',
        occurredOn: new Date('2026-10-01T00:00:00Z'),
        evidence: {
          create: [
            { kind: 'PULL_REQUEST', pullRequestId: pr.id },
            { kind: 'COMMIT', commitId: commit.id },
            { kind: 'REVIEW', reviewId: review.id },
          ],
        },
      },
    });
    await t.prisma.goal.create({
      data: {
        userId: user.id,
        title: 'Goal',
        startDate: new Date('2026-10-01T00:00:00Z'),
        achievements: { create: { achievementId: ach.id } },
      },
    });
    await t.prisma.digestDelivery.create({
      data: { userId: user.id, weekStart: new Date('2026-11-16T00:00:00Z'), status: 'SENT' },
    });
    return { user, gh, doc };
  }

  const tables = async () =>
    (
      await t.prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`
    ).map((r) => r.tablename);
  const countOf = async (table: string) =>
    Number(
      (await t.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}"`))[0]
        ?.n ?? 0,
    );

  describe('GET /me/export', () => {
    it('lists every user-data model of the schema (or excludes it with a reason)', () => {
      const models = Prisma.dmmf.datamodel.models.map((m) => m.name).sort();
      const covered = [...Object.values(EXPORT_SECTIONS), ...Object.keys(EXPORT_EXCLUDED)].sort();
      expect(covered).toEqual(models);
    });

    it('streams a JSON attachment with every section filled, no tokens or secrets, safe filename', async () => {
      const { user } = await fullUser();
      const other = await fullUser('bob@example.test');
      const res = await request(server())
        .get('/api/me/export')
        .set('authorization', bearer(user.id))
        .buffer(true)
        .parse((r, cb) => {
          let body = '';
          r.setEncoding('utf8');
          r.on('data', (c: string) => (body += c));
          r.on('end', () => {
            cb(null, body);
          });
        })
        .expect(200);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="devimpact-export-\d{4}-\d{2}-\d{2}\.json"$/,
      );
      expect(res.headers['cache-control']).toBe('private, no-store');
      const text = res.body as string;
      const data = JSON.parse(text) as Record<string, unknown>;
      expect(data.schemaVersion).toBe(1);
      for (const key of Object.keys(EXPORT_SECTIONS)) {
        expect(data).toHaveProperty(key);
        const v = data[key];
        if (Array.isArray(v)) expect(v.length).toBeGreaterThan(0);
        else expect(v).toBeTruthy();
      }
      // Only this user's rows.
      expect(text).not.toContain(other.user.id);
      expect((data.user as { email: string }).email).toBe('alice@example.test');
      // No secrets: token values and secret column names never appear.
      for (const secret of [SECRET_TOKEN, SESSION_TOKEN, 'oauth-secret', 'pw-hash'])
        expect(text).not.toContain(secret);
      for (const cols of Object.values(EXPORT_OMITTED_COLUMNS)) {
        for (const col of cols) expect(text).not.toContain(`"${col}":`);
      }
      expect((data.githubInstallations as { installationId: string }[])[0]?.installationId).toBe(
        '42',
      );
    });

    it('requires auth and is limited to 3 per day (export-data class)', async () => {
      await request(server()).get('/api/me/export').expect(401);
      const user = await f.user();
      for (let i = 0; i < 3; i++)
        await request(server())
          .get('/api/me/export')
          .set('authorization', bearer(user.id))
          .expect(200);
      const res = await request(server())
        .get('/api/me/export')
        .set('authorization', bearer(user.id))
        .expect(429);
      expect(res.body.error).toMatchObject({
        code: 'RATE_LIMITED',
        details: expect.objectContaining({ class: 'data-export' }),
      });
    });
  });

  describe('DELETE /me', () => {
    let openRedis: Redis | undefined;
    afterEach(() => {
      openRedis?.disconnect();
      openRedis = undefined;
    });

    it('rejects a mismatched email (400) and keeps the account', async () => {
      const { user } = await fullUser();
      const res = await request(server())
        .delete('/api/me')
        .set('authorization', bearer(user.id))
        .send({ confirmEmail: 'someone@example.test' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await t.prisma.user.count({ where: { id: user.id } })).toBe(1);
    });

    it('revokes GitHub tokens, deletes every row of the user in every table and its Redis state', async () => {
      const { user, doc } = await fullUser();
      const bob = await f.user({ settings: { create: {} } });
      await t.prisma.achievement.create({
        data: {
          userId: bob.id,
          title: 'Bob',
          category: 'OTHER',
          occurredOn: new Date('2026-10-01T00:00:00Z'),
        },
      });
      await t.prisma.webhookDelivery.create({
        data: { id: 'delivery-1', provider: 'GITHUB', event: 'ping' },
      });

      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
      openRedis = redis;
      await redis.set(`devimpact:sse:${user.id}`, '1');
      await redis.set(`devimpact:rl:default:user:${user.id}`, '5');
      await redis.set(`devimpact:doc-events:devimpact-test:${doc.id}`, 'x');
      await redis.set('devimpact:rl:default:user:someone-else', '5');

      // Every table holds data before the deletion (so the zero-row check is meaningful).
      const shared = new Set(['webhook_deliveries', 'jwks', 'verifications']);
      for (const table of await tables()) {
        if (!shared.has(table)) expect([table, await countOf(table)]).not.toEqual([table, 0]);
      }

      await request(server())
        .delete('/api/me')
        .set('authorization', bearer(user.id))
        .send({ confirmEmail: 'ALICE@example.test' })
        .expect(202, { success: true, data: { deleted: true } });
      expect(githubMock.revokeToken).toHaveBeenCalledWith(SECRET_TOKEN);

      const bobRows: Record<string, number> = { users: 1, user_settings: 1, achievements: 1 };
      for (const table of await tables()) {
        if (shared.has(table)) continue;
        expect([table, await countOf(table)]).toEqual([table, bobRows[table] ?? 0]);
      }
      expect(await countOf('webhook_deliveries')).toBe(1);
      expect(
        await redis.exists(
          `devimpact:sse:${user.id}`,
          `devimpact:rl:default:user:${user.id}`,
          `devimpact:doc-events:devimpact-test:${doc.id}`,
        ),
      ).toBe(0);
      expect(await redis.exists('devimpact:rl:default:user:someone-else')).toBe(1);

      // The still-valid JWT no longer works (account gone).
      await request(server()).get('/api/me').set('authorization', bearer(user.id)).expect(401);
    });
  });

  describe('entitlements', () => {
    it('GET /me/entitlements reflects plan limits incl. history window and weekly digest', async () => {
      const free = await f.user();
      const res = await request(server())
        .get('/api/me/entitlements')
        .set('authorization', bearer(free.id))
        .expect(200);
      expect(res.body.data).toEqual({
        plan: 'free',
        limits: {
          integrations: 2,
          integrationsPerProvider: 1,
          historyMonths: 12,
          aiGenerationsPerMonth: 15,
          aiQuickPerMonth: 100,
          weeklyDigest: true,
        },
        usage: { integrations: 0, byProvider: {} },
      });
    });

    it('rejects periods older than the plan history window with 403 ENTITLEMENT_REQUIRED (FREE 12, PRO 36 months)', async () => {
      const free = await f.user();
      const pro = await f.user({ plan: 'PRO' });
      const old = `year:${new Date().getUTCFullYear() - 2}`;
      const res = await request(server())
        .get(`/api/metrics/overview?period=${old}`)
        .set('authorization', bearer(free.id))
        .expect(403);
      expect(res.body.error).toEqual(
        expect.objectContaining({
          code: 'ENTITLEMENT_REQUIRED',
          details: { entitlement: 'history_window', limit: 12, plan: 'free' },
        }),
      );
      await request(server())
        .post('/api/documents/preview-evidence')
        .set('authorization', bearer(free.id))
        .send({ type: 'appraisal', period: old })
        .expect(403);
      await request(server())
        .get(`/api/metrics/overview?period=${old}`)
        .set('authorization', bearer(pro.id))
        .expect(200);
      await request(server())
        .get('/api/metrics/overview?period=month:2026-10')
        .set('authorization', bearer(free.id))
        .expect(200);
    });
  });
});
