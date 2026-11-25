import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests against a migrated + seeded database (`npm run db:deploy && npm run db:seed`) and the
 * built API (`npm run build`). Run with `npm run test:e2e` (traces off by default; re-run a
 * failing test with `--trace on` to debug).
 *
 * Servers:
 * - API (`node apps/api/dist/main.js`, :4000) — verifies JWTs via the web app's JWKS.
 * - Web in development mode (:3000) with ENABLE_DEV_LOGIN=true — dev login is impossible in a
 *   production build by design (ADR-0003), so signed-in flows run against `next dev`. Next 16 keeps
 *   dev output in `.next/dev`, so it runs next to the production build without a separate distDir.
 *   Placeholder GitHub/Google client ids only make the sign-in page render its provider buttons;
 *   tests never follow them (no real GitHub/Google calls).
 * - Web production build (`next start`, :3001) with ENABLE_DEV_LOGIN=true — proves the dev login
 *   returns 404 in production.
 * - Fake Anthropic Messages API (`npm run ai:mock`, :4010, P11): the API generates documents
 *   against it, slowed down so the streaming viewer is observable. No real Anthropic call.
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
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run ai:mock --workspace=apps/api -- 4010',
      port: 4010,
      env: { AI_MOCK_CHUNK: '6', AI_MOCK_DELAY_MS: '25' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
    },
    {
      command: 'node apps/api/dist/main.js',
      url: `${API_URL}/health`,
      // The P10 axe loops visit every insight page in four browser contexts (> 300 requests/min);
      // P11 downloads every export format several times. Generation uses the fake Anthropic API.
      env: {
        RATE_LIMIT_DEFAULT_PER_MINUTE: '3000',
        RATE_LIMIT_EXPORT_PER_HOUR: '1000',
        RATE_LIMIT_DATA_EXPORT_PER_DAY: '1000',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:4010',
        ANTHROPIC_API_KEY: 'mock',
        RUN_WORKER_IN_API: 'true',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
    },
    {
      command: 'npm run dev --workspace=apps/web -- --port 3000',
      // Wait for a compiled page, not just the health route: the first tests otherwise hit the
      // sign-in page while Turbopack is still compiling it (aborted navigations on a cold start).
      url: `${WEB_URL}/sign-in`,
      env: {
        ENABLE_DEV_LOGIN: 'true',
        NEXT_TELEMETRY_DISABLED: '1',
        GITHUB_SIGNIN_CLIENT_ID: 'e2e-placeholder',
        GITHUB_SIGNIN_CLIENT_SECRET: 'e2e-placeholder',
        GOOGLE_CLIENT_ID: 'e2e-placeholder',
        GOOGLE_CLIENT_SECRET: 'e2e-placeholder',
      },
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
