import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UnsubscribeView } from '@/app/(system)/unsubscribe/unsubscribe-view';

import {
  calls,
  fail,
  pending,
  renderWithQuery,
  setRoutes,
  type Handler,
} from '../../../../test/api-mock';
import { clone, fx12, NOW } from '../../../../test/fixtures-p12';
import { setUrl } from '../../../../test/navigation-mock';
import { NotificationsView } from './notifications/notifications-view';
import { nearLimitNote, PlanView } from './plan/plan-view';
import { PrivacyView } from './privacy/privacy-view';
import { describeAgent, ProfileView } from './profile/profile-view';

vi.mock('@/lib/api/browser', async () => (await import('../../../../test/api-mock')).browserModule);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../test/navigation-mock')).navigationModule,
);
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));
const signOut = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@/lib/sign-out', () => ({ signOut }));
const authClient = vi.hoisted(() => ({
  listAccounts: vi.fn(() =>
    Promise.resolve({ data: [{ id: 'a1', providerId: 'github' }], error: null }),
  ),
  linkSocial: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  listSessions: vi.fn(() =>
    Promise.resolve({
      data: [
        {
          id: 's1',
          token: 't1',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0',
          updatedAt: '2026-11-24T10:00:00Z',
        },
        {
          id: 's2',
          token: 't2',
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1',
          updatedAt: '2026-11-22T10:00:00Z',
        },
      ],
      error: null,
    }),
  ),
  getSession: vi.fn(() => Promise.resolve({ data: { session: { id: 's1' } }, error: null })),
  revokeSession: vi.fn(() => Promise.resolve({ data: {}, error: null })),
}));
vi.mock('@/lib/auth-client', () => ({ authClient, getApiToken: vi.fn(), clearApiToken: vi.fn() }));

const settingsOf = (me = fx12.me.data) => me.settings;

function routes(overrides: Record<string, Handler | object> = {}) {
  setRoutes({
    'GET /me': fx12.me,
    'GET /me/entitlements': fx12.entitlements,
    'GET /me/usage': fx12.usage,
    'GET /repos': { data: [], meta: { nextCursor: null, hasMore: false, total: 6 } },
    'POST /notifications/digest/preview': fx12.digestPreview,
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  calls.length = 0;
  toast.success.mockClear();
  toast.error.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Settings → Notifications (S21)', () => {
  it('loading and error states', async () => {
    routes({ 'GET /me': pending });
    const first = renderWithQuery(<NotificationsView />);
    expect(screen.getByText('Loading your notification settings…')).toBeInTheDocument();
    first.unmount();
    routes({ 'GET /me': fail(500, 'INTERNAL') });
    renderWithQuery(<NotificationsView />);
    expect(
      await screen.findByRole('heading', { name: "Couldn't load your settings" }),
    ).toBeInTheDocument();
  });

  it('toggles save immediately; a failed save reverts with "Couldn\'t save"; digest off hides the schedule', async () => {
    let patched: unknown = null;
    routes({
      'PATCH /me/settings': (_q: unknown, b: unknown) => {
        patched = b;
        return { data: { ...settingsOf(), ...(b as object) } };
      },
    });
    renderWithQuery(<NotificationsView />);
    expect(
      await screen.findByText(
        `Emails go to ${fx12.me.data.user.email}. Every email has a one-click unsubscribe link.`,
      ),
    ).toBeInTheDocument();
    const digest = screen.getByRole('switch', { name: 'Weekly digest' });
    expect(digest).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Send on')).toBeInTheDocument();
    await userEvent.click(digest);
    await waitFor(() => {
      expect(patched).toEqual({ digestEnabled: false });
    });
    expect(toast.success).toHaveBeenCalledWith('Saved');
    expect(screen.queryByLabelText('Send on')).not.toBeInTheDocument();

    routes({ 'PATCH /me/settings': fail(503, 'UPSTREAM_UNAVAILABLE') });
    const sync = screen.getByRole('switch', { name: 'Sync problems' });
    const before = sync.getAttribute('aria-checked');
    await userEvent.click(sync);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Couldn't save. Try again.");
    });
    expect(sync).toHaveAttribute('aria-checked', before);
  });

  it('previews this week’s digest in a sandboxed frame (nothing is sent)', async () => {
    routes();
    renderWithQuery(<NotificationsView />);
    await userEvent.click(
      await screen.findByRole('button', { name: "Preview this week's digest" }),
    );
    const frame = await screen.findByTestId('digest-preview');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(
      screen.getByRole('heading', { name: fx12.digestPreview.data.subject }),
    ).toBeInTheDocument();
    expect(screen.getByText('Preview · not sent')).toBeInTheDocument();
  });
});

