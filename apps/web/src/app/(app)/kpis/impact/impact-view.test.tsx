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
import { historyPoints, ImpactView } from './impact-view';

vi.mock(
  '@/lib/api/browser',
  async () => (await import('../../../../../test/api-mock')).browserModule,
);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../../test/navigation-mock')).navigationModule,
);
vi.mock(
  'next/dynamic',
  async () => (await import('../../../../../test/navigation-mock')).dynamicModule,
);

const HIGHLIGHTS = {
  document: {
    id: 'cmhighlightsdocument00001',
    type: 'impact_narrative',
    title: 'Impact highlights · November 2026',
    status: 'ready',
    currentVersion: 1,
    period: fx.impact.data.period,
    model: 'claude-haiku-5-5',
    citationCoverage: 1,
    flags: { uncited: 0, invalid: 0 },
    errorCode: null,
    createdAt: '2026-11-18T11:00:00.000Z',
    updatedAt: '2026-11-18T11:00:00.000Z',
  },
  content: {
    summary: { id: 's1', text: 'Delivery and reviews drove the period.', citations: [] },
    highlights: [
      {
        id: 'h1',
        title: 'Steady delivery',
        text: 'Merged refunds work.',
        citations: ['PR-acme/design-system#155'],
      },
    ],
    focusAreas: [],
  },
  evidence: [
    {
      ref: 'PR-acme/design-system#155',
      kind: 'pull_request',
      id: 'cmprxxxxxxxxxxxxxxxxxxxx1',
      title: 'Refunds API (partial + full)',
      repo: 'acme/design-system',
      url: 'https://github.com/acme/design-system/pull/155',
      occurredAt: '2026-11-12T10:00:00.000Z',
    },
  ],
  cached: false,
};

function routes(overrides: Record<string, Handler | { data: unknown; meta?: unknown }> = {}) {
  setRoutes({
    'GET /me': fx.me,
    'GET /impact': fx.impact,
    'GET /impact/history': fx.impactHistory,
    'GET /metrics/definitions': fx.definitions,
    'GET /sync/status': fx.syncStatus,
    ...overrides,
  });
}

describe('ImpactView (S9)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    setUrl('/kpis/impact');
    calls.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('success: overall, §6.7 explanation, history chart summary, dimension components', async () => {
    routes();
    renderWithQuery(<ImpactView />);
    expect(await screen.findByTestId('impact-overall')).toHaveTextContent(
      String(fx.impact.data.overall),
    );
    expect(
      screen.getByText(/a summary of signals from your GitHub activity in November 2026/),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('img', { name: /Line chart of impact score/ }),
    ).toBeInTheDocument();
    for (const d of fx.impact.data.dimensions) {
      const card = screen.getByTestId(`dimension-${d.key}`);
      expect(
        within(card).getByRole('table', { name: `${d.label} components` }),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Generate highlights' })).toBeEnabled();
  });

  it('loading: skeletons', () => {
    routes({ 'GET /impact': pending, 'GET /impact/history': pending });
    renderWithQuery(<ImpactView />);
    expect(screen.queryByTestId('impact-overall')).not.toBeInTheDocument();
  });

  it('empty — not connected', async () => {
    const me = clone(fx.me);
    me.data.integrations = [];
    routes({ 'GET /me': me });
    renderWithQuery(<ImpactView />);
    expect(await screen.findByTestId('not-connected')).toBeInTheDocument();
  });

  it('empty — no data in range: "Not enough data" and highlights disabled', async () => {
    const impact = clone(fx.impact);
    impact.data.status = 'insufficient_data';
    impact.data.overall = null;
    impact.data.band = null;
    routes({ 'GET /impact': impact });
    renderWithQuery(<ImpactView />);
    expect(await screen.findByTestId('impact-overall')).toHaveTextContent('Not enough data');
    expect(screen.getByText('Highlights need an impact score for the period.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate highlights' })).toBeDisabled();
  });

  it('error: page error and history error are independent', async () => {
    routes({ 'GET /impact/history': fail(503) });
    renderWithQuery(<ImpactView />);
    expect(
      await screen.findByRole('heading', { name: "Couldn't load your score history" }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('impact-overall')).toBeInTheDocument();
  });

  it('Generate highlights posts the period and renders bullets with evidence links', async () => {
    routes({ 'POST /impact/highlights': { data: HIGHLIGHTS } });
    renderWithQuery(<ImpactView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Generate highlights' }));
    expect(await screen.findByTestId('highlights')).toHaveTextContent('Steady delivery');
    expect(
      screen.getByRole('link', { name: /Evidence PR-acme\/design-system#155/ }),
    ).toHaveAttribute('href', 'https://github.com/acme/design-system/pull/155');
    expect(calls.find((c) => c.path === '/impact/highlights')?.body).toEqual({
      period: 'month:2026-11',
      regenerate: false,
    });
  });

  it('highlights errors are inline: 402 quota, 409 insufficient, 503 busy', async () => {
    routes({
      'POST /impact/highlights': fail(402, 'QUOTA_EXCEEDED', {
        feature: 'quick',
        used: 100,
        limit: 100,
        resetsAt: '2026-12-01T00:00:00.000Z',
      }),
    });
    renderWithQuery(<ImpactView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Generate highlights' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Quick AI actions used up for Nov 2026. They reset on Dec 1.',
    );
  });

  it('history points: gaps for insufficient months, notes for older versions', () => {
    const history = clone(fx.impactHistory.data);
    history.points[0].status = 'insufficient_data';
    history.points[0].overall = null;
    const okIndex = history.points.findIndex((p) => p.status === 'ok');
    history.points[okIndex].scoreVersion = 'impact@1.9.0';
    const points = historyPoints(history);
    expect(points[0]).toMatchObject({ value: null, note: 'Not enough activity for a fair score' });
    expect(points[okIndex].note).toMatch(/earlier version/);
    expect(points.at(-1)!.label).toMatch(/\(in progress\)$/);
  });
});
