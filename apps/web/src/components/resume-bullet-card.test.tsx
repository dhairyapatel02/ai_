import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ResumeBulletCard } from './resume-bullet-card';

describe('ResumeBulletCard', () => {
  it('renders the bullet text, category badge and impact line', () => {
    render(
      <ResumeBulletCard
        bullet={{ text: 'Cut p95 latency by 40%', impact: 'Faster checkout' }}
        category="performance"
      />,
    );

    expect(screen.getByText('Cut p95 latency by 40%')).toBeInTheDocument();
    expect(screen.getByText('performance')).toHaveClass('bg-orange-100');
    expect(screen.getByText('Impact: Faster checkout')).toBeInTheDocument();
  });

  it('falls back to a neutral badge and hides an empty impact', () => {
    render(<ResumeBulletCard bullet={{ text: 'Did a thing', impact: '' }} category="other" />);

    expect(screen.getByText('other')).toHaveClass('bg-gray-100');
    expect(screen.queryByText(/Impact:/)).not.toBeInTheDocument();
  });
});
