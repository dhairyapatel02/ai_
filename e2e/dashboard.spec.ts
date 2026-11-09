import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000/api';
const DEMO_EMAIL = 'demo@devimpact.dev';

test.describe('dashboard smoke', () => {
  test.beforeEach(async ({ page, request }) => {
    // Sign in as the seeded demo user via the (dev-only) login, then hand the id to the app the
    // same way AuthProvider stores it.
    const res = await request.post(`${API_URL}/auth/dev-login`, { data: { email: DEMO_EMAIL } });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    await page.addInitScript((userId) => {
      window.localStorage.setItem('devimpact_user_id', userId);
    }, body.data.id);
  });

  test('renders stat cards with seeded data', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const commitsCard = page.locator('div.rounded-lg', { hasText: 'Commits This Month' }).last();
    await expect(commitsCard).toBeVisible();
    const commits = Number(await commitsCard.locator('.text-2xl').innerText());
    expect(commits).toBeGreaterThan(0);

    for (const label of ['PRs Merged', 'Reviews Done']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('No activity data yet')).toHaveCount(0);
    await expect(page.getByText('Impact Score').first()).toBeVisible();
  });
});
