/**
 * AUDIT HELPER — Playwright pass over every v0.1.0 page.
 *
 *   node docs/v2/audit/scripts/ui-audit.cjs <state> [userId]
 *     state  : label used in file names (empty | seeded | apidown)
 *     userId : if given, written to localStorage 'devimpact_user_id' before load
 *              (this is all it takes to "log in" as any user in v0.1.0)
 *   node docs/v2/audit/scripts/ui-audit.cjs interactions <userId>
 *     clicks every action button on seeded pages (needs mock Anthropic for generation)
 *
 * Writes screenshots to docs/v2/audit/screenshots/<state>-<width>-<page>.png (deviceScaleFactor 1)
 * and findings to docs/v2/audit/logs/ui-<state>.json.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.WEB || 'http://localhost:3000';
const root = path.resolve(__dirname, '../../../..');
const shotDir = path.join(root, 'docs/v2/audit/screenshots');
const logDir = path.join(root, 'docs/v2/audit/logs');
fs.mkdirSync(shotDir, { recursive: true });

const PAGES = [
  ['root', '/'],
  ['dashboard', '/dashboard'],
  ['connect', '/connect'],
  ['connect-callback', '/connect/callback'],
  ['connect-callback-code', '/connect/callback?code=bogus'],
  ['resume', '/resume'],
  ['appraisal', '/appraisal'],
  ['promotion', '/promotion'],
  ['career', '/career'],
  ['kpis', '/kpis'],
  ['settings', '/settings'],
  ['not-found', '/does-not-exist'],
];
const WIDTHS = [
  [1440, 900],
  [390, 844],
];

async function auditPage(browser, state, userId, [name, url], [w, h]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  if (userId) await ctx.addInitScript((id) => localStorage.setItem('devimpact_user_id', id), userId);
  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failed = [];
  const apiCalls = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 300)));
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on('requestfailed', (r) => failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.url().includes(':4000/api')) apiCalls.push(`${r.request().method()} ${r.url().replace(/^.*\/api/, '')} -> ${r.status()}`);
  });
  const t0 = Date.now();
  let status = null;
  try {
    const resp = await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 45000 });
    status = resp?.status() ?? null;
  } catch (e) {
    pageErrors.push('goto: ' + String(e).slice(0, 200));
  }
  await page.waitForTimeout(800);
  const loadMs = Date.now() - t0;
  const facts = await page.evaluate(() => {
    const vis = (el) => !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none';
    const nav = document.querySelector('aside');
    const inputs = [...document.querySelectorAll('input,select,textarea')];
    const unlabeled = inputs.filter((i) => !(i.labels && i.labels.length) && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby'));
    return {
      finalUrl: location.pathname + location.search,
      title: document.title,
      h1: [...document.querySelectorAll('h1')].map((e) => e.textContent.trim()),
      navVisible: vis(nav),
      anyMenuButton: !!document.querySelector('[aria-label*="menu" i], button[aria-expanded]'),
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      // v0.1.0 layout is h-screen + <main overflow-y-auto>, so overflow is clipped inside <main>
      mainHorizontalOverflowPx: (() => { const m = document.querySelector('main'); return m ? Math.max(0, m.scrollWidth - m.clientWidth) : 0; })(),
      spinnerVisible: !!document.querySelector('.animate-spin'),
      buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim()).filter(Boolean),
      inputs: inputs.length,
      unlabeledInputs: unlabeled.length,
      textSample: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400),
    };
  });
  const file = `${state}-${w}-${name}.png`;
  // Expand the fixed-height shell so the full-page screenshot shows all content.
  await page.addStyleTag({ content: '.h-screen{height:auto!important;min-height:100vh} main{overflow:visible!important}' }).catch(() => {});
  await page.screenshot({ path: path.join(shotDir, file), fullPage: true });
  await ctx.close();
  return { page: name, url, width: w, status, loadMs, screenshot: file, consoleErrors, pageErrors, failedRequests: failed, apiCalls, ...facts };
}

async function interactions(browser, userId) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript((id) => localStorage.setItem('devimpact_user_id', id), userId);
  const page = await ctx.newPage();
  const results = [];
  let requests = [];
  page.on('request', (r) => r.url().includes(':4000/api') && requests.push(`${r.method()} ${r.url().replace(/^.*\/api/, '')}`));
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  const downloads = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));

  async function clickAndObserve(label, locator, settleMs = 1500) {
    requests = [];
    const beforeHtml = await page.content();
    const beforeClip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    const beforeUrl = page.url();
    try { await locator.click({ timeout: 5000 }); } catch (e) { results.push({ label, error: String(e).slice(0, 160) }); return; }
    await page.waitForTimeout(settleMs);
    const afterClip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    const afterHtml = await page.content();
    results.push({
      label, apiRequests: [...requests], domChanged: afterHtml !== beforeHtml, clipboardChanged: afterClip !== beforeClip,
      navigated: page.url() !== beforeUrl ? page.url() : null, dialogs: [...dialogs], downloads: [...downloads],
    });
  }

  await page.goto(BASE + '/resume', { waitUntil: 'networkidle' });
  await clickAndObserve('resume: Generate Resume Bullets', page.getByRole('button', { name: /Generate Resume Bullets/ }), 3000);
  await page.screenshot({ path: path.join(shotDir, 'interaction-1440-resume-generated.png'), fullPage: true });
  await clickAndObserve('resume: Copy All', page.getByRole('button', { name: /Copy All/ }));
  await clickAndObserve('resume: Export PDF', page.getByRole('button', { name: /Export PDF/ }));

  await page.goto(BASE + '/appraisal', { waitUntil: 'networkidle' });
  await clickAndObserve('appraisal: Generate Appraisal', page.getByRole('button', { name: /Generate Appraisal/ }), 3000);
  await page.screenshot({ path: path.join(shotDir, 'interaction-1440-appraisal-generated.png'), fullPage: true });
  await clickAndObserve('appraisal: Export Document', page.getByRole('button', { name: /Export Document/ }));

  await page.goto(BASE + '/promotion', { waitUntil: 'networkidle' });
  await clickAndObserve('promotion: Generate Promotion Packet', page.getByRole('button', { name: /Generate Promotion Packet/ }), 3000);
  await page.screenshot({ path: path.join(shotDir, 'interaction-1440-promotion-generated.png'), fullPage: true });

  await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await clickAndObserve('settings: Save Changes', page.getByRole('button', { name: /Save Changes/ }));
  await clickAndObserve('settings: Enable (weekly summary)', page.getByRole('button', { name: /Enable/ }).first());

  await page.goto(BASE + '/connect', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(shotDir, 'interaction-1440-connect-connected.png'), fullPage: true });
  await clickAndObserve('connect: Sync (fake token -> job fails)', page.getByRole('button', { name: /^Sync$/ }), 6000);
  await page.screenshot({ path: path.join(shotDir, 'interaction-1440-connect-after-failed-sync.png'), fullPage: true });

  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
  await clickAndObserve('dashboard: Generate Resume (quick action)', page.getByRole('button', { name: /Generate Resume/ }));
  await ctx.close();
  return results;
}

(async () => {
  const [state, userId] = process.argv.slice(2);
  const browser = await chromium.launch();
  let out;
  if (state === 'interactions') {
    out = await interactions(browser, userId);
  } else {
    out = [];
    for (const wh of WIDTHS) for (const p of PAGES) {
      const r = await auditPage(browser, state, userId, p, wh);
      console.log(`${state} ${r.width} ${r.page.padEnd(22)} ${r.status} ${r.loadMs}ms nav=${r.navVisible} overflow=${r.horizontalOverflowPx}/${r.mainHorizontalOverflowPx} errs=${r.consoleErrors.length + r.pageErrors.length} api=${r.apiCalls.length}`);
      out.push(r);
    }
  }
  fs.writeFileSync(path.join(logDir, `ui-${state}.json`), JSON.stringify(out, null, 2));
  if (state === 'interactions') console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
