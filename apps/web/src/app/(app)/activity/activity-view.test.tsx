import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calls,
  fail,
  pending,
  renderWithQuery,
  setRoutes,
  type Handler,
} from '../../../../test/api-mock';
import { clone, fx, NOW } from '../../../../test/fixtures-p10';
import { nav, setUrl } from '../../../../test/navigation-mock';
import { ActivityView, groupByDay, typesFor } from './activity-view';

vi.mock('@/lib/api/browser', async () => (await import('../../../../test/api-mock')).browserModule);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../test/navigation-mock')).navigationModule,
);
vi.mock(
  'next/dynamic',
  async () => (await import('../../../../test/navigation-mock')).dynamicModule,
);

const prItem = fx.feed.data.find((i) => i.type === 'pr_merged')!;

function routes(overrides: Record<string, Handler | { data: unknown; meta?: unknown }> = {}) {
  setRoutes({
    'GET /me': fx.me,
    'GET /activity/feed': fx.feed,
    'GET /repos': fx.repos,
    'GET /sync/status': fx.syncStatus,
    'GET /metrics/definitions': fx.definitions,
    'GET /metrics/evidence': fx.evidence,
    'GET /activity/prs/*': {
      data: {
        id: prItem.meta.recordId,
        ref: prItem.ref,
        repo: prItem.repo,
        number: prItem.meta.number,
        title: prItem.title,
        url: prItem.url,
        state: 'merged',
        isDraft: false,
        isAuthoredByUser: true,
        authorLogin: 'dana-demo',
        createdAt: '2026-11-10T10:00:00.000Z',
        readyAt: '2026-11-10T10:00:00.000Z',
        mergedAt: prItem.occurredAt,
        closedAt: prItem.occurredAt,
        additions: 111,
        deletions: 27,
        changedFiles: 15,
        cycleTimeHours: 19,
        firstReviewHours: 8,
        reverted: false,
        body: null,
        labels: ['payments'],
        reviewersCount: 2,
        approvalsCount: 2,
        changesRequestedCount: 0,
        myReviews: [],
        revertedByUrl: null,
        achievementIds: [],
      },
    },
    ...overrides,
  });
}

describe('ActivityView (S7)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    setUrl('/activity');
    calls.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('success: day-grouped feed, "Show more", excluded repositories note', async () => {
    routes();
    renderWithQuery(<ActivityView />);
    expect(await screen.findAllByTestId('feed-item')).toHaveLength(40);
    expect(screen.getByText(/40\+ items/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    expect(
      screen.getByText(/Excluded repositories never appear: acme\/legacy-monolith/),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wed, Nov 18' })).toBeInTheDocument();
  });

  it('URL filters: type chips set ?type= and send API types; ?q and ?repo are forwarded', async () => {
    const repo = fx.repos.data.find((r) => r.included)!;
    setUrl(`/activity?type=prs&q=refund&repo=${repo.id}`);
    routes();
    renderWithQuery(<ActivityView />);
    await screen.findAllByTestId('feed-item');
    const feedCall = calls.find((c) => c.path === '/activity/feed')!;
    expect(feedCall.query).toMatchObject({
      types: ['pr_opened', 'pr_merged', 'pr_closed'],
      q: 'refund',
      repoIds: [repo.id],
    });
    expect(screen.getByRole('button', { name: 'Pull requests' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reviews' }));
    expect(nav.push).toHaveBeenCalledWith(expect.stringContaining('type=review'), {
      scroll: false,
    });
  });

  it('loading: skeleton rows', () => {
    routes({ 'GET /activity/feed': pending });
    renderWithQuery(<ActivityView />);
    expect(screen.getByText('Loading activity…')).toBeInTheDocument();
  });

  it('empty — no match: designed message + Clear filters', async () => {
    setUrl('/activity?q=zzz');
    routes({ 'GET /activity/feed': { data: [], meta: { nextCursor: null, hasMore: false } } });
    renderWithQuery(<ActivityView />);
    expect(
      await screen.findByRole('heading', { name: 'No activity matches these filters' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(nav.push).toHaveBeenCalledWith('/activity', { scroll: false });
  });

  it('empty — not connected: Connect GitHub', async () => {
    const me = clone(fx.me);
    me.data.integrations = [];
    routes({ 'GET /me': me });
    renderWithQuery(<ActivityView />);
    expect(await screen.findByTestId('not-connected')).toBeInTheDocument();
  });

  it('error: panel error with Retry', async () => {
    routes({ 'GET /activity/feed': fail(503) });
    renderWithQuery(<ActivityView />);
    expect(
      await screen.findByRole('heading', { name: "Couldn't load your activity" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('?item= opens the PR drawer with metrics wells and the achievement action', async () => {
    setUrl(`/activity?item=pr_merged:${prItem.meta.recordId as string}`);
    routes();
    renderWithQuery(<ActivityView />);
    const drawer = await screen.findByTestId('item-drawer');
    expect(await screen.findByRole('heading', { name: prItem.title })).toBeInTheDocument();
    expect(drawer).toHaveTextContent('19.0 h');
    expect(drawer).toHaveTextContent('+111 −27');
    expect(drawer).toHaveTextContent('2 approvals');
    expect(screen.getByRole('button', { name: /Turn into achievement/ })).toBeInTheDocument();
  });

  it('"Turn into achievement": 402 shows the quota message', async () => {
    setUrl(`/activity?item=pr_merged:${prItem.meta.recordId as string}`);
    routes({
      'POST /ai/achievement-statement': fail(402, 'QUOTA_EXCEEDED', {
        feature: 'quick',
        used: 100,
        limit: 100,
        resetsAt: '2026-12-01T00:00:00.000Z',
      }),
    });
    renderWithQuery(<ActivityView />);
    await userEvent.click(await screen.findByRole('button', { name: /Turn into achievement/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Quick AI actions used up for this month',
    );
  });

  it('"Turn into achievement": shows the drafted statement and that saving comes with Achievements', async () => {
    setUrl(`/activity?item=pr_merged:${prItem.meta.recordId as string}`);
    routes({
      'POST /ai/achievement-statement': {
        data: {
          title: 'Shipped refunds',
          statement: 'Delivered partial refunds.',
          category: 'delivery',
          citations: [prItem.ref],
          cached: false,
        },
      },
    });
    renderWithQuery(<ActivityView />);
    await userEvent.click(await screen.findByRole('button', { name: /Turn into achievement/ }));
    expect(await screen.findByTestId('achievement-draft')).toHaveTextContent('Shipped refunds');
    expect(
      screen.getByText(/Saving achievements arrives with the Achievements page/),
    ).toBeInTheDocument();
  });

  it('?metric= lists the metric evidence (A-2)', async () => {
    setUrl('/activity?metric=pr_cycle_time_median_hours');
    routes();
    renderWithQuery(<ActivityView />);
    expect(await screen.findByTestId('evidence-list')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Showing the evidence behind/)).toHaveTextContent(
        'PR cycle time (median)',
      );
    });
  });

  it('helpers: type filter mapping and day grouping', () => {
    expect(typesFor('all')).toBeUndefined();
    expect(typesFor('commit')).toEqual(['commit']);
    const groups = groupByDay(
      [
        { at: '2026-11-18T09:00:00Z' },
        { at: '2026-11-18T01:00:00Z' },
        { at: '2026-11-17T23:30:00Z' },
      ],
      (i) => i.at,
      'Europe/London',
    );
    expect(groups.map((g) => [g.day, g.items.length])).toEqual([
      ['2026-11-18', 2],
      ['2026-11-17', 1],
    ]);
  });
});
