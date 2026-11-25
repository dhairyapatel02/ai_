import { loadEnvFiles } from '../../src/config/load-env';

/** Fixed, test-only secrets (never used outside tests). */
export const TEST_SECRETS = {
  TOKEN_ENCRYPTION_KEYS: `1:${Buffer.alloc(32, 1).toString('base64')},2:${Buffer.alloc(32, 2).toString('base64')}`,
  TOKEN_ENCRYPTION_ACTIVE_KEY: '2',
  OAUTH_STATE_SECRET: 'integration-test-oauth-state-secret-0123456789abcdef',
  UNSUBSCRIBE_TOKEN_SECRET: 'integration-test-unsubscribe-secret-0123456789abcdef',
};

/**
 * Resolves the integration-test database URL and points DATABASE_URL at it, so Prisma, the Nest
 * app and the migration step never touch the development database.
 */
export function useTestDatabase(): string {
  loadEnvFiles();
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Integration tests need a dedicated, disposable database ' +
        '(see .env.example).',
    );
  }
  process.env.DATABASE_URL = testUrl;
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.RUN_WORKER_IN_API = 'false';
  process.env.NODE_ENV = 'test';
  process.env.TZ = 'UTC';
  // Deterministic auth/crypto config regardless of the developer's .env.
  process.env.WEB_URL = 'http://localhost:3000';
  delete process.env.AUTH_JWT_ISSUER;
  delete process.env.AUTH_JWT_AUDIENCE;
  Object.assign(process.env, TEST_SECRETS);
  process.env.GITHUB_APP_SLUG = 'devimpact-test';
  process.env.GITHUB_APP_CLIENT_ID = 'Iv1.testclientid';
  process.env.GITHUB_APP_CLIENT_SECRET = 'test-client-secret';
  // Unroutable hosts: a missing mock can never reach the real GitHub.
  process.env.GITHUB_WEB_URL = 'https://github.invalid';
  process.env.GITHUB_API_URL = 'https://api.github.invalid';
  process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret-0123456789';
  process.env.GITHUB_REQUEST_RETRIES = '0';
  process.env.GITHUB_THROTTLING = 'false'; // no 1 s pacing between fake GraphQL calls
  delete process.env.QUEUE_PREFIX; // NODE_ENV=test → "devimpact-test" (OPS-17)
  // AI: never the real Anthropic. Tests that generate start the in-process fake
  // (`startFakeAnthropic`) and set ANTHROPIC_BASE_URL/KEY before creating the app.
  delete process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';
  process.env.AI_RETRY_BASE_MS = '0';
  delete process.env.ENTITLEMENTS_JSON;
  // Email: in-process transport only (never a provider); no hourly digest scheduler noise.
  process.env.EMAIL_TRANSPORT = 'memory';
  delete process.env.SMTP_URL;
  delete process.env.RESEND_API_KEY;
  delete process.env.RATE_LIMIT_DATA_EXPORT_PER_DAY;
  return testUrl;
}
