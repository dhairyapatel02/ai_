import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EvidenceChip } from '@/components/evidence-chip';

import {
  calls,
  fail,
  pending,
  renderWithQuery,
  setRoutes,
  type Handler,
} from '../../../../test/api-mock';
import { clone, fx, NOW } from '../../../../test/fixtures-p10';
import { fx12 } from '../../../../test/fixtures-p12';
import { nav, setUrl } from '../../../../test/navigation-mock';
import { quarterTotals, reviewClusterLabel } from '../../../lib/career';
import { CareerView } from './career-view';
import { parseYear } from './year';

vi.mock('@/lib/api/browser', async () => (await import('../../../../test/api-mock')).browserModule);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../test/navigation-mock')).navigationModule,
);

function routes(overrides: Record<string, Handler | { data: unknown; meta?: unknown }> = {}) {
  setRoutes({
    'GET /me': fx.me,
    'GET /career/timeline': fx.career,
    'GET /sync/status': fx.syncStatus,
    ...overrides,
  });
}

describe('CareerView (S10)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    setUrl('/career');
    calls.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('success: quarters newest first, milestones, repos, review clusters and "Show N more"', async () => {
    routes();
    renderWithQuery(<CareerView />);
    const timeline = await screen.findByTestId('career-timeline');
    const headings = within(timeline)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(headings[0]).toBe('Q4 2026');
    expect(headings).toEqual([...headings].sort().reverse());
    const q4 = screen.getByTestId('quarter-4');
    expect(q4).toHaveTextContent('In progress');
    expect(q4).toHaveTextContent(/Longest active-week streak/);
    expect(
      within(q4).getAllByText(/Reviewed \d+ pull requests? by teammates/).length,
    ).toBeGreaterThan(0);
    const more = within(q4).getByRole('button', { name: /Show \d+ more/ });
    await userEvent.click(more);
    expect(within(q4).getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('year filter syncs ?year= and is sent to the API; print view keeps the year', async () => {
    setUrl('/career?year=2026');
    const career = clone(fx.career);
    career.data.years = [2026, 2025];
    routes({ 'GET /career/timeline': career });
    renderWithQuery(<CareerView />);
    await screen.findByTestId('career-timeline');
    expect(calls.find((c) => c.path === '/career/timeline')?.query).toEqual({ year: 2026 });
    expect(screen.getByRole('radio', { name: '2026' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: '2025' }));
    expect(nav.push).toHaveBeenCalledWith('/career?year=2025', { scroll: false });
    expect(screen.getByRole('link', { name: 'Print view' })).toHaveAttribute(
      'href',
      '/career/print?year=2026',
    );
  });

  it('empty year: designed message', async () => {
    const career = clone(fx.career);
    career.data.quarters = career.data.quarters.map((q) => ({
      ...q,
      repos: [],
      milestones: [],
      totals: { prsMerged: 0, prsReviewed: 0, achievements: 0 },
    }));
    routes({ 'GET /career/timeline': career });
    renderWithQuery(<CareerView />);
    expect(
      await screen.findByRole('heading', {
        name: 'No merged work, reviews or achievements in 2026.',
      }),
    ).toBeInTheDocument();
  });

  it('loading, not connected and error states', async () => {
    routes({ 'GET /career/timeline': pending });
    const { unmount } = renderWithQuery(<CareerView />);
    expect(screen.getByText('Loading your timeline…')).toBeInTheDocument();
    unmount();

    routes({ 'GET /career/timeline': fail(503) });
    const second = renderWithQuery(<CareerView />);
    expect(
      await screen.findByRole('heading', { name: "Couldn't load your career timeline" }),
    ).toBeInTheDocument();
    second.unmount();

    const me = clone(fx.me);
    me.data.integrations = [];
    routes({ 'GET /me': me });
    renderWithQuery(<CareerView />);
    expect(await screen.findByTestId('not-connected')).toBeInTheDocument();
  });

  it('P12: "Beyond code" lists the quarter\'s achievements and opens the achievement drawer', async () => {
    routes({
      'GET /career/timeline': fx12.career,
      'GET /achievements/*': { data: fx12.achievements.data[0] },
    });
    renderWithQuery(<CareerView />);
    const beyond = (await screen.findAllByTestId('beyond-code'))[0];
    const first = fx12.career.data.quarters.find((q) => q.achievements.length)!.achievements[0];
    await userEvent.click(within(beyond).getByRole('button', { name: first.title }));
    expect(nav.push).toHaveBeenCalledWith(`/career?item=achievement%3A${first.id}`, {
      scroll: false,
    });
    expect(quarterTotals({ prsMerged: 0, prsReviewed: 0, achievements: 2 })).toBe(
      '0 merged · 0 reviewed · 2 achievements',
    );
  });

  it('P12: an achievement ref in an evidence chip links to its drawer (GAP-18)', async () => {
    const a = fx12.achievements.data[0];
    renderWithQuery(
      <EvidenceChip
        refId={a.ref}
        evidence={{
          ref: a.ref,
          kind: 'achievement',
          id: a.id,
          title: a.title,
          repo: null,
          url: null,
          occurredAt: `${a.occurredOn}T12:00:00.000Z`,
        }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: `Evidence ${a.ref}` }));
    expect(await screen.findByRole('link', { name: 'Details' })).toHaveAttribute(
      'href',
      `/achievements?item=achievement:${a.id}`,
    );
    expect(screen.queryByRole('link', { name: /GitHub/ })).not.toBeInTheDocument();
  });

  it('UX-10 / BUG-13: plurals and year parsing', () => {
    expect(reviewClusterLabel(1)).toBe('Reviewed 1 pull request by teammates');
    expect(reviewClusterLabel(14)).toBe('Reviewed 14 pull requests by teammates');
    expect(quarterTotals({ prsMerged: 1, prsReviewed: 2, achievements: 1 })).toBe(
      '1 merged · 2 reviewed · 1 achievement',
    );
    expect(parseYear('2025')).toBe(2025);
    expect(parseYear('20x5')).toBeUndefined();
    expect(parseYear('1999')).toBeUndefined();
  });
});
