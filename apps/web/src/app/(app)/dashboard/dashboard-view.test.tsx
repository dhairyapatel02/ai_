import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fail, pending, renderWithQuery, setRoutes, type Handler } from '../../../../test/api-mock';
import { clone, fx, NOW } from '../../../../test/fixtures-p10';
import { setUrl } from '../../../../test/navigation-mock';
import { comparisonLabel, DashboardView } from './dashboard-view';

vi.mock('@/lib/api/browser', async () => (await import('../../../../test/api-mock')).browserModule);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../test/navigation-mock')).navigationModule,
);
vi.mock(
  'next/dynamic',
  async () => (await import('../../../../test/navigation-mock')).dynamicModule,
);

function routes(overrides: Record<string, Handler | { data: unknown; meta?: unknown }> = {}) {
  setRoutes({
    'GET /me': fx.me,
    'GET /metrics/overview': fx.overview,
    'GET /impact': fx.impact,
    'GET /metrics/heatmap': fx.heatmap,
    'GET /metrics/definitions': fx.definitions,
    'GET /activity/feed': {
      data: fx.feed.data.slice(0, 7),
      meta: { nextCursor: null, hasMore: false },
    },
    'GET /sync/status': fx.syncStatus,
    'GET /integrations': fx.integrations,
    'GET /documents': { data: [], meta: { nextCursor: null, hasMore: false } },
    ...overrides,
  });
}

describe('DashboardView (S6)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    setUrl('/dashboard');
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('success: cards show the API numbers exactly, with the same-point comparison', async () => {
    routes();
    renderWithQuery(<DashboardView />);
    const card = (key: string) => fx.overview.data.cards.find((c) => c.key === key)!;
    expect(await screen.findByTestId('stat-commits')).toHaveTextContent(
      String(card('commits').value),
    );
    expect(screen.getByTestId('stat-prs_merged')).toHaveTextContent(
      String(card('prs_merged').value),
    );
    expect(screen.getByTestId('stat-prs_reviewed')).toHaveTextContent(
      String(card('prs_reviewed').value),
    );
    expect(screen.getByTestId('stat-impact')).toHaveTextContent(
      `${fx.overview.data.impact.overall}/ 100 · Strong`,
    );
    expect(screen.getAllByText('vs same point last month').length).toBeGreaterThan(0);
    // Activity chart summary, heatmap, feed and next step render.
    expect(
      await screen.findByRole('img', {
        name: /Stacked columns of commits, PRs merged and reviews per day for November 2026/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contributions' })).toBeInTheDocument();
    expect(await screen.findAllByTestId('feed-item')).toHaveLength(7);
    const next = await screen.findByTestId('next-step');
    expect(next).toHaveTextContent('Start your H2 2026 appraisal');
    expect(within(next).getByRole('link', { name: 'Draft appraisal' })).toHaveAttribute(
      'href',
      '/documents/new/appraisal?period=half%3A2026-H2',
    );
  });

  it('loading: skeletons, no zero-filled numbers', () => {
    routes({
      'GET /metrics/overview': pending,
      'GET /impact': pending,
      'GET /metrics/heatmap': pending,
    });
    renderWithQuery(<DashboardView />);
    expect(screen.queryByTestId('stat-commits')).not.toBeInTheDocument();
    expect(screen.getByText('Loading impact score')).toBeInTheDocument();
  });

  it('empty — not connected: setup checklist, no stats and no score', async () => {
    const me = clone(fx.me);
    me.data.integrations = [];
    routes({ 'GET /me': me, 'GET /sync/status': fail(404, 'NOT_FOUND') });
    renderWithQuery(<DashboardView />);
    expect(await screen.findByTestId('dashboard-first-run')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Set up DevImpact in three steps' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('stat-commits')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Impact score' })).not.toBeInTheDocument();
  });

  it('empty — syncing: lede says older history is importing', async () => {
    const status = clone(fx.syncStatus);
    status.data.state = 'running';
    status.data.currentRun = {
      ...fx.syncRuns.data[0],
      kind: 'backfill',
      status: 'running',
      progress: 64,
      recentWindowCompletedAt: '2026-11-18T11:00:00.000Z',
      finishedAt: null,
    } as never;
    routes({ 'GET /sync/status': status });
    renderWithQuery(<DashboardView />);
    expect(await screen.findByText(/importing older history/)).toBeInTheDocument();
    expect(
      await screen.findByText('Your last 30 days are ready. Older history is still loading.'),
    ).toBeInTheDocument();
  });

  it('empty — no data in range: real zeros, insufficient score with a longer-period action', async () => {
    const overview = clone(fx.overview);
    for (const c of overview.data.cards) {
      c.value = 0;
      c.n = 0;
      c.delta = 0;
    }
    overview.data.impact = { status: 'insufficient_data', overall: null, delta: null, band: null };
    const impact = clone(fx.impact);
    impact.data.status = 'insufficient_data';
    impact.data.overall = null;
    impact.data.band = null;
    const heatmap = clone(fx.heatmap);
    for (const d of heatmap.data.days) {
      Object.assign(d, { count: 0, commits: 0, prsOpened: 0, prsMerged: 0, reviews: 0 });
    }
    routes({
      'GET /metrics/overview': overview,
      'GET /impact': impact,
      'GET /metrics/heatmap': heatmap,
    });
    renderWithQuery(<DashboardView />);
    expect(
      await screen.findByText('No activity in November 2026.', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('stat-commits')).toHaveTextContent('0');
    expect(
      screen.getByText('Not enough activity in this period to compute a fair score'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Show Q4 2026' }).length).toBeGreaterThan(0);
  });

  it('partial: an unavailable dimension shows "—" and the re-weighting note', async () => {
    const impact = clone(fx.impact);
    const quality = impact.data.dimensions.find((d) => d.key === 'quality')!;
    quality.available = false;
    quality.score = null;
    routes({ 'GET /impact': impact });
    renderWithQuery(<DashboardView />);
    expect(
      await screen.findByText(
        /Quality isn't scored yet — not enough merged PRs in this period. The other dimensions were re-weighted./,
      ),
    ).toBeInTheDocument();
  });

  it('error: one failing widget shows an inline error, the others render', async () => {
    routes({ 'GET /impact': fail(503) });
    renderWithQuery(<DashboardView />);
    expect(
      await screen.findByRole('heading', { name: "Couldn't load your impact score" }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('stat-commits')).toBeInTheDocument();
  });

  it('error: the whole page when every core query fails, with the request ID', async () => {
    routes({
      'GET /metrics/overview': fail(),
      'GET /impact': fail(),
      'GET /metrics/heatmap': fail(),
    });
    renderWithQuery(<DashboardView />);
    expect(
      await screen.findByRole('heading', { name: "Couldn't load your dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByText('req-123')).toBeInTheDocument();
  });

  it('"Not now" hides the rule for 7 days and falls through to the next one', async () => {
    routes();
    renderWithQuery(<DashboardView />);
    const card = await screen.findByTestId('next-step');
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(within(card).getByRole('button', { name: 'Not now' }));
    expect(await screen.findByText('See what drove your impact score')).toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem('devimpact.nextStep.dismissed.v1') ?? '{}'),
    ).toHaveProperty('appraisal');
  });

  it('labels the comparison for complete periods with the previous period', () => {
    const overview = clone(fx.overview.data) as never as Parameters<typeof comparisonLabel>[0];
    expect(comparisonLabel(overview)).toBe('vs same point last month');
    expect(comparisonLabel({ ...overview!, comparison: 'full' })).toBe(
      `vs ${fx.overview.data.previousPeriod.label}`,
    );
  });
});
