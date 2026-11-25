import { expect, test, type Page } from '@playwright/test';

import {
  api,
  expectNoSeriousA11yViolations,
  hideDevOverlay,
  signIn,
  waitForHydration,
} from './helpers';

/**
 * P13 journeys on the seeded demo user against the fake GitLab / Jira / Linear servers
 * (`npm run providers:mock`, playwright.config): reconnect Linear (needs reconnection), disconnect +
 * reconnect Jira, disconnect GitLab + connect a new GitLab account — each through the provider's
 * authorize page, intercepted in the browser — then issues and MRs appear in Activity, the Issues
 * KPI section, and a generated appraisal (fake Anthropic) cites a JIRA-/LIN- ref. Plus axe 0
 * serious/critical and 0 px overflow on every changed page (1440 / 390 px, light / dark).
 */

const AUTHORIZE: Record<'gitlab' | 'jira' | 'linear', string> = {
  gitlab: 'http://127.0.0.1:4021/oauth/authorize**',
  jira: 'http://127.0.0.1:4022/authorize**',
  linear: 'http://127.0.0.1:4024/oauth/authorize**',
};
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3000';

async function open(page: Page, path: string) {
  await page.goto(path);
  await hideDevOverlay(page);
  await waitForHydration(page);
}

/** The provider's consent page "approves" at once: redirect to our callback with code + state. */
async function interceptAuthorize(page: Page, provider: keyof typeof AUTHORIZE) {
  await page.route(AUTHORIZE[provider], async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('redirect_uri')).toBe(`${WEB}/integrations/${provider}/callback`);
    if (provider !== 'jira') expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const state = url.searchParams.get('state') ?? '';
    await route.fulfill({
      status: 302,
      headers: {
        location: `${WEB}/integrations/${provider}/callback?code=e2e-${provider}&state=${encodeURIComponent(state)}`,
      },
    });
  });
}

async function integrationId(page: Page, provider: string): Promise<string> {
  const res = await api(page, 'GET', '/integrations');
  const rows = ((await res.json()) as { data: { id: string; provider: string; status: string }[] })
    .data;
  const row = rows.find((r) => r.provider === provider && r.status !== 'disconnected');
  if (!row) throw new Error(`no active ${provider} integration`);
  return row.id;
}

async function waitForSync(page: Page, provider: string) {
  const id = await integrationId(page, provider);
  await expect
    .poll(
      async () => {
        const res = await api(page, 'GET', `/sync/status?integrationId=${id}`);
        const body = (await res.json()) as {
          data: { state: string; lastRun: { status: string } | null };
        };
        return `${body.data.state}/${body.data.lastRun?.status ?? 'none'}`;
      },
      { timeout: 60_000 },
    )
    .toMatch(/^idle\/(succeeded|partial)$/);
}

async function disconnectKeepingData(page: Page, provider: string, label: string) {
  const card = page.getByTestId(`${provider}-card`);
  await card.getByRole('button', { name: 'Disconnect' }).click();
  const dialog = page.getByRole('alertdialog', { name: `Disconnect ${label}?` });
  await dialog.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByTestId(`${provider}-connect`)).toBeVisible();
}

