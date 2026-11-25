import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithQuery, setRoutes } from '../../../../test/api-mock';
import { fx } from '../../../../test/fixtures-p10';
import { fx13, NOW } from '../../../../test/fixtures-p13';
import { nav, setUrl } from '../../../../test/navigation-mock';
import { isEmptyQuarter, quarterTotals } from '../../../lib/career';
import { CareerView } from './career-view';

vi.mock('@/lib/api/browser', async () => (await import('../../../../test/api-mock')).browserModule);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../test/navigation-mock')).navigationModule,
);

describe('Career — issues completed (S10, P13)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    setUrl('/career');
    setRoutes({
      'GET /me': fx13.me,
      'GET /career/timeline': fx13.career,
      'GET /sync/status': fx.syncStatus,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists the quarter’s completed issues with keys; a click opens the issue drawer', async () => {
    renderWithQuery(<CareerView />);
    const groups = await screen.findAllByTestId('issues-completed');
    const q = fx13.career.data.quarters[0];
    expect(groups[0]).toHaveTextContent(`Issues completed· ${q.totals.issuesCompleted}`);
    const first = q.issues[0];
    expect(within(groups[0]).getByText(first.tags[0])).toBeInTheDocument();
    await userEvent.click(within(groups[0]).getByRole('button', { name: first.title }));
    expect(nav.push).toHaveBeenCalledWith(`/career?item=issue%3A${first.id}`, { scroll: false });
  });

  it('totals mention completed issues; a quarter with only issues is not empty', () => {
    expect(
      quarterTotals({
        prsMerged: 1,
        prsReviewed: 0,
        achievements: 0,
        issuesCompleted: 3,
        storyPoints: 8,
      }),
    ).toBe('1 merged · 0 reviewed · 3 issues completed');
    const only = { ...fx13.career.data.quarters[0], repos: [], milestones: [], achievements: [] };
    only.totals = { ...only.totals, prsMerged: 0, prsReviewed: 0 };
    expect(isEmptyQuarter(only)).toBe(false);
  });
});
