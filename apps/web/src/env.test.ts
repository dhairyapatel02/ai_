import { describe, expect, it } from 'vitest';

import { parsePublicEnv } from './env';

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

describe('NEXT_PUBLIC_DEV_LOGIN_EMAIL', () => {
  it('is optional and validated as an email', () => {
    expect(parsePublicEnv({}).NEXT_PUBLIC_DEV_LOGIN_EMAIL).toBeUndefined();
    expect(parsePublicEnv({ NEXT_PUBLIC_DEV_LOGIN_EMAIL: 'demo@devimpact.dev' })).toMatchObject({
      NEXT_PUBLIC_DEV_LOGIN_EMAIL: 'demo@devimpact.dev',
    });
    expect(() => parsePublicEnv({ NEXT_PUBLIC_DEV_LOGIN_EMAIL: 'nope' })).toThrow();
  });
});
