import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calls,
  fail,
  pending,
  renderWithQuery,
  setRoutes,
  type Handler,
} from '../../../../../test/api-mock';
import { byProvider, clone, fx13, NOW } from '../../../../../test/fixtures-p13';
import { setUrl } from '../../../../../test/navigation-mock';
import { IntegrationsView } from './integrations-view';

vi.mock(
  '@/lib/api/browser',
  async () => (await import('../../../../../test/api-mock')).browserModule,
);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../../test/navigation-mock')).navigationModule,
);
const toast = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('sonner', () => ({ toast }));

const statusFor: Handler = (query) => {
  const id = (query as { integrationId?: string } | undefined)?.integrationId;
  if (id === byProvider('jira').id) return fx13.syncStatusJira;
  if (id === byProvider('linear').id) return fx13.syncStatusLinear;
  if (id === byProvider('gitlab').id) return fx13.syncStatusGitlab;
  return fx13.syncStatusGitlab;
};

function routes(overrides: Record<string, Handler | object> = {}) {
  setRoutes({
    'GET /me': fx13.me,
    'GET /integrations': fx13.integrations,
    'GET /integrations/providers': fx13.providers,
    'GET /integrations/*': fx13.identitiesGitlab,
    'GET /sync/status': statusFor,
    'GET /sync/runs': fx13.syncRunsJira,
    'GET /repos': fx13.reposGitlab,
    ...overrides,
  });
}

