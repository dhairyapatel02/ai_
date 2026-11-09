import { loadEnvFiles } from '../../src/config/load-env';

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
  process.env.TZ = 'UTC';
  return testUrl;
}
