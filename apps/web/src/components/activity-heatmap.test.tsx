import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ActivityHeatmap, heatLevels, heatmapWeeks } from './activity-heatmap';

const days = [
  { date: '2026-10-05', count: 0 }, // Monday
  { date: '2026-10-06', count: 1 },
  { date: '2026-10-07', count: 2 },
  { date: '2026-10-08', count: 3 },
  { date: '2026-10-09', count: 8 },
  { date: '2026-11-02', count: 4 },
];

describe('ActivityHeatmap', () => {
  it('buckets active days by quartile into 4 levels; zero is level 0', () => {
    const level = heatLevels(days);
    expect(level(0)).toBe(0);
    expect(level(1)).toBe(1);
    expect(level(8)).toBe(4);
  });

  it('lays days out in Monday-first weeks', () => {
    const weeks = heatmapWeeks([{ date: '2026-10-07', count: 1 }]); // Wednesday
    expect(weeks[0]?.slice(0, 2)).toEqual([null, null]);
    expect(weeks[0]?.[2]).toEqual({ date: '2026-10-07', count: 1 });
  });

  it('renders cells with tooltips, a summary for screen readers and a table toggle', async () => {
    render(<ActivityHeatmap days={days} />);
    expect(screen.getByTitle('2026-10-09: 8 contributions')).toHaveAttribute('data-level', '4');
    expect(screen.getByTitle('2026-10-05: 0 contributions')).toHaveClass('bg-heat-0');
    expect(screen.getByRole('img')).toHaveAccessibleName(
      /18 contributions on 5 active days from 2026-10-05 to 2026-11-02/,
    );
    const toggle = screen.getByRole('button', { name: 'View as table' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Oct 2026 14/ })).toBeInTheDocument();
  });
});
