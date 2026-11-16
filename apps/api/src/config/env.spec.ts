import { EnvValidationError, validateEnv } from './env';

const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  TOKEN_ENCRYPTION_KEYS: `1:${key(1)}`,
  TOKEN_ENCRYPTION_ACTIVE_KEY: '1',
  OAUTH_STATE_SECRET: 'x'.repeat(40),
};

describe('validateEnv', () => {
  it('applies defaults for optional settings', () => {
    expect(validateEnv(base)).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 4000,
      WEB_URL: 'http://localhost:3000',
      WEB_ORIGINS: ['http://localhost:3000'],
      AUTH_JWT_ISSUER: 'http://localhost:3000',
      AUTH_JWT_AUDIENCE: 'devimpact-api',
      AUTH_JWKS_URL: 'http://localhost:3000/api/auth/jwks',
      RUN_WORKER_IN_API: true,
    });
  });

  it('falls back to PORT for PaaS hosts', () => {
    expect(validateEnv({ ...base, PORT: '8080' }).API_PORT).toBe(8080);
    expect(validateEnv({ ...base, PORT: '8080', API_PORT: '4001' }).API_PORT).toBe(4001);
  });

  it('accepts a comma-separated WEB_URL allow-list; the first entry is the redirect base', () => {
    const env = validateEnv({
      ...base,
      WEB_URL: 'https://app.example.com/, https://preview.example.com',
    });
    expect(env.WEB_URL).toBe('https://app.example.com');
    expect(env.WEB_ORIGINS).toEqual(['https://app.example.com', 'https://preview.example.com']);
    expect(env.AUTH_JWKS_URL).toBe('https://app.example.com/api/auth/jwks');
  });

  it('parses RUN_WORKER_IN_API booleans and treats empty strings as unset', () => {
    expect(validateEnv({ ...base, RUN_WORKER_IN_API: 'false' }).RUN_WORKER_IN_API).toBe(false);
    expect(validateEnv({ ...base, ANTHROPIC_API_KEY: '' }).ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('validates the token encryption key list (32-byte keys, active key present)', () => {
    const env = validateEnv({
      ...base,
      TOKEN_ENCRYPTION_KEYS: `1:${key(1)},2:${key(2)}`,
      TOKEN_ENCRYPTION_ACTIVE_KEY: '2',
    });
    expect([...env.TOKEN_ENCRYPTION_KEYS.keys()]).toEqual([1, 2]);

    expect(() =>
      validateEnv({ ...base, TOKEN_ENCRYPTION_KEYS: `1:${Buffer.alloc(16).toString('base64')}` }),
    ).toThrow(/exactly 32 bytes/);
    expect(() => validateEnv({ ...base, TOKEN_ENCRYPTION_ACTIVE_KEY: '3' })).toThrow(
      /must name a version listed/,
    );
    expect(() => validateEnv({ ...base, TOKEN_ENCRYPTION_KEYS: 'not-a-key' })).toThrow(
      /<version>:<base64 key>/,
    );
  });

  it('refuses the .env.example secrets in production', () => {
    const example = {
      ...base,
      NODE_ENV: 'production',
      TOKEN_ENCRYPTION_KEYS: '1:ZGV2LW9ubHktdG9rZW4ta2V5LWRvLW5vdC11c2UtISE=',
      OAUTH_STATE_SECRET: 'dev-only-oauth-state-secret-change-me-0123456789',
    };
    expect(() => validateEnv(example)).toThrow(/must not be used in production/);
    expect(() => validateEnv({ ...example, NODE_ENV: 'development' })).not.toThrow();
  });

  it('reports every missing or malformed required variable in one readable error', () => {
    let error: unknown;
    try {
      validateEnv({ REDIS_URL: 'http://nope' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EnvValidationError);
    const message = (error as Error).message;
    expect(message).toContain('DATABASE_URL: DATABASE_URL is required');
    expect(message).toContain('REDIS_URL: REDIS_URL must be a redis:// or rediss:// URL');
    expect(message).toContain('TOKEN_ENCRYPTION_KEYS');
    expect(message).toContain('.env.example');
  });
});
