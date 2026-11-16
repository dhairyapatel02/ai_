import { createHash } from 'node:crypto';

import { OAuthStateService, STATE_TTL_SECONDS } from './oauth-state.service';

import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

/** In-memory stand-in for the two Redis commands the service uses. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    getdel: jest.fn((key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return Promise.resolve(value);
    }),
  };
}

const config = {
  get: () => 'unit-test-oauth-state-secret-0123456789abcdef',
} as unknown as ConfigService;

describe('OAuthStateService (signed, expiring, single-use state — SEC-04)', () => {
  const setup = () => {
    const redis = fakeRedis();
    const service = new OAuthStateService(config as never, redis as unknown as Redis);
    return { redis, service };
  };

  it('issues a state that the same user can consume exactly once', async () => {
    const { service, redis } = setup();
    const issued = await service.issue('user_a', { returnTo: '/onboarding', pkce: true });
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^oauth-state:/),
      expect.any(String),
      'EX',
      STATE_TTL_SECONDS,
    );

    const consumed = await service.consume(issued.state, 'user_a');
    expect(consumed.payload).toMatchObject({ u: 'user_a', r: '/onboarding', p: 1 });
    // PKCE: the challenge is S256(verifier).
    expect(createHash('sha256').update(consumed.codeVerifier).digest('base64url')).toBe(
      issued.codeChallenge,
    );

    await expect(service.consume(issued.state, 'user_a')).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
    });
  });

  it('rejects a state started by another user (account-linking CSRF)', async () => {
    const { service } = setup();
    const issued = await service.issue('attacker');
    await expect(service.consume(issued.state, 'victim')).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
      status: 400,
    });
  });

  it('rejects expired states', async () => {
    const { service } = setup();
    const now = Date.now();
    const issued = await service.issue('user_a', {}, now);
    await expect(
      service.consume(issued.state, 'user_a', now + (STATE_TTL_SECONDS + 1) * 1000),
    ).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
    });
  });

  it('rejects tampered, unsigned and malformed states', async () => {
    const { service } = setup();
    const issued = await service.issue('user_a');
    const [body, sig] = issued.state.split('.') as [string, string];
    const forgedBody = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), u: 'user_b' }),
    ).toString('base64url');
    for (const bad of [
      `${forgedBody}.${sig}`,
      body,
      `${body}.`,
      'garbage',
      `${body}.${sig}.extra`,
      `${body}.${sig.slice(0, -2)}AA`,
    ]) {
      await expect(service.consume(bad, 'user_a')).rejects.toMatchObject({
        code: 'OAUTH_STATE_INVALID',
      });
    }
  });

  it('rejects a validly signed state whose nonce was never stored (or already used)', async () => {
    const { service, redis } = setup();
    const issued = await service.issue('user_a');
    redis.store.clear();
    await expect(service.consume(issued.state, 'user_a')).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
    });
  });
});
