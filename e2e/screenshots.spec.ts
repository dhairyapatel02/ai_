import { expect, test, type Page } from '@playwright/test';

import { hideDevOverlay, setOnboarding, signIn } from './helpers';

/**
 * Phase 09 screenshots (shell, sign-in, onboarding × light/dark × desktop/mobile, 2× DPR) into
 * docs/v2/screenshots/p09/. Opt-in: `SCREENSHOTS=1 npm run test:e2e -- e2e/screenshots.spec.ts`.
 */
test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to regenerate docs/v2/screenshots/p09');
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const OUT = 'docs/v2/screenshots/p09';
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

async function shoot(page: Page, name: string, ready: () => Promise<void>) {
  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.reload();
      await hideDevOverlay(page);
      await ready();
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${OUT}/${name}-${vpName}-${scheme}.png`,
        fullPage: vpName === 'desktop',
      });
    }
  }
}

test.use({ deviceScaleFactor: 2 });

test('sign-in', async ({ page }) => {
  await page.goto('/sign-in');
  await shoot(page, 'sign-in', () =>
    expect(page.getByRole('heading', { name: 'Sign in to DevImpact' })).toBeVisible(),
  );
});

test('shell (dashboard)', async ({ page }) => {
  await signIn(page);
  await setOnboarding(page, true);
  await page.goto('/dashboard');
  await shoot(page, 'shell-dashboard', () => expect(page.getByTestId('stat-commits')).toBeVisible());
});

test('onboarding', async ({ page }) => {
  await signIn(page);
  await setOnboarding(page, false);
  try {
    await page.goto('/onboarding/connect');
    await shoot(page, 'onboarding-1-connect', () =>
      expect(page.getByText(/GitHub connected as/)).toBeVisible(),
    );
    await page.goto('/onboarding/repositories');
    await shoot(page, 'onboarding-2-repositories', () =>
      expect(page.getByTestId('repo-list')).toBeVisible(),
    );
    await page.goto('/onboarding/sync');
    await shoot(page, 'onboarding-3-sync', () =>
      expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible(),
    );
  } finally {
    await setOnboarding(page, true);
  }
});
