import AxeBuilder from '@axe-core/playwright';
import { expect, type APIResponse, type Page } from '@playwright/test';

export const WEB_PROD_URL = process.env.E2E_WEB_PROD_URL ?? 'http://localhost:3001';
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000/api';
export const DEMO_EMAIL = 'demo@devimpact.dev';

/** Dev login as the seeded demo user (sets the session cookie on the page's context). */
export async function signIn(page: Page): Promise<void> {
  const res = await page.request.post('/api/dev-login', { data: { email: DEMO_EMAIL } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** A Bearer JWT for direct API calls in test setup (`GET /api/auth/token` with the session). */
export async function apiToken(page: Page): Promise<string> {
  const res = await page.request.get('/api/auth/token');
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { token: string }).token;
}

export async function api(
  page: Page,
  method: 'GET' | 'PATCH' | 'POST',
  path: string,
  data?: unknown,
): Promise<APIResponse> {
  const token = await apiToken(page);
  return page.request.fetch(`${API_URL}${path}`, {
    method,
    data,
    headers: { authorization: `Bearer ${token}` },
  });
}

export async function setOnboarding(page: Page, completed: boolean): Promise<void> {
  const res = await api(page, 'PATCH', '/me/settings', {
    onboardingCompleted: completed,
    onboardingStep: null,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** axe-core WCAG 2.0/2.1/2.2 A + AA: no serious or critical violations. */
export async function expectNoSeriousA11yViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // The Next.js dev overlay is not part of the product.
    .exclude('nextjs-portal')
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map(
      (v) =>
        `${label}: ${v.id} (${v.impact ?? ''}) ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

/** Hides the Next.js dev indicator so it never overlaps the UI under test or in screenshots. */
export async function hideDevOverlay(page: Page): Promise<void> {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}
