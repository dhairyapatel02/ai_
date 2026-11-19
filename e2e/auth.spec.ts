import { expect, test } from '@playwright/test';

import { API_URL, hideDevOverlay, setOnboarding, signIn, WEB_PROD_URL } from './helpers';

test.describe.configure({ timeout: 120_000 });

test.describe('authentication', () => {
  test('signed-out visitors are sent to the designed sign-in page', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fdashboard/);
    await expect(page.getByRole('heading', { name: 'Sign in to DevImpact' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByText('Development only')).toBeVisible();
  });

  test('shows the account_not_linked error (SEC-16) and the session-ended notice', async ({
    page,
  }) => {
    await page.goto('/sign-in?error=account_not_linked&provider=google');
    await expect(
      page.getByRole('alert').filter({ hasText: 'couldn’t be linked to your account' }),
    ).toBeVisible();
    await page.goto('/sign-in?reason=session_expired');
    await expect(page.getByText('Your session ended. Sign in to continue.')).toBeVisible();
  });

  test('the API rejects requests without a token', async ({ request }) => {
    const res = await request.get(`${API_URL}/me`);
    expect(res.status()).toBe(401);
    expect((await res.json()) as unknown).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  test('dev login returns 404 in a production build even with ENABLE_DEV_LOGIN=true', async ({
    request,
  }) => {
    const res = await request.post(`${WEB_PROD_URL}/api/dev-login`, { data: {} });
    expect(res.status()).toBe(404);
    const signInPage = await request.get(`${WEB_PROD_URL}/sign-in`);
    expect(await signInPage.text()).not.toContain('Development only');
  });
});

test.describe('dashboard in the shell (dev login as the seeded demo user)', () => {
  test('sign in from /sign-in and see stat cards with seeded data', async ({ page }) => {
    await page.goto('/sign-in?callbackUrl=/dashboard');
    await page.getByRole('button', { name: 'Sign in as demo@devimpact.dev' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
    // The dashboard's first-paint queries are prefetched on the server (P10), so the numbers
    // arrive in the HTML rather than through a browser request.

    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    const commits = page.getByTestId('stat-commits');
    await expect(commits).toHaveText(/^\d[\d,]*$/);
    expect(Number((await commits.innerText()).replace(/,/g, ''))).toBeGreaterThan(0);
    for (const label of ['Commits', 'PRs merged', 'PRs reviewed']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByTestId('stat-prs_merged')).toHaveText(/^\d+$/);
    await expect(page.getByRole('heading', { name: 'Impact score' })).toBeVisible();
    await expect(page.getByText('Delivery').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('API calls carry a Bearer JWT, never x-user-id; sign-out ends the session', async ({
    page,
  }) => {
    await signIn(page);
    await setOnboarding(page, true);
    const apiRequest = page.waitForRequest(
      (r) => r.url().startsWith(API_URL) && r.method() === 'GET',
    );
    // KPIs fetch on the client (the dashboard prefetches on the server).
    await page.goto('/kpis');
    const sent = await apiRequest;
    const headers = await sent.allHeaders();
    expect(headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(headers['x-user-id']).toBeUndefined();
    await hideDevOverlay(page);

    await page.getByRole('button', { name: /Dana Demo/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
