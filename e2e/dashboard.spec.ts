import { expect, test } from '@playwright/test';

const WEB_PROD_URL = process.env.E2E_WEB_PROD_URL ?? 'http://localhost:3001';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000/api';

test.describe.configure({ timeout: 120_000 });

test.describe('authentication', () => {
  test('signed-out visitors are sent to /sign-in', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fdashboard/);
    await expect(page.getByRole('heading', { name: 'Sign in to DevImpact AI' })).toBeVisible();
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
  });
});

test.describe('dashboard smoke (dev login as the seeded demo user)', () => {
  test('sign in from /sign-in and see stat cards with seeded data', async ({ page }) => {
    await page.goto('/sign-in?callbackUrl=/dashboard');
    // `next dev` compiles routes on first hit, so allow time for the first API round trip.
    const overview = page.waitForResponse((r) => r.url().includes('/metrics/overview'), {
      timeout: 90_000,
    });
    await page.getByRole('button', { name: /Sign in as demo user/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
    expect((await overview).status()).toBe(200);

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Deterministic metrics API (P07): correctly labelled cards, no AI call on page load.
    const commits = page.getByTestId('stat-commits');
    await expect(commits).toBeVisible();
    expect(Number(await commits.innerText())).toBeGreaterThan(0);
    for (const label of ['Commits', 'PRs merged', 'PRs reviewed', 'Impact score']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByTestId('stat-prs_merged')).toHaveText(/^\d+$/);
    await expect(page.getByText('No activity in this period')).toHaveCount(0);
    await expect(page.getByText('Impact Score').first()).toBeVisible();
    await expect(page.getByText('Delivery').first()).toBeVisible();
  });

  test('API calls carry a Bearer JWT, never x-user-id; sign-out ends the session', async ({
    page,
  }) => {
    const res = await page.request.post('/api/dev-login', {
      data: { email: 'demo@devimpact.dev' },
    });
    expect(res.ok()).toBeTruthy();

    const apiRequest = page.waitForRequest(
      (r) => r.url().startsWith(API_URL) && r.method() === 'GET',
    );
    await page.goto('/dashboard');
    const sent = await apiRequest;
    const headers = await sent.allHeaders();
    expect(headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(headers['x-user-id']).toBeUndefined();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
