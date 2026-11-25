import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CareerDialogs } from '@/components/shell/career-dialogs';

import {
  calls,
  fail,
  pending,
  renderWithQuery,
  setRoutes,
  type Handler,
} from '../../../../test/api-mock';
import { fx12, NOW } from '../../../../test/fixtures-p12';
import { nav, setUrl } from '../../../../test/navigation-mock';
import { AchievementsView } from './achievements-view';

vi.mock('@/lib/api/browser', async () => (await import('../../../../test/api-mock')).browserModule);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../test/navigation-mock')).navigationModule,
);

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));

const empty = { data: [], meta: { nextCursor: null, hasMore: false, total: 0 } };

function routes(overrides: Record<string, Handler | object> = {}) {
  setRoutes({
    'GET /me': fx12.me,
    'GET /achievements': fx12.achievements,
    'GET /activity/feed': { data: [], meta: { nextCursor: null, hasMore: false } },
    ...overrides,
  });
}

const view = () =>
  renderWithQuery(
    <>
      <AchievementsView />
      <CareerDialogs />
    </>,
  );

describe('AchievementsView (S17)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    setUrl('/achievements');
    calls.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loading: skeleton rows', () => {
    routes({ 'GET /achievements': pending });
    view();
    expect(screen.getByText('Loading your achievements…')).toBeInTheDocument();
  });

  it('empty: explains the journal and offers Add achievement (works without GitHub)', async () => {
    routes({ 'GET /achievements': empty });
    view();
    expect(
      await screen.findByRole('heading', { name: "Capture the work GitHub can't see" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add achievement' }).length).toBeGreaterThan(1);
  });

  it('empty — filter: names the category', async () => {
    setUrl('/achievements?category=mentoring');
    routes({ 'GET /achievements': empty });
    view();
    expect(
      await screen.findByRole('heading', { name: 'No mentoring achievements yet' }),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/achievements')?.query).toMatchObject({
      category: 'mentoring',
    });
  });

  it('error: panel error with Try again', async () => {
    routes({ 'GET /achievements': fail(503, 'UPSTREAM_UNAVAILABLE') });
    view();
    expect(
      await screen.findByRole('heading', { name: "Couldn't load your achievements" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('success: grouped by month with category, evidence chips and links; chips set ?category=', async () => {
    routes();
    view();
    const list = await screen.findByTestId('achievement-list');
    expect(within(list).getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    expect(within(list).getAllByTestId('achievement-row')).toHaveLength(
      fx12.achievements.data.length,
    );
    expect(screen.getByText(/6 achievements · cited as evidence/)).toBeInTheDocument();
    const incident = fx12.achievements.data.find((a) => a.category === 'incident')!;
    expect(within(list).getByRole('button', { name: incident.title })).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: /Postmortem/ })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(within(list).getAllByRole('button', { name: /^Evidence / }).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Incident' }));
    expect(nav.replace).toHaveBeenCalledWith('/achievements?category=incident', { scroll: false });
    await userEvent.click(within(list).getByRole('button', { name: incident.title }));
    expect(nav.push).toHaveBeenCalledWith(`/achievements?item=achievement%3A${incident.id}`, {
      scroll: false,
    });
  });

  it('quick-add: validates title and future dates, then saves and toasts', async () => {
    let body: unknown = null;
    routes({
      'POST /achievements': (_q: unknown, b: unknown) => {
        body = b;
        return { data: fx12.achievements.data[1] };
      },
    });
    view();
    await screen.findByTestId('achievement-list');
    await userEvent.click(screen.getAllByRole('button', { name: 'Add achievement' })[0]);
    const dialog = await screen.findByTestId('achievement-dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save achievement' }));
    expect(within(dialog).getByText('Add a short title')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Title')).toHaveFocus();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Ran the incident review');
    const date = within(dialog).getByLabelText('Date');
    await userEvent.clear(date);
    await userEvent.type(date, '2027-01-01');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save achievement' }));
    expect(within(dialog).getByText("Choose a date that isn't in the future")).toBeInTheDocument();
    await userEvent.clear(date);
    await userEvent.type(date, '2026-11-20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a link' }));
    await userEvent.type(within(dialog).getByLabelText('Link 1 URL'), 'ftp://nope');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save achievement' }));
    expect(within(dialog).getByText('Enter links that start with https://')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText('Link 1 URL'));
    await userEvent.type(within(dialog).getByLabelText('Link 1 URL'), 'https://example.com/review');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save achievement' }));
    await waitFor(() => {
      expect(body).toEqual({
        title: 'Ran the incident review',
        category: 'delivery',
        occurredOn: '2026-11-20',
        impact: null,
        links: [{ url: 'https://example.com/review' }],
        evidence: [],
        source: 'manual',
      });
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Achievement saved', expect.anything());
    });
  });

  it('save error stays inline above the footer with values kept', async () => {
    routes({ 'POST /achievements': fail(503, 'UPSTREAM_UNAVAILABLE') });
    view();
    await screen.findByTestId('achievement-list');
    await userEvent.click(screen.getAllByRole('button', { name: 'Add achievement' })[0]);
    const dialog = await screen.findByTestId('achievement-dialog');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Kept');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save achievement' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "Couldn't save the achievement",
    );
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Kept');
  });

  it('delete hides the row with a 7 s Undo toast; Undo restores it without a request', async () => {
    vi.useRealTimers();
    routes({ 'DELETE /achievements/*': { data: { deleted: true } } });
    view();
    const list = await screen.findByTestId('achievement-list');
    const first = fx12.achievements.data[0];
    await userEvent.click(within(list).getByRole('button', { name: `Options for ${first.title}` }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => {
      expect(within(list).queryByRole('button', { name: first.title })).not.toBeInTheDocument();
    });
    const [message, options] = toast.mock.calls.at(-1) as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe(`Deleted “${first.title}”`);
    expect(options.action.label).toBe('Undo');
    act(() => {
      options.action.onClick();
    });
    expect(await within(list).findByRole('button', { name: first.title })).toBeInTheDocument();
    expect(calls.some((c) => c.method.toLowerCase() === 'delete')).toBe(false);
  });
});
