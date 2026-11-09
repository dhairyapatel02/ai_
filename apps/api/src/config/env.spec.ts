import { EnvValidationError, validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv', () => {
  it('applies defaults for optional settings', () => {
    expect(validateEnv(base)).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 4000,
      WEB_URL: 'http://localhost:3000',
      RUN_WORKER_IN_API: true,
    });
  });

  it('falls back to PORT and NEXTAUTH_URL for backwards compatibility', () => {
    expect(
      validateEnv({ ...base, PORT: '8080', NEXTAUTH_URL: 'https://app.example.com' }),
    ).toMatchObject({ API_PORT: 8080, WEB_URL: 'https://app.example.com' });
    expect(validateEnv({ ...base, PORT: '8080', API_PORT: '4001' }).API_PORT).toBe(4001);
  });

  it('parses RUN_WORKER_IN_API booleans and treats empty strings as unset', () => {
    expect(validateEnv({ ...base, RUN_WORKER_IN_API: 'false' }).RUN_WORKER_IN_API).toBe(false);
    expect(validateEnv({ ...base, ANTHROPIC_API_KEY: '' }).ANTHROPIC_API_KEY).toBeUndefined();
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
    expect(message).toContain('.env.example');
  });
});
