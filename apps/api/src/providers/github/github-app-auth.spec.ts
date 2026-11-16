import { createVerify, generateKeyPairSync } from 'node:crypto';

import { GitHubAppAuth } from './github-app-auth';

import type { Env } from '../../config/env';
import type { ConfigService } from '@nestjs/config';

describe('GitHubAppAuth.appJwt', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const config = (values: Partial<Record<keyof Env, unknown>>) =>
    ({ get: (key: keyof Env) => values[key] }) as unknown as ConfigService<Env, true>;

  it.each([
    ['raw PEM', pkcs1],
    ['\\n-escaped PEM', pkcs1.replace(/\n/g, '\\n')],
    ['base64 PEM', Buffer.from(pkcs1).toString('base64')],
  ])('signs an RS256 JWT for the App from a %s key', (_label, key) => {
    const auth = new GitHubAppAuth(config({ GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: key }));
    const now = Date.UTC(2026, 10, 16, 12);
    const [header, payload, signature] = auth.appJwt(now).split('.');
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString())).toEqual({
      iat: now / 1000 - 60,
      exp: now / 1000 + 540,
      iss: '12345',
    });
    const ok = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature ?? '', 'base64url'));
    expect(ok).toBe(true);
  });

  it('refuses to sign without a configured key', () => {
    expect(() => new GitHubAppAuth(config({ GITHUB_APP_ID: '1' })).appJwt()).toThrow(
      /not configured/,
    );
  });
});
