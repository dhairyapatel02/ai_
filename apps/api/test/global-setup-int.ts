import { execSync } from 'node:child_process';
import path from 'node:path';

import { loadEnvFiles } from '../src/config/load-env';
import { useTestDatabase } from './utils/test-env';

/** Applies committed migrations to the test database once per run. */
export default function globalSetup(): void {
  loadEnvFiles();
  const devUrl = process.env.DATABASE_URL;
  const testUrl = useTestDatabase();
  if (devUrl && devUrl === testUrl) {
    throw new Error('DATABASE_URL_TEST must differ from DATABASE_URL — it is truncated by tests.');
  }
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
}
