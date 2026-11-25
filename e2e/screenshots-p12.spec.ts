import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { api, hideDevOverlay, signIn, waitForHydration } from './helpers';

/**
 * Phase 12 screenshots (achievements + quick-add + "Turn into achievement" pre-filled, goals +
 * detail, profile, notifications, privacy + delete dialog, plan & usage, unsubscribe and the digest
 * email) × light/dark × desktop/mobile at 2× DPR into docs/v2/screenshots/p12/. Opt-in:
 * `SCREENSHOTS=1 npm run test:e2e -- e2e/screenshots-p12.spec.ts`, then quantize (PROGRESS P11).
 */
test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to regenerate docs/v2/screenshots/p12');
test.describe.configure({ mode: 'serial', timeout: 300_000 });

const OUT = 'docs/v2/screenshots/p12';
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

function unsubscribeToken(userId: string): string {
  let env = '';
  try {
    env = readFileSync('.env', 'utf8');
  } catch {
    // no .env: use the documented development default
  }
  const secret =
    process.env.UNSUBSCRIBE_TOKEN_SECRET ??
    /^UNSUBSCRIBE_TOKEN_SECRET=(.+)$/m.exec(env)?.[1]?.trim() ??
    'dev-only-unsubscribe-secret-change-me-0123456789';
  const payload = Buffer.from(
    JSON.stringify({ u: userId, l: 'digest', e: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(`unsub.v1.${payload}`).digest('base64url')}`;
}

test.beforeEach(async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await signIn(page);
});

test('achievements, quick-add and "Turn into achievement"', async ({ page }) => {
  await each(page, 'achievements', async () => {
    await open(page, '/achievements');
    await expect(page.getByTestId('achievement-list')).toBeVisible();
  });
  await each(
    page,
    'achievement-dialog',
    async () => {
      await open(page, '/achievements');
      await page.getByRole('button', { name: 'Add achievement' }).first().click();
      await expect(page.getByTestId('achievement-dialog')).toBeVisible();
    },
    false,
  );
  const prs = (await (
    await api(page, 'GET', '/activity/prs?role=authored&state=merged&limit=1')
  ).json()) as { data: { id: string }[] };
  const pr = prs.data[0];
  if (!pr) throw new Error('No merged PR in the seed');
  await each(
    page,
    'turn-into-achievement',
    async () => {
      await open(page, `/activity?item=pr_merged:${pr.id}`);
      await page.getByRole('button', { name: /Turn into achievement/ }).click();
      await expect(page.getByTestId('achievement-dialog')).toContainText('Drafted by AI from');
    },
    false,
  );
});

test('goals and goal detail', async ({ page }) => {
  await each(page, 'goals', async () => {
    await open(page, '/goals');
    await expect(page.getByTestId('goal-list')).toBeVisible();
  });
  const goals = (await (await api(page, 'GET', '/goals')).json()) as {
    data: { id: string; metricTarget: unknown }[];
  };
  const tracked = goals.data.find((g) => !g.metricTarget) ?? goals.data[0];
  await each(
    page,
    'goal-detail',
    async () => {
      await open(page, `/goals?goal=${tracked?.id ?? ''}`);
      await expect(page.getByTestId('goal-sheet')).toContainText('Linked achievements');
    },
    false,
  );
});

test('settings: profile, notifications, privacy (+ delete dialog), plan', async ({ page }) => {
  await each(page, 'profile', async () => {
    await open(page, '/settings/profile');
    await expect(page.getByTestId('session-list')).toBeVisible();
  });
  await each(page, 'notifications', async () => {
    await open(page, '/settings/notifications');
    await expect(page.getByTestId('toggle-digest')).toBeVisible();
  });
  await each(page, 'privacy', async () => {
    await open(page, '/settings/privacy');
    await expect(page.getByTestId('toggle-redact')).toBeVisible();
  });
  await each(
    page,
    'privacy-delete-dialog',
    async () => {
      await open(page, '/settings/privacy');
      await page.getByRole('button', { name: 'Delete account…' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
    },
    false,
  );
  await each(page, 'plan', async () => {
    await open(page, '/settings/plan');
    await expect(page.getByRole('table', { name: 'Free and Pro plan limits' })).toBeVisible();
  });
});

test('unsubscribe page and the digest email', async ({ page, browser }) => {
  const me = (await (await api(page, 'GET', '/me')).json()) as { data: { user: { id: string } } };
  const preview = (await (await api(page, 'POST', '/notifications/digest/preview', {})).json()) as {
    data: { html: string };
  };
  const anon = await browser.newContext({ deviceScaleFactor: 2 });
  const visitor = await anon.newPage();
  await each(
    visitor,
    'unsubscribe',
    async () => {
      await visitor.goto(
        `/unsubscribe?token=${encodeURIComponent(unsubscribeToken(me.data.user.id))}`,
      );
      await hideDevOverlay(visitor);
      await expect(visitor.getByRole('heading', { name: /unsubscribed/ })).toBeVisible();
    },
    false,
  );
  // The email is always light (its own palette); one rendering per viewport.
  for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
    await visitor.setViewportSize(viewport);
    await visitor.setContent(preview.data.html);
    await visitor.screenshot({ path: `${OUT}/digest-email-${vp}.png`, fullPage: true });
  }
  await anon.close();
  await api(page, 'PATCH', '/me/settings', { digestEnabled: true });
});
