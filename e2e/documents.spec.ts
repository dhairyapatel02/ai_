import { readFileSync } from 'node:fs';

import { expect, test, type Download, type Page } from '@playwright/test';

import { expectNoSeriousA11yViolations, hideDevOverlay, signIn, waitForHydration } from './helpers';

/**
 * P11 document studio on the seeded demo user, against the fake Anthropic API (playwright.config,
 * slowed so streaming is visible): resume generate → stream → edit a bullet (autosave version) →
 * restore → export MD/PDF/DOCX → library → delete; appraisal and promotion generate + export;
 * leaving mid-stream and coming back; axe (light, dark, 390 px) and overflow on every P11 page.
 */

const unique = () => `e2e-${Date.now().toString(36)}`;

async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFileSync(path);
}

async function exportAs(page: Page, item: string): Promise<{ name: string; body: Buffer }> {
  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: item }).click(),
  ]);
  return { name: download.suggestedFilename(), body: await readDownload(download) };
}

async function waitReady(page: Page) {
  await expect(page.getByTestId('coverage-badge')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('streaming-status')).toHaveCount(0);
}

test.describe('document studio (P11)', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('resume: generate → stream → edit → version → restore → export → library → delete', async ({
    page,
  }) => {
    const tag = unique();
    await page.goto('/documents/new/resume');
    await hideDevOverlay(page);
    await waitForHydration(page);
    await expect(page.getByTestId('evidence-preview')).toContainText('PRs merged');
    await page.getByRole('radio', { name: 'DevOps' }).click();
    // A unique job description gives a fresh inputHash, so the run is never served from cache.
    await page.getByLabel(/Job description/).fill(`Platform role ${tag}`);
    await page.getByRole('button', { name: 'Generate' }).click();

    await expect(page).toHaveURL(/\/documents\/c[a-z0-9]+$/);
    const url = page.url();
    await expect(page.getByTestId('streaming-status')).toContainText(/Queued|Writing section/);
    await waitReady(page);
    await expect(page.getByTestId('resume-bullet').first()).toBeVisible();
    await expect(page.getByTestId('version-list')).toContainText('v1 · current');

    // Edit a bullet → autosave → new version.
    await page.getByRole('button', { name: 'Edit' }).click();
    const field = page.getByLabel('Resume bullets, item 1', { exact: true });
    await expect(field).toBeVisible();
    await field.fill(`Edited bullet ${tag}`);
    await expect(page.getByTestId('save-status')).toHaveText(/Saved · v2/, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText(`Edited bullet ${tag}`)).toBeVisible();
    await expect(page.getByTestId('version-list')).toContainText('v2 · current');

    // Restore v1 → v3 without the edit.
    await page.getByRole('button', { name: 'Restore v1' }).click();
    await expect(page.getByTestId('version-list')).toContainText('v3 · current');
    await expect(page.getByText(`Edited bullet ${tag}`)).toHaveCount(0);

    // Exports: Markdown, PDF, DOCX.
    const md = await exportAs(page, 'Download Markdown');
    expect(md.name).toMatch(/^resume-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}-v3\.md$/);
    expect(md.body.toString('utf8')).toMatch(/^# Resume · devops · /);
    const pdf = await exportAs(page, 'Download PDF');
    expect(pdf.name).toMatch(/-v3\.pdf$/);
    expect(pdf.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const docx = await exportAs(page, 'Download DOCX');
    expect(docx.name).toMatch(/-v3\.docx$/);
    expect(docx.body.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(docx.body.includes(Buffer.from('word/document.xml'))).toBe(true);

    // The library lists it; delete from the viewer.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Documents' })
      .click();
    const row = page.getByTestId('document-row').filter({ hasText: 'Resume · devops' }).first();
    await expect(row).toBeVisible();
    await page.goto(url);
    await waitForHydration(page);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete document' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete document' }).click();
    await expect(page).toHaveURL(/\/documents$/);
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'This document was deleted' })).toBeVisible();
  });

  test('appraisal and promotion: generate and export', async ({ page }) => {
    const tag = unique();
    await page.goto('/documents/new/appraisal?period=quarter:2026-Q3');
    await hideDevOverlay(page);
    await waitForHydration(page);
    await expect(page.getByLabel('Period')).toHaveValue('quarter:2026-Q3');
    await page.getByLabel(/Self-reflection notes/).fill(`Proud of the payments work ${tag}`);
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page).toHaveURL(/\/documents\/c[a-z0-9]+$/);
    await waitReady(page);
    await expect(page.getByRole('heading', { name: 'Key contributions' })).toBeVisible();
    await expect(
      page.getByText('Calculated by DevImpact from your GitHub data — not written by AI.'),
    ).toBeVisible();
    const appraisalPdf = await exportAs(page, 'Download PDF');
    expect(appraisalPdf.name).toBe('appraisal-2026-Q3-v1.pdf');
    expect(appraisalPdf.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    await page.goto('/documents/new/promotion');
    await waitForHydration(page);
    await page.getByLabel('Current role').fill(`Senior engineer ${tag}`);
    await page.getByLabel('Target role').fill('Staff engineer');
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page).toHaveURL(/\/documents\/c[a-z0-9]+$/);
    await waitReady(page);
    await expect(page.getByRole('heading', { name: "Why I'm ready" })).toBeVisible();
    const docx = await exportAs(page, 'Download DOCX');
    expect(docx.name).toMatch(/^promotion-.*-v1\.docx$/);
    expect(docx.body.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  test('leaving mid-stream and coming back shows the document, never a lost result', async ({
    page,
  }) => {
    const tag = unique();
    await page.goto('/documents/new/promotion');
    await hideDevOverlay(page);
    await waitForHydration(page);
    await page.getByLabel('Current role').fill(`Engineer ${tag}`);
    await page.getByLabel('Target role').fill('Senior engineer');
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page).toHaveURL(/\/documents\/c[a-z0-9]+$/);
    const url = page.url();
    await expect(page.getByTestId('streaming-status')).toBeVisible();

    // Leave while it is writing: the library shows it as Queued/Writing.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Documents' })
      .click();
    await expect(page).toHaveURL(/\/documents$/);
    const row = page.getByTestId('document-row').filter({ hasText: `Engineer ${tag}` });
    await expect(row).toBeVisible();

    // Come back: the stream replays (or the saved document shows) and it finishes.
    await page.goto(url);
    await expect(page.getByRole('heading', { name: "Why I'm ready" })).toBeVisible({
      timeout: 60_000,
    });
    await waitReady(page);
    await expect(page.getByTestId('version-list')).toContainText('v1 · current');
  });

  test('citation popover and flagged claims on the seeded appraisal', async ({ page }) => {
    await page.goto('/documents?type=appraisal');
    await hideDevOverlay(page);
    await waitForHydration(page);
    const row = page.getByTestId('document-row').filter({ hasText: '1 uncited' }).first();
    await row.getByRole('link').first().click();
    await expect(page.getByText('1 claim has no evidence')).toBeVisible();
    await expect(page.getByText('No evidence linked')).toBeVisible();
    await page
      .getByTestId('document-body')
      .getByRole('button', { name: /^Evidence PR-/ })
      .first()
      .click();
    const pop = page.getByRole('dialog', { name: 'Evidence' });
    await expect(pop.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
      'href',
      /^https:\/\/github\.com\//,
    );
  });
});

