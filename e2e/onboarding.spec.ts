import { expect, test, type Page, type Route } from '@playwright/test';

import {
  api,
  API_URL,
  expectNoSeriousA11yViolations,
  hideDevOverlay,
  setOnboarding,
  signIn,
} from './helpers';

/**
 * Onboarding (FLOWS F2, SCREENS S2–S5) against the real API with the seeded GitHub integration.
 * The GitHub App round trip is intercepted in the browser (never reaches github.com).
 */
test.describe.configure({ mode: 'serial', timeout: 150_000 });

const INTEGRATION_ID = 'cme2eintegration00000000001';
const integration = {
  id: INTEGRATION_ID,
  provider: 'github',
  status: 'active',
  statusReason: null,
  externalLogin: 'dana-demo',
  displayName: null,
  avatarUrl: null,
  installations: [],
  manageUrl: 'https://github.com/settings/installations',
  lastSyncedAt: null,
  lastSuccessfulSyncAt: null,
  nextScheduledSyncAt: null,
  backfillFrom: null,
  createdAt: '2026-11-18T09:00:00.000Z',
};
const syncRun = {
  id: 'cme2esyncrun000000000000001',
  integrationId: INTEGRATION_ID,
  trigger: 'initial',
  kind: 'backfill',
  status: 'queued',
  stage: 'prepare',
  progress: 0,
  counts: {},
  windowFrom: null,
  windowTo: null,
  resumeAt: null,
  recentWindowCompletedAt: null,
  errorCode: null,
  errorMessage: null,
  errors: [],
  queuedAt: '2026-11-18T09:00:00.000Z',
  startedAt: null,
  finishedAt: null,
};

const envelope = (data: unknown) => JSON.stringify({ success: true, data });

/** Pretends the user has no GitHub integration yet (only in the browser). */
async function withoutIntegrations(page: Page) {
  await page.route(`${API_URL}/me`, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as { data: { integrations: unknown[] } };
    body.data.integrations = [];
    await route.fulfill({ response, json: body });
  });
}

/** GitHub App install → callback, intercepted: `connect` returns our own callback URL. */
async function mockConnect(page: Page, callback: { status: number; body: string }) {
  await page.route(`${API_URL}/integrations/github/connect`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: envelope({
        url: 'http://localhost:3000/integrations/github/callback?code=e2e-code&state=e2e-state&installation_id=42&setup_action=install',
        mode: 'install',
        expiresAt: '2026-11-18T09:10:00.000Z',
      }),
    }),
  );
  await page.route(`${API_URL}/integrations/github/callback`, (route) =>
    route.fulfill({ status: callback.status, contentType: 'application/json', body: callback.body }),
  );
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await setOnboarding(page, false);
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await setOnboarding(page, true);
  await page.close();
});

test('first visit goes to onboarding and completes end-to-end to the dashboard', async ({
  page,
}) => {
  await page.goto('/');
  // The seeded user already has GitHub connected → resume at step 2.
  await expect(page).toHaveURL(/\/onboarding\/repositories$/, { timeout: 60_000 });
  await page.goto('/onboarding/connect');
  await hideDevOverlay(page);
  await expect(page.getByRole('heading', { name: 'Connect your GitHub data' })).toBeVisible();
  await expect(page.getByText('GitHub connected as @dana-demo')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Step 1' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expectNoSeriousA11yViolations(page, 'onboarding/connect');
  await page.getByRole('link', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Review repositories' })).toBeVisible();
  const list = page.getByTestId('repo-list');
  await expect(list.getByRole('switch').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /\d+ of \d+ selected/ })).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'onboarding/repositories');
  const patch = page.waitForRequest(
    (r) => r.url().endsWith('/me/settings') && r.method() === 'PATCH' && /"sync"/.test(r.postData() ?? ''),
  );
  await page.getByRole('button', { name: 'Start import' }).click();
  await patch;

  await expect(page).toHaveURL(/\/onboarding\/sync$/);
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Import progress' })).toHaveAttribute(
    'aria-valuenow',
    '100',
  );
  await expect(page.getByText('Your dashboard is up to date')).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'onboarding/sync');
  await page.getByRole('button', { name: 'Go to dashboard' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  const me = (await (await api(page, 'GET', '/me')).json()) as {
    data: { onboarding: { completed: boolean } };
  };
  expect(me.data.onboarding.completed).toBe(true);
});

test('resumes at the saved step', async ({ page }) => {
  await api(page, 'PATCH', '/me/settings', { onboardingStep: 'sync' });
  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/onboarding\/sync$/, { timeout: 60_000 });
});

test('installing the GitHub App (intercepted) returns to the repositories step', async ({
  page,
}) => {
  await withoutIntegrations(page);
  await mockConnect(page, {
    status: 201,
    body: envelope({ integration, syncRun, returnTo: '/onboarding' }),
  });
  await page.goto('/onboarding/connect');
  await expect(page.getByText(/^Signed in as/)).toBeVisible(); // hydrated, /me loaded
  await page.getByRole('button', { name: 'Install GitHub App' }).click();
  await expect(page).toHaveURL(/\/onboarding\/repositories$/, { timeout: 60_000 });
  await expect(page.getByText('GitHub connected')).toBeVisible();
});

test('organization approval pending', async ({ page }) => {
  await withoutIntegrations(page);
  await mockConnect(page, {
    status: 200,
    body: envelope({ integration: null, pendingApproval: true, returnTo: '/onboarding' }),
  });
  await page.goto('/onboarding/connect');
  await expect(page.getByText(/^Signed in as/)).toBeVisible(); // hydrated, /me loaded
  await page.getByRole('button', { name: 'Install GitHub App' }).click();
  await expect(page).toHaveURL(/\/onboarding\/pending$/, { timeout: 60_000 });
  await hideDevOverlay(page);
  await expect(
    page.getByRole('heading', { name: 'Waiting for your organization to approve DevImpact' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy message' })).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'onboarding/pending');
});

test('cancelled on GitHub shows the designed error', async ({ page }) => {
  await withoutIntegrations(page);
  await mockConnect(page, {
    status: 400,
    body: JSON.stringify({
      success: false,
      error: { code: 'OAUTH_DENIED', message: 'denied', requestId: 'req-e2e' },
    }),
  });
  await page.goto('/onboarding/connect');
  await expect(page.getByText(/^Signed in as/)).toBeVisible(); // hydrated, /me loaded
  await page.getByRole('button', { name: 'Install GitHub App' }).click();
  await expect(page).toHaveURL(/\/onboarding\/connect\?error=denied$/, { timeout: 60_000 });
  await expect(
    page.getByRole('alert').filter({ hasText: 'GitHub authorization was cancelled' }),
  ).toBeVisible();
});
