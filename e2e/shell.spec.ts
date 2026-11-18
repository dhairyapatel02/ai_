import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations, hideDevOverlay, setOnboarding, signIn } from './helpers';

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await setOnboarding(page, true);
});

test.describe('app shell', () => {
  test('desktop: grouped sidebar, top bar, skip link, axe clean in light and dark', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    await hideDevOverlay(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    for (const group of ['Overview', 'Create', 'Settings']) {
      await expect(nav.getByRole('group', { name: group })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByTestId('period-picker')).toBeVisible();
    await expect(page.getByTestId('stat-commits')).toBeVisible();

    // Keyboard: the skip link is the first focusable element and moves focus to <main>.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);

    await expectNoSeriousA11yViolations(page, 'dashboard light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await hideDevOverlay(page);
    await expect(page.getByTestId('stat-commits')).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'dashboard dark');
  });

  test('sign-in page is axe clean', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/sign-in');
    await hideDevOverlay(page);
    await expect(page.getByRole('heading', { name: 'Sign in to DevImpact' })).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'sign-in');
    await context.close();
  });

  test('tablet (768): sidebar hidden, menu button opens the navigation drawer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/dashboard');
    await hideDevOverlay(page);
    await expect(page.getByTestId('stat-commits')).toBeVisible(); // hydrated
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('link', { name: 'Career' }).click();
    await expect(page).toHaveURL(/\/career$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Career' })).toBeVisible();
  });

  test('mobile (390): bottom bar + More drawer, no horizontal overflow, axe clean', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await hideDevOverlay(page);
    await expect(page.getByTestId('stat-commits')).toBeVisible(); // hydrated
    const bottom = page.getByRole('navigation', { name: 'Primary' });
    await expect(bottom).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await expect(bottom.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expectNoSeriousA11yViolations(page, 'dashboard mobile');

    await bottom.getByRole('link', { name: 'KPIs' }).click();
    await expect(page).toHaveURL(/\/kpis/);
    await expect(page.getByRole('heading', { level: 1, name: 'KPIs' })).toBeVisible();

    await bottom.getByRole('button', { name: 'More navigation' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await drawer.getByRole('link', { name: 'Integrations', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/integrations$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();
  });

  test('theme toggle persists across reloads without a flash', async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        (window as unknown as { themeAtDcl: string }).themeAtDcl =
          document.documentElement.className;
      });
    });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/dashboard');
    await expect(page.getByTestId('stat-commits')).toBeVisible(); // hydrated
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toHaveAttribute('data-theme-choice', 'system');
    await toggle.click(); // light
    await toggle.click(); // dark
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    // The class is set before the page is parsed (next-themes inline script) → no flash.
    expect(
      await page.evaluate(() => (window as unknown as { themeAtDcl: string }).themeAtDcl),
    ).toMatch(/\bdark\b/);
    await expect(page.getByTestId('theme-toggle')).toHaveAttribute('data-theme-choice', 'dark');
    await page.getByTestId('theme-toggle').click(); // back to system
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  });

  test('⌘K palette navigates with the keyboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('stat-commits')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command menu' });
    await expect(palette).toBeVisible();
    await page.keyboard.type('Career');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/career$/);
    await expect(palette).toBeHidden();
  });

  test('period picker keeps the period in the URL and carries it between Overview pages', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('stat-commits')).toBeVisible(); // hydrated
    await page.getByTestId('period-picker').click();
    await page.getByRole('button', { name: /^Last month/ }).click();
    await expect(page).toHaveURL(/\?period=month%3A\d{4}-\d{2}|\?period=month:\d{4}-\d{2}/);
    await expect(page.getByTestId('period-picker')).not.toContainText('In progress');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'KPIs' })
      .click();
    await expect(page).toHaveURL(/\/kpis\?period=month/);
  });

  test('invalid ?period shows the designed error state', async ({ page }) => {
    await page.goto('/dashboard?period=custom:2026-01-01..2026-01-02');
    await expect(page.getByRole('heading', { name: "That period isn't valid" })).toBeVisible();
    await page.getByRole('button', { name: 'Show the default period' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('unknown routes show the designed 404 inside the shell', async ({ page }) => {
    await page.goto('/this-page-does-not-exist');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to dashboard' })).toBeVisible();
  });

  test('transitional v0.1 routes redirect to the IA routes', async ({ page }) => {
    await page.goto('/connect');
    await expect(page).toHaveURL(/\/settings\/integrations$/);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings\/profile$/);
  });
});