describe('IntegrationsView — GitLab / Jira / Linear (S19, P13)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    setUrl('/settings/integrations');
    calls.length = 0;
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('success: live cards per connected source with status, settings and usage', async () => {
    routes();
    renderWithQuery(<IntegrationsView />);
    const gitlab = await screen.findByTestId('gitlab-card');
    expect(within(gitlab).getByRole('heading', { name: 'GitLab' })).toBeInTheDocument();
    expect(within(gitlab).getByText(/via GitLab OAuth/)).toBeInTheDocument();
    const emails = await within(gitlab).findByTestId('linked-emails');
    expect(emails).toHaveTextContent('Verified by GitLab');
    expect(emails).toHaveTextContent('dana@old-laptop.local');
    expect(
      within(emails).getByRole('button', { name: 'Remove dana@old-laptop.local' }),
    ).toBeInTheDocument();

    const jira = screen.getByTestId('jira-card');
    expect(within(jira).getByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      'https://acme.atlassian.net/',
    );
    expect(within(jira).getByLabelText('Story points field')).toHaveAttribute(
      'placeholder',
      'customfield_10016',
    );
    expect(within(jira).getByRole('link', { name: /Manage on Jira/ })).toBeInTheDocument();

    const linear = screen.getByTestId('linear-card');
    expect(await within(linear).findByTestId('sync-status-badge')).toHaveTextContent(
      'Needs reconnection',
    );
    expect(within(linear).getByRole('button', { name: 'Reconnect Linear' })).toBeInTheDocument();
    expect(
      within(linear).getByText('Linear access was revoked', { exact: false }),
    ).toBeInTheDocument();
    expect(within(linear).getByText('Acme')).toBeInTheDocument();

    expect(screen.getByTestId('sources-usage')).toHaveTextContent('4 of 4 sources connected');
    expect(screen.queryByTestId('gitlab-connect')).not.toBeInTheDocument();
    expect(screen.getAllByText(/sync history$/).length).toBeGreaterThanOrEqual(3);
  });

  it('Jira story points field: validates, saves with PATCH and toasts', async () => {
    const jira = byProvider('jira');
    routes({ 'PATCH /integrations/*': { data: { ...jira, currentRun: null } } });
    renderWithQuery(<IntegrationsView />);
    const card = await screen.findByTestId('jira-card');
    const input = within(card).getByLabelText('Story points field');
    await userEvent.type(input, 'points');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(within(card).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'customfield_20000');
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      path: `/integrations/${jira.id}`,
      body: { storyPointsField: 'customfield_20000' },
    });
    expect(toast.success).toHaveBeenCalledWith('Story points field saved. Re-reading your issues…');
  });

  it('GitLab commit emails: add (POST) and conflict error toast', async () => {
    const gitlab = byProvider('gitlab');
    routes({ 'POST /integrations/*': fail(409, 'CONFLICT', { reason: 'identity_in_use' }) });
    renderWithQuery(<IntegrationsView />);
    const card = await screen.findByTestId('gitlab-card');
    await userEvent.type(within(card).getByLabelText('Add an email'), 'me@laptop.test');
    await userEvent.click(within(card).getByRole('button', { name: 'Add email' }));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: `/integrations/${gitlab.id}/identities`,
      body: { email: 'me@laptop.test' },
    });
    expect(toast.error).toHaveBeenCalled();
  });

  it('connect tiles: configured provider starts OAuth; at the plan limit Connect is disabled with a reason', async () => {
    const data = clone(fx13.integrations);
    data.data = data.data.filter((i) => i.provider === 'github');
    const me = clone(fx13.me);
    me.data.entitlements.usage.integrations = 1;
    const assign = vi.fn();
    vi.stubGlobal('location', { href: window.location.href, assign });
    routes({
      'GET /integrations': data,
      'GET /me': me,
      'POST /integrations/*': {
        data: {
          url: 'https://linear.app/oauth/authorize?x=1',
          mode: 'authorize',
          expiresAt: NOW.toISOString(),
        },
      },
    });
    const first = renderWithQuery(<IntegrationsView />);
    const tile = await screen.findByTestId('linear-connect');
    await userEvent.click(within(tile).getByRole('button', { name: 'Connect Linear' }));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/integrations/linear/connect',
      body: { returnTo: '/settings/integrations' },
    });
    expect(assign).toHaveBeenCalledWith('https://linear.app/oauth/authorize?x=1');
    vi.unstubAllGlobals();
    first.unmount();

    const full = clone(fx13.me);
    full.data.entitlements = {
      ...full.data.entitlements,
      limits: { ...full.data.entitlements.limits, integrations: 1 },
    };
    full.data.entitlements.usage.integrations = 1;
    routes({ 'GET /integrations': data, 'GET /me': full });
    renderWithQuery(<IntegrationsView />);
    const jira = await screen.findByTestId('jira-connect');
    expect(await within(jira).findByText(/source limit is reached/)).toBeInTheDocument();
    expect(within(jira).getByRole('button', { name: 'Connect Jira' })).toBeDisabled();
  });

  it('connect error banner names the provider (?connectError=&provider=)', async () => {
    routes();
    renderWithQuery(<IntegrationsView connectError="in_use" provider="gitlab" />);
    expect(
      await screen.findByText(
        'This GitLab account is already connected to another DevImpact account',
      ),
    ).toBeInTheDocument();
  });

  it('disconnect of an issue tracker explains Jira token handling and purges issues', async () => {
    const jira = byProvider('jira');
    routes({
      'DELETE /integrations/*': {
        data: {
          integrationId: jira.id,
          status: 'disconnected',
          purged: false,
          tokenRevoked: false,
        },
      },
    });
    renderWithQuery(<IntegrationsView />);
    const card = await screen.findByTestId('jira-card');
    await userEvent.click(within(card).getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Disconnect Jira?' });
    expect(dialog).toHaveTextContent('id.atlassian.com');
    expect(dialog).toHaveTextContent('Removes imported issues');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(toast.success).toHaveBeenCalledWith('Jira disconnected. Your data is kept.');
  });

  it('loading: identities skeleton; error: provider list failure keeps tiles disabled', async () => {
    routes({ 'GET /integrations/*': pending });
    const first = renderWithQuery(<IntegrationsView />);
    expect(await screen.findByText('Loading emails…')).toBeInTheDocument();
    first.unmount();
    const data = clone(fx13.integrations);
    data.data = [];
    routes({ 'GET /integrations': data, 'GET /integrations/providers': fail(503) });
    renderWithQuery(<IntegrationsView />);
    const tile = await screen.findByTestId('gitlab-connect');
    expect(await within(tile).findByText(/isn't set up on this server yet/)).toBeInTheDocument();
  });
});
