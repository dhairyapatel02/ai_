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
import { clone, fx, NOW } from '../../../../../test/fixtures-p10';
import { setUrl } from '../../../../../test/navigation-mock';
import { describeIntegration, newItems, scheduleLabel } from '../../../../lib/integration-state';
import { IntegrationsView } from './integrations-view';

import type { SyncStatusDto } from '@devimpact/shared';

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

function routes(overrides: Record<string, Handler | { data: unknown; meta?: unknown }> = {}) {
  setRoutes({
    'GET /me': fx.me,
    'GET /integrations': fx.integrations,
    'GET /sync/status': fx.syncStatus,
    'GET /sync/runs': fx.syncRuns,
    'GET /repos': fx.repos,
    ...overrides,
  });
}

const integration = fx.integrations.data[0];
const status = (o: Partial<SyncStatusDto>) => ({
  ...fx.syncStatus.data,
  ...o,
});

describe('IntegrationsView (S19)', () => {
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

  it('success: connected card with installations, repositories, sync history and planned providers', async () => {
    routes();
    renderWithQuery(<IntegrationsView />);
    const card = await screen.findByTestId('github-card');
    expect(await within(card).findByTestId('sync-status-badge')).toHaveTextContent('Connected');
    expect(within(card).getByText('acme')).toBeInTheDocument();
    expect(await screen.findAllByTestId('repo-row')).toHaveLength(fx.repos.data.length);
    expect(screen.getByTestId('repos-included')).toHaveTextContent('5 of 6 included');
    expect(
      screen.getByText('Excluded — data kept, never counted', { exact: false }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('sync-history')).toHaveTextContent('Partial');
    const planned = screen.getAllByTestId('planned-provider');
    expect(planned).toHaveLength(3);
    for (const p of planned) expect(within(p).queryByRole('button')).not.toBeInTheDocument();
  });

  it('Sync now starts a sync and toasts; 409 already running is not an error', async () => {
    routes({ 'POST /sync': { data: { syncRun: fx.syncRuns.data[0] } } });
    renderWithQuery(<IntegrationsView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
    expect(toast.info).toHaveBeenCalledWith(
      'Sync started. New activity appears in a minute or two.',
    );
  });

  it('partial run: expands the per-repository error list', async () => {
    routes();
    renderWithQuery(<IntegrationsView />);
    const toggle = await screen.findByRole('button', { name: 'Show 1 error' });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('UPSTREAM_ERROR')).toBeVisible();
  });

  it('excluding a repository calls PATCH /repos/:id and says KPIs are recalculated', async () => {
    const repo = fx.repos.data.find((r) => r.included)!;
    routes({ 'PATCH /repos/*': { data: { ...repo, included: false, inclusionSource: 'user' } } });
    renderWithQuery(<IntegrationsView />);
    await userEvent.click(await screen.findByRole('switch', { name: `Include ${repo.fullName}` }));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      path: `/repos/${repo.id}`,
      body: { included: false },
    });
    expect(toast.info).toHaveBeenCalledWith(
      `${repo.fullName} excluded. KPIs are being recalculated.`,
    );
  });

  it('disconnect asks keep/delete and sends purgeData', async () => {
    routes({
      'DELETE /integrations/*': {
        data: {
          integrationId: integration.id,
          status: 'disconnected',
          purged: true,
          tokenRevoked: true,
        },
      },
    });
    renderWithQuery(<IntegrationsView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Disconnect GitHub?' });
    await userEvent.click(within(dialog).getByText('Delete imported activity'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(calls.find((c) => c.method === 'DELETE')?.query).toEqual({ purgeData: true });
    expect(toast.success).toHaveBeenCalledWith(
      'GitHub disconnected and imported activity deleted.',
    );
  });

  it('not connected: Connect GitHub, no repositories or history', async () => {
    routes({ 'GET /integrations': { data: [] } });
    renderWithQuery(<IntegrationsView />);
    expect(await screen.findByRole('button', { name: 'Connect GitHub' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Repositories' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sync history' })).not.toBeInTheDocument();
  });

  it('loading and error states', async () => {
    routes({ 'GET /integrations': pending });
    const first = renderWithQuery(<IntegrationsView />);
    expect(screen.getByText('Loading integrations…')).toBeInTheDocument();
    first.unmount();
    routes({ 'GET /integrations': fail(503) });
    renderWithQuery(<IntegrationsView />);
    expect(
      await screen.findByRole('heading', { name: "Couldn't load your integrations" }),
    ).toBeInTheDocument();
  });

  it('describeIntegration covers every S19 state', () => {
    const tz = 'Europe/London';
    expect(
      describeIntegration(integration, status({}), { timezone: tz, now: NOW }).badge.text,
    ).toBe('Connected');
    const running = describeIntegration(
      integration,
      status({
        state: 'running',
        currentRun: {
          ...(fx.syncRuns.data[0] as never as SyncStatusDto['currentRun'] & object),
          kind: 'backfill',
          stage: 'commits',
          progress: 64,
        },
      }),
      { timezone: tz },
    );
    expect(running).toMatchObject({
      badge: { text: 'Importing history · 64%' },
      syncDisabledReason: 'A sync is already running',
    });
    const paused = describeIntegration(
      integration,
      status({
        state: 'waiting_rate_limit',
        currentRun: {
          ...(fx.syncRuns.data[0] as never as SyncStatusDto['currentRun'] & object),
          resumeAt: '2026-11-18T16:32:00.000Z',
        },
      }),
      { timezone: tz },
    );
    expect(paused.badge.text).toBe('Paused until 16:32');
    expect(
      describeIntegration({ ...integration, status: 'needs_reauth' }, status({}), {}),
    ).toMatchObject({
      primary: 'reconnect',
      badge: { text: 'Needs reconnection' },
    });
    const suspended = clone(integration);
    suspended.installations[1].suspended = true;
    expect(describeIntegration(suspended, status({}), {}).explanation).toMatch(
      /^acme suspended DevImpact/,
    );
    expect(
      describeIntegration(
        integration,
        status({ state: 'failed', lastRun: fx.syncRuns.data[1] }),
        {},
      ),
    ).toMatchObject({
      primary: 'retry',
      badge: { variant: 'danger' },
    });
    expect(scheduleLabel('2026-11-19T03:14:00.000Z', tz, NOW)).toBe('tomorrow at 03:14');
    expect(newItems({ counts: { created: 7 } })).toBe(7);
    expect(newItems({ counts: { prsAuthored: 1, reviews: 2, commits: 3 } })).toBe(6);
  });
});
