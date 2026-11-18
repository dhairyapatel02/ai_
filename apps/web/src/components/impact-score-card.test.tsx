import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { bandIndex, ImpactScoreCard } from './impact-score-card';

const dimensions = [
  { key: 'delivery', label: 'Delivery', score: 73 },
  { key: 'quality', label: 'Quality', score: null },
  { key: 'collaboration', label: 'Collaboration', score: 82 },
  { key: 'ownership', label: 'Ownership', score: 61 },
];

describe('ImpactScoreCard', () => {
  it('shows the score out of 100, band and the four v2 dimensions', () => {
    render(<ImpactScoreCard score={78} band="Strong" dimensions={dimensions} scoreVersion="impact@2.0.0" />);
    expect(screen.getByRole('heading', { name: 'Impact score' })).toBeInTheDocument();
    expect(screen.getByTestId('impact-score-value')).toHaveTextContent('78');
    expect(screen.getByText('/ 100')).toBeInTheDocument();
    expect(screen.getAllByText('Strong').length).toBeGreaterThan(0);
    for (const label of ['Delivery', 'Quality', 'Collaboration', 'Ownership']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('impact@2.0.0')).toBeInTheDocument();
  });

  it('says "not enough data" instead of a number (AI-01)', () => {
    render(<ImpactScoreCard score={null} dimensions={dimensions.map((d) => ({ ...d, score: null }))} />);
    expect(screen.getByText(/Not enough activity in this period/)).toBeInTheDocument();
    expect(screen.getByTestId('impact-score-value')).toHaveTextContent('—');
  });

  it('has a loading state', () => {
    render(<ImpactScoreCard loading score={null} dimensions={[]} />);
    expect(screen.getByText('Loading impact score')).toBeInTheDocument();
  });

  it('maps scores to the impact@2.0.0 bands', () => {
    expect(bandIndex(39)).toBe(0);
    expect(bandIndex(40)).toBe(1);
    expect(bandIndex(79)).toBe(2);
    expect(bandIndex(100)).toBe(3);
  });
});
