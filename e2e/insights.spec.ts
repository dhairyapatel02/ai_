import { expect, test, type Page, type Route } from '@playwright/test';

import { API_URL, expectNoSeriousA11yViolations, hideDevOverlay, signIn } from './helpers';

/**
 * P10 insight journey on the seeded demo user: dashboard → KPI explain drawer → activity filter +
 * item drawer → career year filter + print view → integrations Sync now → progress → completion.
 * The sync is intercepted in the browser (the seeded integration has no GitHub token; no real
 * GitHub call is ever made). Then axe (light, dark, 390 px) and overflow checks on every P10 page.
 */

const P10_PAGES = [
  { path: '/dashboard', ready: (p: Page) => p.getByTestId('stat-commits') },
  { path: '/activity', ready: (p: Page) => p.getByTestId('feed-item').first() },
  { path: '/kpis', ready: (p: Page) => p.getByTestId('metric-prs_merged') },
  { path: '/kpis/impact', ready: (p: Page) => p.getByTestId('impact-overall') },
  { path: '/career', ready: (p: Page) => p.getByTestId('career-timeline') },
  { path: '/settings/integrations', ready: (p: Page) => p.getByTestId('sync-history') },
];

test.describe('insight pages (P10)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('dashboard → KPI drawer → activity → career → integrations sync', async ({ page }) => {
    // Dashboard (seeded): cards, chart, heatmap, feed, next step.
    await page.goto('/dashboard');
    await hideDevOverlay(page);
    await expect(page.getByTestId('stat-commits')).toHaveText(/^\d+$/);
    await expect(page.getByTestId('activity-chart')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Contributions' })).toBeVisible();
    await expect(page.getByTestId('feed-item').first()).toBeVisible();
    await expect(page.getByTestId('next-step')).toBeVisible();

    // KPIs → explain drawer on ?metric= → evidence in Activity.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'KPIs' })
      .click();
    await expect(page.getByTestId('metric-pr_cycle_time_median_hours')).toBeVisible();
    await page.getByRole('button', { name: 'Explain PR cycle time (median)' }).click();
    const drawer = page.getByTestId('explain-drawer');
    await expect(drawer.getByRole('heading', { name: 'PR cycle time (median)' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Formula' })).toBeVisible();
    await expect(page).toHaveURL(/metric=pr_cycle_time_median_hours/);
    await expect(drawer.getByRole('img', { name: /Columns of PR cycle time/ })).toBeVisible();
    await drawer.getByRole('link', { name: 'Open in Activity' }).click();
    await expect(page.getByTestId('evidence-list')).toBeVisible();
    await page.getByRole('button', { name: 'Show all activity' }).click();

    // Activity: type filter in the URL, item drawer, Escape closes it.
    await expect(page.getByTestId('feed-item').first()).toBeVisible();
    await page.getByRole('button', { name: 'Pull requests', exact: true }).click();
    await expect(page).toHaveURL(/type=prs/);
    await expect(page.getByTestId('feed-item').first()).toContainText(/Merged|Opened|Closed/);
    await page.getByTestId('feed-item').first().click();
    const item = page.getByTestId('item-drawer');
    await expect(item.getByRole('link', { name: 'Open on GitHub' })).toBeVisible();
    await expect(page).toHaveURL(/item=pr_/);
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/item=/);

    // Career: year filter + print view.
    await page.goto('/career');
    await expect(page.getByTestId('career-timeline')).toBeVisible();
    const year = page.getByRole('radiogroup', { name: 'Year' }).getByRole('radio').first();
    await year.click();
    await expect(page).toHaveURL(/year=\d{4}/);
    await expect(year).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('link', { name: 'Print view' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: /Career timeline · \d{4}/ }),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

    // Integrations: Sync now → progress → completion (sync intercepted).
    await interceptSync(page);
    await page.goto('/settings/integrations');
    await hideDevOverlay(page);
    await expect(page.getByTestId('sync-status-badge')).toHaveText('Connected');
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(
      page.getByText('Sync started. New activity appears in a minute or two.'),
    ).toBeVisible();
    await expect(page.getByTestId('sync-status-badge')).toHaveText(/Syncing · \d+%/);
    await expect(page.getByTestId('sync-progress')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    await expect(page.getByText('Sync finished — 3 new items.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('sync-status-badge')).toHaveText('Connected');
  });

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
  ]) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`axe 0 serious/critical and no overflow on every P10 page (${viewport.name}, ${scheme})`, async ({
        browser,
      }) => {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: scheme,
        });
        const page = await context.newPage();
        await signIn(page);
        for (const { path, ready } of P10_PAGES) {
          await page.goto(path);
          await hideDevOverlay(page);
          await expect(ready(page)).toBeVisible();
          // Charts are lazy chunks; wait for the network to settle before auditing.
          await page.waitForLoadState('networkidle');
          await expectNoSeriousA11yViolations(page, `${path} ${viewport.name} ${scheme}`);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect([path, overflow]).toEqual([path, 0]);
        }
        // Drawers too: explain and item.
        await page.goto('/kpis?metric=merge_rate');
        await expect(
          page.getByTestId('explain-drawer').getByRole('heading', { name: 'Merge rate' }),
        ).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expectNoSeriousA11yViolations(page, `explain drawer ${viewport.name} ${scheme}`);
        await page.goto('/activity');
        await page.getByTestId('feed-item').first().click();
        await expect(
          page.getByTestId('item-drawer').getByRole('link', { name: 'Open on GitHub' }),
        ).toBeVisible();
        await expectNoSeriousA11yViolations(page, `item drawer ${viewport.name} ${scheme}`);
        await page.goto('/career/print');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoSeriousA11yViolations(page, `career print ${viewport.name} ${scheme}`);
        await context.close();
      });
    }
  }
});

/**
 * Browser-side sync double: `POST /sync` → 202 run; `GET /sync/status` reports running 40% → 80%
 * → idle with a succeeded run (3 new items). Everything else goes to the real API.
 */
async function interceptSync(page: Page) {
  let phase = 0;
  const now = () => new Date().toISOString();
  const run = (status: string, progress: number) => ({
    id: 'cme2esyncrun0000000000001',
    integrationId: 'cme2eintegration000000001',
    trigger: 'manual',
    kind: 'incremental',
    status,
    stage: status === 'succeeded' ? 'done' : 'commits',
    progress,
    counts: { repos: 5, prsAuthored: 1, reviews: 1, commits: 1, created: 3 },
    windowFrom: null,
    windowTo: null,
    resumeAt: null,
    recentWindowCompletedAt: null,
    errorCode: null,
    errorMessage: null,
    errors: [],
    queuedAt: now(),
    startedAt: now(),
    finishedAt: status === 'succeeded' ? now() : null,
  });
  const json = (route: Route, data: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ success: true, data }),
    });
  await page.route(`${API_URL}/sync`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    phase = 1;
    return json(route, { syncRun: run('queued', 0) }, 202);
  });
  await page.route(new RegExp(`${API_URL.replace(/[/.]/g, '\\$&')}/sync/status`), async (route) => {
    if (phase === 0) return route.fallback();
    const real = await route.fetch();
    const body = (await real.json()) as { data: Record<string, unknown> };
    phase += 1;
    if (phase <= 3) {
      return json(route, {
        ...body.data,
        state: 'running',
        currentRun: run('running', phase * 30),
      });
    }
    return json(route, {
      ...body.data,
      state: 'idle',
      currentRun: null,
      lastRun: run('succeeded', 100),
      lastSuccessfulAt: now(),
    });
  });
}