describe('Settings → Privacy & data (S22)', () => {
  it('repositories counted, redaction toggle, export download and its daily limit', async () => {
    let patched: unknown = null;
    routes({
      'PATCH /me/settings': (_q: unknown, b: unknown) => {
        patched = b;
        return { data: { ...settingsOf(), ...(b as object) } };
      },
    });
    renderWithQuery(<PrivacyView />);
    expect(await screen.findByText('6 of 6 repositories are included.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'href',
      '/settings/integrations',
    );
    await userEvent.click(
      screen.getByRole('switch', { name: 'Redact private repository names in AI output' }),
    );
    await waitFor(() => {
      expect(patched).toEqual({ aiRedactPrivateRepos: true });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Export data' }));
    await waitFor(() => {
      expect(calls.some((c) => c.path === '/me/export')).toBe(true);
    });
    expect(screen.getByText('Up to 3 exports a day')).toBeInTheDocument();
  });

  it('export 429 shows the daily-limit copy', async () => {
    routes({
      'GET /me/export': fail(429, 'RATE_LIMITED', {
        class: 'data-export',
        retryAfterSeconds: 3600,
      }),
    });
    renderWithQuery(<PrivacyView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Export data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You've exported 3 times today. Try again tomorrow.",
    );
  });

  it('delete: typed email confirmation, mismatch error, success signs out with "Account deleted"', async () => {
    routes({ 'DELETE /me': fail(400, 'VALIDATION_FAILED') });
    renderWithQuery(<PrivacyView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete account…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Delete your account?' }),
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Delete account' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), fx12.me.data.user.email);
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "The email doesn't match your account",
    );

    routes({ 'DELETE /me': { data: { deleted: true } } });
    await userEvent.click(confirm);
    await waitFor(() => {
      expect(signOut).toHaveBeenCalledWith(expect.anything(), { reason: 'account_deleted' });
    });
    expect(calls.filter((c) => c.method.toLowerCase() === 'delete').at(-1)?.body).toEqual({
      confirmEmail: fx12.me.data.user.email,
    });
  });
});

describe('Settings → Plan & usage (S23)', () => {
  it('meters, plans table with the current plan and the upgrade email', async () => {
    routes();
    renderWithQuery(<PlanView />);
    expect(await screen.findByText('You are on the Pro plan.')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: /AI document generations/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /Quick AI actions/ })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Free and Pro plan limits' })).toBeInTheDocument();
    expect(screen.getByText('History window')).toBeInTheDocument();
    expect(screen.getByText('upgrade@devimpact.dev')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('near the limit and error states', async () => {
    expect(nearLimitNote(12, 15, 'generations', '2026-12-01T00:00:00.000Z')).toBe(
      '3 generations left — resets December 1',
    );
    expect(nearLimitNote(15, 15, 'generations', '2026-12-01T00:00:00.000Z')).toBe(
      "You've used all 15 generations for November. They reset on December 1.",
    );
    expect(nearLimitNote(2, 15, 'generations', '2026-12-01T00:00:00.000Z')).toBeUndefined();
    const usage = clone(fx12.usage);
    usage.data.generations = { ...usage.data.generations, used: 140, limit: 150 };
    routes({ 'GET /me/usage': usage, 'GET /me/entitlements': fail(500, 'INTERNAL') });
    renderWithQuery(<PlanView />);
    expect(
      await screen.findByRole('heading', { name: "Couldn't load your plan and usage" }),
    ).toBeInTheDocument();
  });
});

describe('Settings → Profile (S20)', () => {
  it('saves roles, lists sign-in methods and sessions, signs out another device', async () => {
    let patched: unknown = null;
    routes({
      'PATCH /me/settings': (_q: unknown, b: unknown) => {
        patched = b;
        return { data: { ...settingsOf(), ...(b as object) } };
      },
    });
    renderWithQuery(<ProfileView providers={{ github: true, google: true }} />);
    const target = await screen.findByLabelText(/Target role/);
    await userEvent.clear(target);
    await userEvent.type(target, 'Principal engineer');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(patched).toMatchObject({ targetRole: 'Principal engineer' });
    });
    expect(toast.success).toHaveBeenCalledWith('Profile saved');
    expect(await screen.findByRole('button', { name: 'Link Google' })).toBeInTheDocument();
    expect(screen.getByText('Linked')).toBeInTheDocument();
    const sessions = await screen.findByTestId('session-list');
    expect(within(sessions).getByText('Chrome on macOS')).toBeInTheDocument();
    expect(within(sessions).getByText('This device')).toBeInTheDocument();
    await userEvent.click(within(sessions).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => {
      expect(authClient.revokeSession).toHaveBeenCalledWith({ token: 't2' });
    });
    expect(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1')).toBe(
      'Safari on iOS',
    );
    expect(describeAgent(null)).toBe('Browser');
  });
});

describe('Unsubscribe (S24)', () => {
  beforeEach(() => {
    setUrl('/unsubscribe');
  });

  it('valid token: loading → confirmation', async () => {
    routes({ 'POST /notifications/unsubscribe': { data: { unsubscribed: true, list: 'digest' } } });
    renderWithQuery(<UnsubscribeView token="abc.def" />);
    expect(screen.getByText('Updating your email preferences…')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: "You're unsubscribed from the weekly digest." }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change all email settings' })).toHaveAttribute(
      'href',
      '/sign-in?callbackUrl=%2Fsettings%2Fnotifications',
    );
    expect(calls.filter((c) => c.path === '/notifications/unsubscribe')).toHaveLength(1);
  });

  it('expired, invalid and missing tokens', async () => {
    routes({
      'POST /notifications/unsubscribe': fail(400, 'VALIDATION_FAILED', { reason: 'expired' }),
    });
    const a = renderWithQuery(<UnsubscribeView token="abc.def" />);
    expect(
      await screen.findByRole('heading', { name: 'This unsubscribe link has expired' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Sign in to change your email settings.')).toBeInTheDocument();
    a.unmount();
    routes({
      'POST /notifications/unsubscribe': fail(400, 'VALIDATION_FAILED', { reason: 'invalid' }),
    });
    const b = renderWithQuery(<UnsubscribeView token="abc.def" />);
    expect(
      await screen.findByRole('heading', { name: 'This unsubscribe link is invalid' }),
    ).toBeInTheDocument();
    b.unmount();
    renderWithQuery(<UnsubscribeView token={null} />);
    expect(
      screen.getByRole('heading', { name: 'This unsubscribe link is invalid' }),
    ).toBeInTheDocument();
  });
});
