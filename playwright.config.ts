import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests against a migrated + seeded database (`npm run db:deploy && npm run db:seed`) and the
 * built API (`npm run build`). Run with `npm run test:e2e` (traces off by default; re-run a
 * failing test with `--trace on` to debug).
 *
 * Servers:
 * - API (`node apps/api/dist/main.js`, :4000) — verifies JWTs via the web app's JWKS.
 * - Web in development mode (:3000) with ENABLE_DEV_LOGIN=true — dev login is impossible in a
 *   production build by design (ADR-0003), so signed-in flows run against `next dev`.
 * - Web production build (`next start`, :3001) with ENABLE_DEV_LOGIN=true — proves the dev login
 *   returns 404 in production.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
const WEB_PROD_URL = process.env.E2E_WEB_PROD_URL ?? 'http://localhost:3001';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000/api';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
    },
    {
      command: 'npm run dev --workspace=apps/web -- --port 3000',
      url: `${WEB_URL}/api/health`,
      env: { ENABLE_DEV_LOGIN: 'true', NEXT_DIST_DIR: '.next-e2e', NEXT_TELEMETRY_DISABLED: '1' },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
    },
    {
      command: 'npm run start --workspace=apps/web -- --port 3001',
      url: `${WEB_PROD_URL}/api/health`,
      env: { ENABLE_DEV_LOGIN: 'true', NEXT_TELEMETRY_DISABLED: '1' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
    },
  ],
});