test.describe('additional integrations (P13)', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('connect GitLab, Jira and Linear (intercepted OAuth) → issues + MRs in Activity and KPIs → cited in an appraisal', async ({
    page,
  }) => {
    await signIn(page);
    await open(page, '/settings/integrations');
    await expect(page.getByTestId('linear-card')).toContainText('Needs reconnection');

    // Linear: needs reconnection → Reconnect (same account) → active again.
    await interceptAuthorize(page, 'linear');
    await page.getByTestId('linear-card').getByRole('button', { name: 'Reconnect Linear' }).click();
    await page.waitForURL(/\/integrations\/linear\/callback/);
    await page.waitForURL(/\/settings\/integrations$/, { timeout: 30_000 });
    await waitForHydration(page);
    await waitForSync(page, 'linear');

    // Jira: disconnect (keep data) → Connect → the same Atlassian account is linked again.
    await open(page, '/settings/integrations');
    await disconnectKeepingData(page, 'jira', 'Jira');
    await interceptAuthorize(page, 'jira');
    await page.getByTestId('jira-connect').getByRole('button', { name: 'Connect Jira' }).click();
    await page.waitForURL(/\/integrations\/jira\/callback/);
    await page.waitForURL(/\/settings\/integrations$/, { timeout: 30_000 });
    await waitForSync(page, 'jira');

    // GitLab: disconnect → connect another GitLab account (a new connection).
    await open(page, '/settings/integrations');
    await disconnectKeepingData(page, 'gitlab', 'GitLab');
    await interceptAuthorize(page, 'gitlab');
    await page
      .getByTestId('gitlab-connect')
      .getByRole('button', { name: 'Connect GitLab' })
      .click();
    await page.waitForURL(/\/integrations\/gitlab\/callback/);
    await page.waitForURL(/\/settings\/integrations$/, { timeout: 30_000 });
    await waitForSync(page, 'gitlab');

    await open(page, '/settings/integrations');
    for (const provider of ['gitlab', 'jira', 'linear']) {
      await expect(page.getByTestId(`${provider}-card`)).toBeVisible();
    }
    await expect(page.getByTestId('linear-card')).not.toContainText('Needs reconnection');

    // Activity: completed issues from both trackers; GitLab MRs under the provider filter.
    await open(page, '/activity?type=issue');
    await expect(page.getByText('E2E Jira PAY-901').first()).toBeVisible();
    await expect(page.getByText('E2E Linear ENG-901').first()).toBeVisible();
    await page.getByText('E2E Jira PAY-901').first().click();
    const drawer = page.getByTestId('item-drawer');
    await expect(drawer.getByText('JIRA-PAY-901')).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Open on Jira' })).toBeVisible();
    await page.keyboard.press('Escape');
    await open(page, '/activity?provider=gitlab');
    await expect(page.getByText('Add idempotency keys to invoices').first()).toBeVisible();

    // KPIs: the Issues section has data (no connect prompt).
    await open(page, '/kpis');
    const issues = page.getByRole('region', { name: 'Issues' });
    await expect(issues.getByText('Issues completed')).toBeVisible();
    await expect(page.getByTestId('issues-not-connected')).toHaveCount(0);
    await expect(page.getByTestId('by-source')).toBeVisible();

    // Appraisal for this month (fake Anthropic): an issue is cited with a working chip.
    const month = new Date().toISOString().slice(0, 7);
    await open(page, `/documents/new/appraisal?period=month:${month}`);
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page).toHaveURL(/\/documents\/c[a-z0-9]+$/);
    await expect(page.getByTestId('coverage-badge')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('streaming-status')).toHaveCount(0);
    const chip = page.getByRole('button', { name: /^Evidence (JIRA|LIN)-/ }).first();
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.getByRole('dialog', { name: 'Evidence' })).toContainText(/Issue/);
  });
});

const PAGES: { name: string; path: string; ready: (p: Page) => ReturnType<Page['getByTestId']> }[] =
  [
    {
      name: 'integrations',
      path: '/settings/integrations',
      ready: (p) => p.getByTestId('jira-card'),
    },
    {
      name: 'activity issues',
      path: '/activity?type=issue',
      ready: (p) => p.getByRole('button', { name: 'Issues' }),
    },
    { name: 'kpis', path: '/kpis', ready: (p) => p.getByRole('region', { name: 'Issues' }) },
    { name: 'career', path: '/career', ready: (p) => p.getByTestId('career-timeline') },
  ];

test.describe('P13 accessibility', () => {
  test.describe.configure({ timeout: 180_000 });
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
  ]) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`axe 0 serious/critical and no overflow on every P13 page (${viewport.name}, ${scheme})`, async ({
        page,
      }) => {
        await signIn(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        const check = async (label: string) => {
          await expectNoSeriousA11yViolations(page, `${label} ${viewport.name} ${scheme}`);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect([label, overflow]).toEqual([label, 0]);
        };
        for (const p of PAGES) {
          await page.goto(p.path);
          await hideDevOverlay(page);
          await expect(p.ready(page)).toBeVisible();
          await page.waitForLoadState('networkidle');
          await check(p.name);
        }
        // Issue drawer and the Jira disconnect dialog.
        await open(page, '/activity?type=issue');
        await page.getByTestId('feed-item').first().click();
        await expect(page.getByTestId('item-drawer')).toBeVisible();
        await check('issue drawer');
        await open(page, '/settings/integrations');
        await page.getByTestId('jira-card').getByRole('button', { name: 'Disconnect' }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await check('disconnect dialog');
      });
    }
  }
});
