import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CareerDialogs } from '@/components/shell/career-dialogs';
import { fromDisplayValue, goalProgressPct, toDisplayValue } from '@/lib/achievements';

import { fail, pending, renderWithQuery, setRoutes, type Handler } from '../../../../test/api-mock';
import { clone, fx12, NOW } from '../../../../test/fixtures-p12';
import { nav, setUrl } from '../../../../test/navigation-mock';
import { GoalsView } from './goals-view';

vi.mock('@/lib/api/browser', async () => (await import('../../../../test/api-mock')).browserModule);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../test/navigation-mock')).navigationModule,
);
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));

function routes(overrides: Record<string, Handler | object> = {}) {
  setRoutes({
    'GET /me': fx12.me,
    'GET /goals': fx12.goals,
    'GET /goals/*': fx12.goalDetail,
    'GET /achievements': fx12.achievements,
    ...overrides,
  });
}
const view = () =>
  renderWithQuery(
    <>
      <GoalsView />
      <CareerDialogs />
    </>,
  );

describe('GoalsView (S18)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    setUrl('/goals');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loading, empty and error states', async () => {
    routes({ 'GET /goals': pending });
    const { unmount } = view();
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    unmount();
    routes({ 'GET /goals': { data: [], meta: { nextCursor: null, hasMore: false, total: 0 } } });
    const second = view();
    expect(
      await screen.findByRole('heading', { name: 'Set a goal you can measure' }),
    ).toBeInTheDocument();
    second.unmount();
    routes({ 'GET /goals': fail(500, 'INTERNAL') });
    view();
    expect(
      await screen.findByRole('heading', { name: "Couldn't load your goals" }),
    ).toBeInTheDocument();
  });

  it('success: status badges with icon + text, targets, current values, evaluated month in the lede', async () => {
    routes();
    view();
    const cards = await screen.findAllByTestId('goal-card');
    expect(cards).toHaveLength(3);
    expect(screen.getByText(/Progress is measured on October 2026/)).toBeInTheDocument();
    const byTitle = (t: string) => cards.find((c) => c.textContent.includes(t))!;
    const met = byTitle("Review teammates' PRs within a day");
    expect(within(met).getByText('On target')).toBeInTheDocument();
    expect(within(met).getByText(/≤ 15.0 h/)).toBeInTheDocument();
    expect(within(met).getByText('9.5 h')).toBeInTheDocument();
    expect(within(byTitle('Merge more small')).getByText('Not yet')).toBeInTheDocument();
    const plain = byTitle('Grow as a mentor');
    expect(within(plain).getByText('Tracked by achievements')).toBeInTheDocument();
    expect(within(plain).getByText('2 linked achievements')).toBeInTheDocument();
    expect(within(met).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('no_data shows "Not enough data in <month>"', async () => {
    const goals = clone(fx12.goals);
    const g = goals.data[1];
    g.progress = { ...g.progress, status: 'no_data', current: null };
    routes({ 'GET /goals': goals });
    view();
    expect(await screen.findByText('Not enough data in October 2026')).toBeInTheDocument();
    expect(screen.getByText('Not enough data')).toBeInTheDocument();
  });

  it('dialog: requires a goal and posts a goal without a metric', async () => {
    let body: unknown = null;
    routes({
      'POST /goals': (_q: unknown, b: unknown) => {
        body = b;
        return { data: fx12.goals.data[0] };
      },
    });
    view();
    await screen.findAllByTestId('goal-card');
    await userEvent.click(screen.getByRole('button', { name: 'Add goal' }));
    const dialog = await screen.findByTestId('goal-dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add goal' }));
    expect(within(dialog).getByText('Describe the goal in a few words')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Goal'), 'Give two talks');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add goal' }));
    await waitFor(() => {
      expect(body).toEqual({
        title: 'Give two talks',
        startDate: '2026-11-24',
        targetDate: '2026-12-31',
        metricTarget: null,
      });
    });
    expect(toast.success).toHaveBeenCalledWith('Goal added');
  });

  it('edit: unit-aware value validation and conversion; card menu marks achieved', async () => {
    let patched: unknown = null;
    routes({
      'PATCH /goals/*': (_q: unknown, b: unknown) => {
        patched = b;
        return { data: fx12.goals.data[2] };
      },
    });
    view();
    const met = fx12.goals.data.find(
      (g) => g.metricTarget?.metricKey === 'review_turnaround_median_hours',
    )!;
    await userEvent.click(await screen.findByRole('button', { name: `Options for ${met.title}` }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByTestId('goal-dialog');
    const value = within(dialog).getByLabelText('Value (hours)');
    expect(value).toHaveValue('15');
    await userEvent.clear(value);
    await userEvent.type(value, 'soon');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(within(dialog).getByText('Enter a number of hours')).toBeInTheDocument();
    await userEvent.clear(value);
    await userEvent.type(value, '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(patched).toMatchObject({
        metricTarget: {
          metricKey: 'review_turnaround_median_hours',
          comparator: 'lte',
          targetValue: 12,
        },
      });
    });

    await userEvent.click(screen.getByRole('button', { name: `Options for ${met.title}` }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark achieved' }));
    await waitFor(() => {
      expect(patched).toEqual({ status: 'achieved' });
    });
  });

  it('detail sheet (?goal=) lists linked achievements', async () => {
    setUrl(`/goals?goal=${fx12.goalDetail.data.id}`);
    routes();
    view();
    const sheet = await screen.findByTestId('goal-sheet');
    for (const a of fx12.goalDetail.data.achievements) {
      expect(await within(sheet).findByText(a.title)).toBeInTheDocument();
    }
    await userEvent.click(within(sheet).getByRole('button', { name: 'Link achievements' }));
    expect(await within(sheet).findAllByRole('checkbox')).toHaveLength(
      fx12.achievements.data.length,
    );
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('helpers: ratio display conversion and progress width', () => {
    expect(toDisplayValue('ratio', 0.755)).toBe(75.5);
    expect(fromDisplayValue('ratio', 80)).toBe(0.8);
    expect(toDisplayValue('hours', 8)).toBe(8);
    const g = clone(fx12.goals.data[1]);
    expect(goalProgressPct(g)).toBe(Math.round((5 / 11) * 100));
  });
});
