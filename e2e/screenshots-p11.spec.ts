import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { api, hideDevOverlay, signIn, waitForHydration } from './helpers';

/**
 * Phase 11 screenshots (library, type picker, studios, streaming, viewer, editor, versions,
 * citation popover × light/dark × desktop/mobile at 2× DPR, plus exported PDF first pages) into
 * docs/v2/screenshots/p11/. Opt-in: `SCREENSHOTS=1 npm run test:e2e -- e2e/screenshots-p11.spec.ts`.
 * PDF pages are rendered with `pdftoppm` (poppler) when it is installed. Quantize afterwards
 * (see PROGRESS.md P11).
 */
test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to regenerate docs/v2/screenshots/p11');
test.describe.configure({ mode: 'serial', timeout: 300_000 });

const OUT = 'docs/v2/screenshots/p11';
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

async function seededAppraisal(page: Page): Promise<string> {
  const res = await api(page, 'GET', '/documents?type=appraisal&limit=20');
  const docs = ((await res.json()) as { data: { id: string; currentVersion: number }[] }).data;
  const doc = docs.find((d) => d.currentVersion === 3);
  if (!doc) throw new Error('Seeded appraisal not found — run npm run db:seed');
  return doc.id;
}

test.beforeEach(async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await signIn(page);
});

test('library, picker and studios', async ({ page }) => {
  await each(page, 'library', async () => {
    await open(page, '/documents');
    await expect(page.getByTestId('document-row').first()).toBeVisible();
  });
  await each(page, 'new-document', async () => {
    await open(page, '/documents/new');
  });
  for (const type of ['appraisal', 'promotion', 'resume'] as const) {
    await each(page, `studio-${type}`, async () => {
      await open(page, `/documents/new/${type}`);
      await expect(page.getByTestId('evidence-preview')).toContainText('Most significant work');
      await page.waitForLoadState('networkidle');
    });
  }
});

test('viewer, citation popover, versions and editor', async ({ page }) => {
  const id = await seededAppraisal(page);
  await each(page, 'viewer', async () => {
    await open(page, `/documents/${id}`);
    await expect(page.getByTestId('document-body')).toBeVisible();
  });
  await each(
    page,
    'citation-popover',
    async () => {
      await open(page, `/documents/${id}`);
      await page
        .getByTestId('document-body')
        .getByRole('button', { name: /^Evidence PR-/ })
        .first()
        .click();
      await expect(page.getByRole('dialog', { name: 'Evidence' })).toBeVisible();
    },
    false,
  );
  await each(page, 'version-v1', async (vp) => {
    await open(page, `/documents/${id}?version=1`);
    await expect(page.getByText("You're viewing v1")).toBeVisible();
    if (vp === 'mobile') await page.getByTestId('version-list').scrollIntoViewIfNeeded();
  });
  await each(page, 'editor', async (vp) => {
    await open(page, `/documents/${id}`);
    if (vp === 'desktop') await page.getByRole('button', { name: 'Edit' }).click();
    else {
      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Edit' }).click();
    }
    await expect(page.getByTestId('document-editor')).toBeVisible();
  });
  const resume = await api(page, 'GET', '/documents?type=resume&limit=20');
  const rid = (
    (await resume.json()) as { data: { id: string; currentVersion: number; title: string }[] }
  ).data.find((d) => !d.title.includes('imported'))?.id;
  if (rid) {
    await each(page, 'resume-bullets', async () => {
      await open(page, `/documents/${rid}`);
      await expect(page.getByTestId('resume-bullet').first()).toBeVisible();
    });
  }
});

test('streaming', async ({ page }) => {
  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await open(page, '/documents/new/appraisal');
      await page.getByLabel(/Self-reflection notes/).fill(`Screenshot ${Date.now()}`);
      await page.getByRole('button', { name: 'Generate' }).click();
      await expect(page.getByTestId('streaming-status')).toContainText('Writing section 2', {
        timeout: 30_000,
      });
      await page.screenshot({ path: `${OUT}/streaming-${vpName}-${scheme}.png` });
      await expect(page.getByTestId('coverage-badge')).toBeVisible({ timeout: 60_000 });
    }
  }
});

test('exported PDF first pages', async ({ page }) => {
  const docs = await api(page, 'GET', '/documents?limit=20');
  const list = (
    (await docs.json()) as { data: { id: string; type: string; title: string }[] }
  ).data.filter((d) => !d.title.includes('imported'));
  const dir = join(tmpdir(), 'devimpact-p11-pdf');
  mkdirSync(dir, { recursive: true });
  for (const type of ['appraisal', 'promotion', 'resume']) {
    const doc = list.find((d) => d.type === type);
    if (!doc) continue;
    const res = await api(page, 'GET', `/documents/${doc.id}/export?format=pdf`);
    expect(res.ok()).toBeTruthy();
    const file = join(dir, `${type}.pdf`);
    writeFileSync(file, await res.body());
    try {
      execFileSync('pdftoppm', [
        '-png',
        '-r',
        '110',
        '-f',
        '1',
        '-l',
        '1',
        '-singlefile',
        file,
        `${OUT}/export-${type}-pdf`,
      ]);
    } catch {
      test.info().annotations.push({ type: 'skipped', description: 'pdftoppm not installed' });
    }
  }
});
