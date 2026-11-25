import { mkdirSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { hideDevOverlay, signIn, waitForHydration } from './helpers';

/**
 * Phase 13 screenshots (Settings → Integrations with GitLab / Jira / Linear cards, Jira settings,
 * GitLab commit emails, the Jira disconnect dialog, Activity issues + issue drawer, the GitLab
 * provider filter, KPIs Issues section + By source, career issues) × light/dark × desktop/mobile at
 * 2× DPR into docs/v2/screenshots/p13/. Opt-in on a fresh seed:
 * `SCREENSHOTS=1 npm run test:e2e -- e2e/screenshots-p13.spec.ts`, then quantize (PROGRESS P11).
 */
test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to regenerate docs/v2/screenshots/p13');
test.describe.configure({ mode: 'serial', timeout: 300_000 });

const OUT = 'docs/v2/screenshots/p13';
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

test.use({ deviceScaleFactor: 2 });

async function each(
  page: Page,
  name: string,
  run: (vp: keyof typeof VIEWPORTS) => Promise<void>,
  fullPage = true,
) {
  for (const [vpName, viewport] of Object.entries(VIEWPORTS) as [
    keyof typeof VIEWPORTS,
    { width: number; height: number },
  ][]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await run(vpName);
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${OUT}/${name}-${vpName}-${scheme}.png`,
        fullPage: fullPage && vpName === 'desktop',
      });
    }
  }
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await hideDevOverlay(page);
  await waitForHydration(page);
}

test.beforeEach(async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await signIn(page);
});

test('integrations: GitLab, Jira, Linear cards and the disconnect dialog', async ({ page }) => {
  await each(page, 'integrations', async () => {
    await open(page, '/settings/integrations');
    await expect(page.getByTestId('linear-card')).toBeVisible();
    await expect(page.getByTestId('linked-emails')).toBeVisible();
  });
  await each(
    page,
    'integrations-jira',
    async () => {
      await open(page, '/settings/integrations');
      await page.getByTestId('jira-card').scrollIntoViewIfNeeded();
    },
    false,
  );
  await each(
    page,
    'integrations-disconnect-jira',
    async () => {
      await open(page, '/settings/integrations');
      await page.getByTestId('jira-card').getByRole('button', { name: 'Disconnect' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
    },
    false,
  );
});

test('activity: issues, issue drawer and the GitLab filter', async ({ page }) => {
  await each(page, 'activity-issues', async () => {
    await open(page, '/activity?type=issue&period=quarter:2026-Q3');
    await expect(page.getByTestId('feed-item').first()).toBeVisible();
  });
  await each(
    page,
    'activity-issue-drawer',
    async () => {
      await open(page, '/activity?type=issue&period=quarter:2026-Q3');
      await page.getByTestId('feed-item').first().click();
      await expect(page.getByTestId('item-drawer')).toBeVisible();
    },
    false,
  );
  await each(page, 'activity-gitlab', async () => {
    await open(page, '/activity?provider=gitlab&period=quarter:2026-Q3');
    await expect(page.getByTestId('feed-item').first()).toBeVisible();
  });
});

test('KPIs issues section + by source, career issues', async ({ page }) => {
  await each(page, 'kpis-issues', async () => {
    await open(page, '/kpis?period=quarter:2026-Q3');
    await page.getByRole('region', { name: 'Issues' }).scrollIntoViewIfNeeded();
  });
  await each(page, 'career-issues', async () => {
    await open(page, '/career');
    await expect(page.getByTestId('issues-completed').first()).toBeVisible();
  });
});
