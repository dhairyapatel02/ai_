import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Sidebar } from './sidebar';

vi.mock('next/navigation', () => ({ usePathname: () => '/kpis' }));

describe('Sidebar', () => {
  it('lists every section and highlights the current route', () => {
    render(<Sidebar />);

    const labels = [
      'Dashboard',
      'Integrations',
      'Resume',
      'Appraisal',
      'Promotion',
      'Career Timeline',
      'KPIs',
      'Settings',
    ];
    for (const label of labels) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'KPIs' })).toHaveClass('text-primary');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveClass('bg-primary/10');
  });
});
