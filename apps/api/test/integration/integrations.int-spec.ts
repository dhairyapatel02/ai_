import request from 'supertest';

import { TokenCipher } from '../../src/crypto/token-cipher';
import { createTestApp, type TestApp } from '../utils/app';
import { bearer } from '../utils/auth';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';
import { installFakeGitHub, type FakeGitHubState } from '../utils/fake-github';
import { TEST_SECRETS } from '../utils/test-env';

/** GitHub App connect flow (ADR-0004, ARCHITECTURE_V2 §5) against a faked GitHub. */
describe('GitHub App connect / callback / disconnect (integration)', () => {
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
  });

  afterEach(() => {
    restore();
  });

  afterAll(async () => {
    await t.close();
  });

  const server = () => t.app.getHttpServer();

  function grant(code: string, token: string, login = 'octocat', nodeId = `node-${login}`) {
    gh.codes.set(code, { token });
    gh.users.set(token, {
      id: 42,
      node_id: nodeId,
      login,
      name: 'The Octocat',
      avatar_url: 'https://avatars.example/o.png',
    });
    gh.installations.set(token, [
      {
        id: 1001,
        account: { login, type: 'User' },
        repository_selection: 'all',
        suspended_at: null,
      },
      {
        id: 1002,
        account: { login: 'acme', type: 'Organization' },
        repository_selection: 'selected',
        suspended_at: null,
      },
    ]);
  }

  async function connect(as: string, returnTo?: string) {
    const res = await request(server())
      .post('/api/integrations/github/connect')
      .set('authorization', as)
      .send(returnTo ? { returnTo } : {})
      .expect(200);
    const url = new URL(res.body.data.url as string);
    return {
      body: res.body.data as { mode: string; url: string; expiresAt: string },
      state: url.searchParams.get('state') ?? '',
      url,
    };
  }

  it('connect returns a GitHub App install URL with a signed state (SEC-04)', async () => {
    const user = await f.user();
    const { body, state, url } = await connect(bearer(user.id), '/onboarding');
    expect(body.mode).toBe('install');
    expect(url.origin + url.pathname).toBe(
      'https://github.invalid/apps/devimpact-test/installations/new',
    );
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(600_000);
  });

  it('callback exchanges the code, stores tokens encrypted (no plaintext in the DB) and returns the integration', async () => {
    const user = await f.user();
    const as = bearer(user.id);
    const { state } = await connect(as, '/onboarding');
    grant('code-1', 'ghu_plaintext_access_token');

    const res = await request(server())
      .post('/api/integrations/github/callback')
      .set('authorization', as)
      .send({ code: 'code-1', state, installationId: '1001', setupAction: 'install' })
      .expect(201);

    expect(res.body.data).toMatchObject({
      integration: {
        provider: 'github',
        status: 'active',
        externalLogin: 'octocat',
        installations: expect.any(Array),
      },
      syncRun: { status: 'queued', kind: 'backfill', trigger: 'initial', progress: 0 },
      returnTo: '/onboarding',
    });
    expect(res.body.data.integration.installations).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toContain('ghu_plaintext_access_token');

    // DB inspection: no plaintext token anywhere in the integrations table.
    const rows = await t.prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM integrations`;
    expect(JSON.stringify(rows)).not.toContain('ghu_plaintext_access_token');
    const row = await t.prisma.integration.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.accessTokenEnc).toMatch(/^v2\./); // active key version from TEST_SECRETS
    expect(row.refreshTokenEnc).toMatch(/^v2\./);

    // …and it decrypts with the configured key and the row-bound AAD.
    const keys = new Map(
      TEST_SECRETS.TOKEN_ENCRYPTION_KEYS.split(',').map((e) => {
        const [v, k] = e.split(':') as [string, string];
        return [Number(v), Buffer.from(k, 'base64')] as const;
      }),
    );
    const cipher = new TokenCipher(keys, 2);
    expect(cipher.decrypt(row.accessTokenEnc ?? '', TokenCipher.aad(row.id, 'accessToken'))).toBe(
      'ghu_plaintext_access_token',
    );

    // GET /integrations never exposes token columns.
    const list = await request(server())
      .get('/api/integrations')
      .set('authorization', as)
      .expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(/accessToken|refreshToken|TokenEnc/);
  });

  it.each([
    ['missing', undefined],
    ['garbage', 'not-a-state'],
    ['tampered', 'eyJ1IjoiYSJ9.c2lnbmF0dXJl'],
  ])(
    'callback with a %s state → 400 (OAUTH_STATE_INVALID / VALIDATION_FAILED), no exchange',
    async (_n, state) => {
      const user = await f.user();
      grant('code-x', 'ghu_x');
      const res = await request(server())
        .post('/api/integrations/github/callback')
        .set('authorization', bearer(user.id))
        .send({ code: 'code-x', ...(state ? { state } : {}) })
        .expect(400);
      expect(['OAUTH_STATE_INVALID', 'VALIDATION_FAILED']).toContain(res.body.error.code);
      expect(gh.exchanges).toHaveLength(0);
    },
  );

  it('callback with a reused state is rejected (single use)', async () => {
    const user = await f.user();
    const as = bearer(user.id);
    const { state } = await connect(as);
    grant('code-1', 'ghu_one');
    await request(server())
      .post('/api/integrations/github/callback')
      .set('authorization', as)
      .send({ code: 'code-1', state })
      .expect(201);
    grant('code-2', 'ghu_two');
    const replay = await request(server())
      .post('/api/integrations/github/callback')
      .set('authorization', as)
      .send({ code: 'code-2', state })
      .expect(400);
    expect(replay.body.error.code).toBe('OAUTH_STATE_INVALID');
  });

  it('callback with an expired state is rejected', async () => {
    const user = await f.user();
    const as = bearer(user.id);
    const { state } = await connect(as);
    jest.useFakeTimers({
      now: Date.now() + 11 * 60_000,
      doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'],
    });
    try {
      grant('code-1', 'ghu_late');
      const res = await request(server())
        .post('/api/integrations/github/callback')
        .set('authorization', bearer(user.id))
        .send({ code: 'code-1', state })
        .expect(400);
      expect(res.body.error.code).toBe('OAUTH_STATE_INVALID');
    } finally {
      jest.useRealTimers();
    }
  });

  it('a state issued to another user cannot be used (login-CSRF account linking)', async () => {
    const attacker = await f.user();
    const victim = await f.user();
    const { state } = await connect(bearer(attacker.id));
    grant('code-1', 'ghu_attacker');
    const res = await request(server())
      .post('/api/integrations/github/callback')
      .set('authorization', bearer(victim.id))
      .send({ code: 'code-1', state })
      .expect(400);
    expect(res.body.error.code).toBe('OAUTH_STATE_INVALID');
    expect(await t.prisma.integration.count()).toBe(0);
  });

  it('denied consent → 400 OAUTH_DENIED (state still verified and burned)', async () => {
    const user = await f.user();
    const as = bearer(user.id);
    const { state } = await connect(as);
    const res = await request(server())
      .post('/api/integrations/github/callback')
      .set('authorization', as)
      .send({ state, error: 'access_denied' })
      .expect(400);
    expect(res.body.error.code).toBe('OAUTH_DENIED');
    const again = await request(server())
      .post('/api/integrations/github/callback')
      .set('authorization', as)
      .send({ state, error: 'access_denied' })
      .expect(400);
    expect(again.body.error.code).toBe('OAUTH_STATE_INVALID');
  });

  it('org approval pending (setupAction=request, no code) → 200 pendingApproval', async () => {
    const user = await f.user();
    const as = bearer(user.id);
    const { state } = await connect(as);
    const res = await request(server())
      .post('/api/integrations/github/callback')
      .set('authorization', as)
      .send({ state, setupAction: 'request' })
      .expect(200);
    expect(res.body.data).toMatchObject({ integration: null, pendingApproval: true });
  });

  it('a GitHub account linked to another DevImpact user → 409 INTEGRATION_ACCOUNT_IN_USE (token revoked)', async () => {
    const owner = await f.user();
    await f.integration(owner.id, { externalAccountId: 'node-octocat' });
    const other = await f.user();
    const as = bearer(other.id);
    const { state } = await connect(as);
    grant('code-1', 'ghu_dupe');
    const res = await request(server())
      .post('/api/integrations/github/callback')
      .set('authorization', as)
      .send({ code: 'code-1', state })
      .expect(409);
    expect(res.body.error.code).toBe('INTEGRATION_ACCOUNT_IN_USE');
    expect(gh.revoked).toContain('ghu_dupe');
  });

  it('upgrades a migrated v0.1 integration in place, then authorizes (PKCE) on reconnect', async () => {
    const user = await f.user();
    const legacy = await f.integration(user.id, {
      mechanism: 'OAUTH_APP',
      status: 'NEEDS_REAUTH',
      externalLogin: 'octocat',
    });
    const gitHubData = await f.commit(user.id, legacy.id);
    const as = bearer(user.id);

    const first = await connect(as);
    grant('code-1', 'ghu_first');
    await request(server())
      .post('/api/integrations/github/callback')
      .set('authorization', as)
      .send({ code: 'code-1', state: first.state })
      .expect(201);
    const upgraded = await t.prisma.integration.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(upgraded).toMatchObject({
      mechanism: 'GITHUB_APP',
      status: 'ACTIVE',
      externalAccountId: 'node-octocat',
    });
    expect(await t.prisma.commit.count({ where: { id: gitHubData.id } })).toBe(1);

    const again = await request(server())
      .post(`/api/integrations/${legacy.id}/reconnect`)
      .set('authorization', as)
      .expect(200);
    const url = new URL(again.body.data.url as string);
    expect(again.body.data.mode).toBe('authorize');
    expect(url.pathname).toBe('/login/oauth/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/integrations/github/callback',
    );

    grant('code-2', 'ghu_second');
    await request(server())
      .post('/api/integrations/github/callback')
      .set('authorization', as)
      .send({ code: 'code-2', state: url.searchParams.get('state') })
      .expect(201);
    expect(gh.exchanges.at(-1)?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('enforces the plan’s single-integration limit on connect (403 ENTITLEMENT_REQUIRED)', async () => {
    const user = await f.user();
    await f.integration(user.id, { externalAccountId: 'node-a' });
    const res = await request(server())
      .post('/api/integrations/github/connect')
      .set('authorization', bearer(user.id))
      .send({})
      .expect(403);
    expect(res.body.error).toMatchObject({
      code: 'ENTITLEMENT_REQUIRED',
      details: { entitlement: 'integrations', limit: 1 },
    });
  });

  it('disconnect revokes the token at GitHub, drops tokens, keeps data by default and purges on request', async () => {
    const user = await f.user();
    const as = bearer(user.id);
    const { state } = await connect(as);
    grant('code-1', 'ghu_to_revoke');
    const connected = await request(server())
      .post('/api/integrations/github/callback')
      .set('authorization', as)
      .send({ code: 'code-1', state })
      .expect(201);
    const id = connected.body.data.integration.id as string;
    await f.commit(user.id, id);
    await f.pullRequest(user.id, id);

    const keep = await request(server())
      .delete(`/api/integrations/${id}`)
      .set('authorization', as)
      .expect(200);
    expect(keep.body.data).toEqual({
      integrationId: id,
      status: 'disconnected',
      purged: false,
      tokenRevoked: true,
    });
    expect(gh.revoked).toEqual(['ghu_to_revoke']);
    const row = await t.prisma.integration.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      status: 'DISCONNECTED',
      accessTokenEnc: null,
      refreshTokenEnc: null,
    });
    expect(await t.prisma.commit.count({ where: { integrationId: id } })).toBe(1);

    const purge = await request(server())
      .delete(`/api/integrations/${id}?purgeData=true`)
      .set('authorization', as)
      .expect(200);
    expect(purge.body.data).toMatchObject({ purged: true, tokenRevoked: false });
    expect(await t.prisma.commit.count({ where: { integrationId: id } })).toBe(0);
    expect(await t.prisma.pullRequest.count({ where: { integrationId: id } })).toBe(0);
  });
});
