import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import {
  api,
  expectNoSeriousA11yViolations,
  hideDevOverlay,
  signIn,
  waitForHydration,
} from './helpers';

/**
 * P12 career OS journeys on the seeded demo user (fake Anthropic API from playwright.config):
 * add an achievement → activity feed → career timeline → cited as ACH-… in a generated appraisal
 * with a working citation popover; goal with a metric target; notification toggles persist; data
 * export downloads JSON; account deletion on the disposable delete-me user; unsubscribe link
 * signed out; axe + 390 px overflow on every P12 page in light and dark.
 */

const THROWAWAY = 'delete-me@devimpact.dev';
const unique = () => `e2e-${Date.now().toString(36)}`;
const today = () => new Date().toISOString().slice(0, 10);

/** Same token format as apps/api/src/email/unsubscribe-token.ts (dev secret from .env). */
function unsubscribeToken(userId: string): string {
  const env = (() => {
    try {
      return readFileSync('.env', 'utf8');
    } catch {
      return '';
    }
  })();
  const secret =
    process.env.UNSUBSCRIBE_TOKEN_SECRET ??
    /^UNSUBSCRIBE_TOKEN_SECRET=(.+)$/m.exec(env)?.[1]?.trim() ??
    'dev-only-unsubscribe-secret-change-me-0123456789';
  const payload = Buffer.from(
    JSON.stringify({ u: userId, l: 'digest', e: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(`unsub.v1.${payload}`).digest('base64url')}`;
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await hideDevOverlay(page);
  await waitForHydration(page);
}

test.describe('career OS (P12)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('achievement → feed → career → cited as ACH-… in a generated appraisal', async ({
    page,
  }) => {
    await signIn(page);
    const title = `Mentored the on-call rotation ${unique()}`;
    await open(page, '/achievements');
    await page.getByRole('button', { name: 'Add achievement' }).first().click();
    const dialog = page.getByTestId('achievement-dialog');
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('Date').fill(today());
    await dialog.getByLabel(/Impact/).fill('Two engineers now handle alerts alone.');
    await dialog.getByRole('button', { name: 'Save achievement' }).click();
    await expect(dialog).toHaveCount(0);
    const row = page.getByTestId('achievement-row').filter({ hasText: title });
    await expect(row).toBeVisible();

    // Activity feed (Achievements chip) and the drawer.
    await open(page, '/activity');
    await page.getByRole('button', { name: 'Achievements', exact: true }).click();
    await page.getByRole('button', { name: title }).first().click();
    await expect(page.getByTestId('achievement-drawer')).toBeVisible();
    await page.keyboard.press('Escape');

    // Career timeline: "Beyond code".
    await open(page, '/career');
    await expect(page.getByTestId('beyond-code').filter({ hasText: title })).toBeVisible();

    // Appraisal for this month cites the achievement (fake model cites ACH refs when present).
    const month = today().slice(0, 7);
    await open(page, `/documents/new/appraisal?period=month:${month}`);
    await expect(page.getByTestId('evidence-preview')).toContainText('Achievements');
    await page.getByLabel(/Self-reflection notes/).fill(`Reflection ${unique()}`);
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page).toHaveURL(/\/documents\/c[a-z0-9]+$/);
    await expect(page.getByTestId('coverage-badge')).toBeVisible({ timeout: 60_000 });
    const chip = page
      .getByTestId('document-body')
      .getByRole('button', { name: /^Evidence ACH-/ })
      .first();
    await expect(chip).toBeVisible();
    await chip.click();
    const popover = page.getByRole('dialog', { name: 'Evidence' });
    await expect(popover).toContainText('Achievement');
    await popover.getByRole('link', { name: 'Details' }).click();
    await expect(page).toHaveURL(/\/achievements\?item=achievement/);
    await expect(page.getByTestId('achievement-drawer')).toBeVisible();

    // Clean up: delete the achievement (Undo toast window, then the request).
    await page.keyboard.press('Escape');
    await row.getByRole('button', { name: /^Options for/ }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(row).toHaveCount(0);
  });

  test('goal with a metric target shows engine progress', async ({ page }) => {
    await signIn(page);
    const title = `Merge often ${unique()}`;
    await open(page, '/goals');
    await expect(page.getByText(/Progress is measured on/)).toBeVisible();
    await page.getByRole('button', { name: 'Add goal' }).click();
    const dialog = page.getByTestId('goal-dialog');
    await dialog.getByLabel('Goal').fill(title);
    await dialog.getByLabel(/Measure with a metric/).click();
    await page.getByRole('option', { name: 'PRs merged', exact: true }).click();
    await dialog.getByLabel(/^Target$/).click();
    await page.getByRole('option', { name: 'At least' }).click();
    await dialog.getByLabel(/^Value/).fill('1');
    await dialog.getByRole('button', { name: 'Add goal' }).click();
    const card = page.getByTestId('goal-card').filter({ hasText: title });
    await expect(card).toBeVisible();
    await expect(card).toContainText('PRs merged ≥ 1');
    await expect(card.getByText(/On target|Not yet|Not enough data/)).toBeVisible();
    // Clean up.
    await card.getByRole('button', { name: /^Options for/ }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete goal' }).click();
    await expect(card).toHaveCount(0);
  });

  test('notification toggles persist; data export downloads JSON', async ({ page }) => {
    await signIn(page);
    await open(page, '/settings/notifications');
    const doc = page.getByRole('switch', { name: 'Document ready' });
    const before = await doc.getAttribute('aria-checked');
    await doc.click();
    await expect(doc).not.toHaveAttribute('aria-checked', before ?? '');
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByRole('switch', { name: 'Document ready' })).not.toHaveAttribute(
      'aria-checked',
      before ?? '',
    );
    await page.getByRole('switch', { name: 'Document ready' }).click();
    await expect(page.getByRole('switch', { name: 'Document ready' })).toHaveAttribute(
      'aria-checked',
      before ?? '',
    );

    await open(page, '/settings/privacy');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export data' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^devimpact-export-\d{4}-\d{2}-\d{2}\.json$/);
    const body = JSON.parse(readFileSync(await download.path(), 'utf8')) as Record<string, unknown>;
    expect(body).toMatchObject({ schemaVersion: 1, user: { email: 'demo@devimpact.dev' } });
    expect(Array.isArray(body.achievements)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('accessTokenEnc');
  });

  test('unsubscribe link works signed out', async ({ page, browser }) => {
    await signIn(page);
    const me = (await (await api(page, 'GET', '/me')).json()) as { data: { user: { id: string } } };
    await api(page, 'PATCH', '/me/settings', { digestEnabled: true });
    const anon = await browser.newContext();
    const visitor = await anon.newPage();
    await visitor.goto(
      `/unsubscribe?token=${encodeURIComponent(unsubscribeToken(me.data.user.id))}`,
    );
    await expect(
      visitor.getByRole('heading', { name: "You're unsubscribed from the weekly digest." }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(visitor, 'unsubscribe');
    await visitor.goto('/unsubscribe?token=bad.token');
    await expect(
      visitor.getByRole('heading', { name: 'This unsubscribe link is invalid' }),
    ).toBeVisible();
    await anon.close();
    const after = (await (await api(page, 'GET', '/me')).json()) as {
      data: { settings: { digestEnabled: boolean } };
    };
    expect(after.data.settings.digestEnabled).toBe(false);
    await api(page, 'PATCH', '/me/settings', { digestEnabled: true });
  });

  test('delete account (disposable user, typed confirmation) → signed out', async ({ page }) => {
    execFileSync('npx', ['tsx', 'apps/api/prisma/scripts/create-throwaway-user.ts'], {
      stdio: 'pipe',
    });
    const res = await page.request.post('/api/dev-login', { data: { email: THROWAWAY } });
    expect(res.ok(), await res.text()).toBeTruthy();
    await open(page, '/settings/privacy');
    await page.getByRole('button', { name: 'Delete account…' }).click();
    const dialog = page.getByRole('alertdialog');
    const confirm = dialog.getByRole('button', { name: 'Delete account' });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox').fill(THROWAWAY);
    await confirm.click();
    await expect(page).toHaveURL(/\/sign-in\?reason=account_deleted/);
    await expect(page.getByText('Account deleted')).toBeVisible();
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

const P12_PAGES: {
  name: string;
  path: string;
  ready: (page: Page) => ReturnType<Page['getByTestId']>;
}[] = [
  { name: 'achievements', path: '/achievements', ready: (p) => p.getByTestId('achievement-list') },
  { name: 'goals', path: '/goals', ready: (p) => p.getByTestId('goal-list') },
  { name: 'profile', path: '/settings/profile', ready: (p) => p.getByTestId('session-list') },
  {
    name: 'notifications',
    path: '/settings/notifications',
    ready: (p) => p.getByTestId('toggle-digest'),
  },
  { name: 'privacy', path: '/settings/privacy', ready: (p) => p.getByTestId('toggle-redact') },
  {
    name: 'plan',
    path: '/settings/plan',
    ready: (p) => p.getByRole('table', { name: 'Free and Pro plan limits' }),
  },
];

test.describe('career OS accessibility (P12)', () => {
  test.describe.configure({ timeout: 240_000 });
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
  ]) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`axe 0 serious/critical and no overflow on every P12 page (${viewport.name}, ${scheme})`, async ({
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
        for (const p of P12_PAGES) {
          await page.goto(p.path);
          await hideDevOverlay(page);
          await expect(p.ready(page)).toBeVisible();
          await page.waitForLoadState('networkidle');
          await check(p.name);
        }
        // Dialogs: add achievement, add goal, delete account.
        await open(page, '/achievements');
        await page.getByRole('button', { name: 'Add achievement' }).first().click();
        await expect(page.getByTestId('achievement-dialog')).toBeVisible();
        await check('achievement dialog');
        await page.keyboard.press('Escape');
        await open(page, '/goals');
        await page.getByRole('button', { name: 'Add goal' }).click();
        await expect(page.getByTestId('goal-dialog')).toBeVisible();
        await check('goal dialog');
        await page.keyboard.press('Escape');
        await open(page, '/settings/privacy');
        await page.getByRole('button', { name: 'Delete account…' }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await check('delete dialog');
        await page.keyboard.press('Escape');
      });
    }
  }
});
