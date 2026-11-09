import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ActivityHeatmap } from './activity-heatmap';

describe('ActivityHeatmap', () => {
  it('renders one cell per day with intensity relative to the busiest day', () => {
    render(
      <ActivityHeatmap
        data={[
          { date: '2026-10-01', count: 0 },
          { date: '2026-10-02', count: 1 },
          { date: '2026-10-03', count: 4 },
        ]}
      />,
    );

    expect(screen.getByTitle('2026-10-01: 0 contributions')).toHaveClass('bg-secondary');
    expect(screen.getByTitle('2026-10-02: 1 contributions')).toHaveClass('bg-primary/25');
    expect(screen.getByTitle('2026-10-03: 4 contributions')).toHaveClass('bg-primary');
  });
});
