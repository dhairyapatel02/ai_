import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithQuery, setRoutes, type Handler } from '../../../../test/api-mock';
import { fx } from '../../../../test/fixtures-p10';
import { clone, fx13, NOW } from '../../../../test/fixtures-p13';
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

function routes(overrides: Record<string, Handler | object> = {}) {
  setRoutes({
    'GET /me': fx13.me,
    'GET /metrics/kpis': fx13.kpis,
    'GET /metrics/definitions': fx13.definitions,
    'GET /metrics/trends': fx.trends,
    'GET /impact': fx.impact,
    'GET /sync/status': fx13.syncStatusGitlab,
    'GET /metrics/providers': fx13.providersBreakdown,
    ...overrides,
  });
}

describe('KPIs — Issues section and sources (S8, P13)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    setUrl('/kpis');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('success: Issues section with the three §3.6 metrics, never scored, and a By source table', async () => {
    const kpis = clone(fx13.kpis);
    const issues = kpis.data.sections.find((s) => s.key === 'issues')!;
    issues.metrics = issues.metrics.map((m) =>
      m.key === 'issues_completed' ? { ...m, value: 4, n: 4 } : m,
    );
    routes({ 'GET /metrics/kpis': kpis });
    renderWithQuery(<KpisView />);
    const section = await screen.findByRole('region', { name: 'Issues' });
    expect(within(section).getByText('Issues completed')).toBeInTheDocument();
    expect(within(section).getByText('Story points completed')).toBeInTheDocument();
    expect(within(section).getByText('Not part of the impact score')).toBeInTheDocument();
    const table = await screen.findByTestId('by-source');
    for (const row of fx13.providersBreakdown.data.providers) {
      expect(
        within(table).getByRole('rowheader', { name: new RegExp(row.provider, 'i') }),
      ).toBeInTheDocument();
    }
  });

  it('empty: no tracker connected → connect prompt instead of metric rows', async () => {
    const kpis = clone(fx13.kpis);
    kpis.data.sections = kpis.data.sections.map((s) =>
      s.key === 'issues' ? { ...s, available: false } : s,
    );
    routes({
      'GET /metrics/kpis': kpis,
      'GET /metrics/providers': {
        data: {
          ...fx13.providersBreakdown.data,
          providers: [fx13.providersBreakdown.data.providers[0]],
        },
      },
    });
    renderWithQuery(<KpisView />);
    const prompt = await screen.findByTestId('issues-not-connected');
    expect(within(prompt).getByRole('link', { name: 'Connect an issue tracker' })).toHaveAttribute(
      'href',
      '/settings/integrations',
    );
    expect(screen.queryByTestId('by-source')).not.toBeInTheDocument();
  });
});