const P11_PAGES: {
  name: string;
  path: string;
  ready: (p: Page) => ReturnType<Page['getByTestId']>;
}[] = [
  { name: 'library', path: '/documents', ready: (p) => p.getByTestId('document-row').first() },
  {
    name: 'picker',
    path: '/documents/new',
    ready: (p) => p.getByRole('link', { name: /Start appraisal/ }),
  },
  {
    name: 'resume studio',
    path: '/documents/new/resume',
    ready: (p) => p.getByTestId('evidence-preview'),
  },
  {
    name: 'appraisal studio',
    path: '/documents/new/appraisal',
    ready: (p) => p.getByTestId('evidence-preview'),
  },
  {
    name: 'promotion studio',
    path: '/documents/new/promotion',
    ready: (p) => p.getByTestId('evidence-preview'),
  },
];

test.describe('document studio accessibility (P11)', () => {
  test.describe.configure({ timeout: 240_000 });
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
  ]) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`axe 0 serious/critical and no overflow on every P11 page (${viewport.name}, ${scheme})`, async ({
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
        for (const p of P11_PAGES) {
          await page.goto(p.path);
          await hideDevOverlay(page);
          await expect(p.ready(page)).toBeVisible();
          await page.waitForLoadState('networkidle');
          await check(p.name);
        }
        // Viewer (seeded appraisal), its citation popover, an older version and edit mode.
        await page.goto('/documents?type=appraisal');
        await waitForHydration(page);
        await page
          .getByTestId('document-row')
          .filter({ hasText: '1 uncited' })
          .first()
          .getByRole('link')
          .first()
          .click();
        await expect(page.getByTestId('document-body')).toBeVisible();
        await page.waitForLoadState('networkidle');
        await check('viewer');
        await page
          .getByTestId('document-body')
          .getByRole('button', { name: /^Evidence PR-/ })
          .first()
          .click();
        await expect(page.getByRole('dialog', { name: 'Evidence' })).toBeVisible();
        await check('citation popover');
        await page.keyboard.press('Escape');
        await page.goto(`${page.url().split('?')[0] ?? ''}?version=1`);
        await expect(page.getByText("You're viewing v1")).toBeVisible();
        await check('older version');
        await page.goto(page.url().split('?')[0] ?? '');
        await waitForHydration(page);
        if (viewport.name === 'desktop') {
          await page.getByRole('button', { name: 'Edit' }).click();
        } else {
          await page.getByRole('button', { name: 'More actions' }).click();
          await page.getByRole('menuitem', { name: 'Edit' }).click();
        }
        await expect(page.getByTestId('document-editor')).toBeVisible();
        await check('editor');
      });
    }
  }
});
