import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fail, pending, renderWithQuery, setRoutes, type Handler } from '../../../../test/api-mock';
import { clone, fx, NOW } from '../../../../test/fixtures-p10';
import { setUrl } from '../../../../test/navigation-mock';
import { KpisView } from './kpis-view';

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
    'GET /metrics/kpis': fx.kpis,
    'GET /metrics/definitions': fx.definitions,
    'GET /metrics/trends': fx.trends,
    'GET /impact': fx.impact,
    'GET /sync/status': fx.syncStatus,
    'GET /metrics/timeseries': fx.timeseries,
    'GET /metrics/evidence': fx.evidence,
    ...overrides,
  });
}

describe('KpisView (S8)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    setUrl('/kpis');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('success: five sections, catalogue labels, values exactly as the API, sparklines', async () => {
    routes();
    renderWithQuery(<KpisView />);
    for (const section of fx.kpis.data.sections) {
      expect(
        await screen.findByRole('heading', { name: section.title, level: 2 }),
      ).toBeInTheDocument();
    }
    const merged = fx.kpis.data.sections[0].metrics.find((m) => m.key === 'prs_merged')!;
    expect(screen.getByTestId('metric-value-prs_merged')).toHaveTextContent(String(merged.value));
    const cycle = fx.kpis.data.sections[0].metrics.find(
      (m) => m.key === 'pr_cycle_time_median_hours',
    )!;
    expect(screen.getByTestId('metric-value-pr_cycle_time_median_hours')).toHaveTextContent(
      `${cycle.value!.toFixed(1)} h`,
    );
    for (const def of fx.definitions.data.metrics.filter((d) => !d.deferred)) {
      expect(screen.getAllByText(def.label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByTestId('sparkline').length).toBeGreaterThan(10);
    expect(screen.getByTestId('section-score-delivery')).toHaveTextContent('weight 30%');
    expect(screen.getByRole('link', { name: /Impact score/ })).toHaveTextContent(
      String(fx.impact.data.overall),
    );
  });

  it('partial: "Not enough data · n = x of y needed" and Low sample badges', async () => {
    const kpis = clone(fx.kpis);
    const m = kpis.data.sections[0].metrics.find((x) => x.key === 'pr_cycle_time_median_hours')!;
    m.status = 'insufficient_data';
    m.value = null;
    m.n = 2;
    routes({ 'GET /metrics/kpis': kpis });
    renderWithQuery(<KpisView />);
    const row = await screen.findByTestId('metric-pr_cycle_time_median_hours');
    expect(row).toHaveTextContent('Not enough data');
    expect(row).toHaveTextContent('n = 2 of 3 needed');
    expect(
      within(screen.getByTestId('metric-merge_rate')).getByText('Low sample'),
    ).toBeInTheDocument();
  });

  it('loading: section skeletons', () => {
    routes({ 'GET /metrics/kpis': pending });
    renderWithQuery(<KpisView />);
    expect(screen.getByText('Loading your KPIs…')).toBeInTheDocument();
  });

  it('empty — not connected: connect + definitions still browsable', async () => {
    const me = clone(fx.me);
    me.data.integrations = [];
    routes({ 'GET /me': me });
    renderWithQuery(<KpisView />);
    expect(await screen.findByTestId('not-connected')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'How metrics work' })).toBeInTheDocument();
  });

  it('error: page error state', async () => {
    routes({ 'GET /metrics/kpis': fail(500, 'INTERNAL') });
    renderWithQuery(<KpisView />);
    expect(
      await screen.findByRole('heading', { name: "Couldn't load your KPIs" }),
    ).toBeInTheDocument();
  });

  it('?metric= restores the explain drawer: definition, formula, good range, caveats, evidence, version', async () => {
    setUrl('/kpis?metric=pr_cycle_time_median_hours');
    routes();
    renderWithQuery(<KpisView />);
    const drawer = await screen.findByTestId('explain-drawer');
    const def = fx.definitions.data.metrics.find((d) => d.key === 'pr_cycle_time_median_hours')!;
    expect(await within(drawer).findByText(def.formula)).toBeInTheDocument();
    expect(within(drawer).getByText(def.goodRange)).toBeInTheDocument();
    expect(within(drawer).getByText(def.caveats[0])).toBeInTheDocument();
    expect(within(drawer).getByText("Why gaming it doesn't help")).toBeInTheDocument();
    expect(await within(drawer).findByRole('link', { name: 'Open in Activity' })).toHaveAttribute(
      'href',
      '/activity?metric=pr_cycle_time_median_hours',
    );
    expect(within(drawer).getByText(/Times in Europe\/London/)).toBeInTheDocument();
    expect(
      await within(drawer).findByRole('img', {
        name: /Columns of PR cycle time \(median\) per month/,
      }),
    ).toBeInTheDocument();
  });

  it('explain drawer: timeseries error is inline while the definition renders', async () => {
    setUrl('/kpis?metric=pr_cycle_time_median_hours');
    routes({ 'GET /metrics/timeseries': fail(503) });
    renderWithQuery(<KpisView />);
    const drawer = await screen.findByTestId('explain-drawer');
    expect(
      await within(drawer).findByRole('heading', { name: "Couldn't load the last 6 months" }),
    ).toBeInTheDocument();
    expect(within(drawer).getByRole('heading', { name: 'Formula' })).toBeInTheDocument();
  });
});
