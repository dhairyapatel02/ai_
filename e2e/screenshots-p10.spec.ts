import { expect, test, type Page } from '@playwright/test';

import { hideDevOverlay, signIn } from './helpers';

/**
 * Phase 10 screenshots (dashboard, activity + drawer, KPIs + explain drawer, impact, career,
 * integrations × light/dark × desktop/mobile, 2× DPR) into docs/v2/screenshots/p10/.
 * Opt-in: `SCREENSHOTS=1 npm run test:e2e -- e2e/screenshots-p10.spec.ts`.
 */
test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to regenerate docs/v2/screenshots/p10');
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const OUT = 'docs/v2/screenshots/p10';
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

async function shoot(
  page: Page,
  name: string,
  path: string,
  ready: () => Promise<void>,
  fullPage = true,
) {
  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto(path);
      await hideDevOverlay(page);
      await ready();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `${OUT}/${name}-${vpName}-${scheme}.png`,
        fullPage: fullPage && vpName === 'desktop',
      });
    }
  }
}

test.use({ deviceScaleFactor: 2 });

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('dashboard', async ({ page }) => {
  await shoot(page, 'dashboard', '/dashboard', async () => {
    await expect(page.getByTestId('activity-chart')).toBeVisible();
    await expect(page.getByTestId('next-step')).toBeVisible();
  });
});

test('activity + item drawer', async ({ page }) => {
  await shoot(page, 'activity', '/activity', async () => {
    await expect(page.getByTestId('feed-item').first()).toBeVisible();
  });
  await shoot(
    page,
    'activity-drawer',
    '/activity?type=prs',
    async () => {
      await page.getByTestId('feed-item').filter({ hasText: 'Merged' }).first().click();
      await expect(
        page.getByTestId('item-drawer').getByRole('link', { name: 'Open on GitHub' }),
      ).toBeVisible();
    },
    false,
  );
});

test('kpis + explain drawer', async ({ page }) => {
  await shoot(page, 'kpis', '/kpis', async () => {
    await expect(page.getByTestId('metric-prs_merged')).toBeVisible();
  });
  await shoot(
    page,
    'kpis-explain',
    '/kpis?metric=pr_cycle_time_median_hours',
    async () => {
      await expect(page.getByTestId('explain-drawer').getByRole('img')).toBeVisible();
    },
    false,
  );
});

test('impact', async ({ page }) => {
  await shoot(page, 'impact', '/kpis/impact', async () => {
    await expect(page.getByTestId('impact-history-chart')).toBeVisible();
  });
});

test('career', async ({ page }) => {
  await shoot(page, 'career', '/career', async () => {
    await expect(page.getByTestId('career-timeline')).toBeVisible();
  });
});

test('integrations', async ({ page }) => {
  await shoot(page, 'integrations', '/settings/integrations', async () => {
    await expect(page.getByTestId('sync-history')).toBeVisible();
  });
});
