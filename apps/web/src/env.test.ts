import { afterEach, describe, expect, it, vi } from 'vitest';

import { EXAMPLE_AUTH_SECRET, isDevLoginEnabled, parsePublicEnv, parseServerEnv } from './env';

describe('parsePublicEnv', () => {
  it('defaults the API URL for local development', () => {
    expect(parsePublicEnv({}).NEXT_PUBLIC_API_URL).toBe('http://localhost:4000/api');
    expect(parsePublicEnv({ NEXT_PUBLIC_API_URL: '' }).NEXT_PUBLIC_API_URL).toBe(
      'http://localhost:4000/api',
    );
  });

  it('rejects a malformed API URL with a readable error', () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_API_URL: 'not a url' })).toThrow(
      /Invalid web environment configuration: NEXT_PUBLIC_API_URL/,
    );
  });
});

const server = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
};

describe('parseServerEnv', () => {
  it('derives auth URLs from WEB_URL and enables only configured providers', () => {
    const env = parseServerEnv({
      ...server,
      WEB_URL: 'https://app.example.com/,https://preview.example.com',
      GITHUB_SIGNIN_CLIENT_ID: 'id',
      GITHUB_SIGNIN_CLIENT_SECRET: 'secret',
    });
    expect(env).toMatchObject({
      WEB_URL: 'https://app.example.com',
      WEB_ORIGINS: ['https://app.example.com', 'https://preview.example.com'],
      BETTER_AUTH_URL: 'https://app.example.com',
      AUTH_JWT_ISSUER: 'https://app.example.com',
      AUTH_JWT_AUDIENCE: 'devimpact-api',
      github: { clientId: 'id', clientSecret: 'secret' },
      google: undefined,
    });
  });

  it('requires DATABASE_URL and a 32+ character BETTER_AUTH_SECRET', () => {
    expect(() => parseServerEnv({ BETTER_AUTH_SECRET: 'short' })).toThrow(
      /DATABASE_URL.*BETTER_AUTH_SECRET/,
    );
  });

  it('refuses the example secret in production', () => {
    expect(() =>
      parseServerEnv({
        ...server,
        BETTER_AUTH_SECRET: EXAMPLE_AUTH_SECRET,
        NODE_ENV: 'production',
      }),
    ).toThrow(/must not be the .env.example value/);
    expect(() =>
      parseServerEnv({ ...server, BETTER_AUTH_SECRET: EXAMPLE_AUTH_SECRET }),
    ).not.toThrow();
  });
});

describe('isDevLoginEnabled (ADR-0003)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('requires ENABLE_DEV_LOGIN=true outside production', () => {
    expect(isDevLoginEnabled({ NODE_ENV: 'development', ENABLE_DEV_LOGIN: 'true' })).toBe(true);
    expect(isDevLoginEnabled({ NODE_ENV: 'test', ENABLE_DEV_LOGIN: 'true' })).toBe(true);
    expect(isDevLoginEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(isDevLoginEnabled({ NODE_ENV: 'development', ENABLE_DEV_LOGIN: '1' })).toBe(false);
  });

  it('is impossible to enable in production, whatever ENABLE_DEV_LOGIN says', () => {
    expect(isDevLoginEnabled({ NODE_ENV: 'production', ENABLE_DEV_LOGIN: 'true' })).toBe(false);
    vi.stubEnv('NODE_ENV', 'production');
    expect(isDevLoginEnabled({ NODE_ENV: 'development', ENABLE_DEV_LOGIN: 'true' })).toBe(false);
  });
});

describe('API_INTERNAL_URL (server-side API calls)', () => {
  it('defaults to NEXT_PUBLIC_API_URL and strips trailing slashes', () => {
    expect(parseServerEnv({ ...server }).API_INTERNAL_URL).toBe('http://localhost:4000/api');
    expect(
      parseServerEnv({ ...server, NEXT_PUBLIC_API_URL: 'https://api.example.com/api/' }).API_INTERNAL_URL,
    ).toBe('https://api.example.com/api');
    expect(parseServerEnv({ ...server, API_INTERNAL_URL: 'http://api:4000/api' }).API_INTERNAL_URL).toBe(
      'http://api:4000/api',
    );
  });
});

