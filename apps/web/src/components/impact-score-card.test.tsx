import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ImpactScoreCard } from './impact-score-card';

const dimensions = [
  { key: 'delivery', label: 'Delivery', score: 73 },
  { key: 'quality', label: 'Quality', score: null },
  { key: 'collaboration', label: 'Collaboration', score: 82 },
  { key: 'ownership', label: 'Ownership', score: 61 },
];

describe('ImpactScoreCard', () => {
  it('shows the overall score, band and the four v2 dimensions', () => {
    render(
      <ImpactScoreCard
        score={78}
        band="Strong"
        dimensions={dimensions}
        scoreVersion="impact@2.0.0"
      />,
    );
    expect(screen.getByText('Impact Score')).toBeInTheDocument();
    expect(screen.getByText('78')).toBeInTheDocument();
    expect(screen.getByText('Strong')).toBeInTheDocument();
    for (const [label, value] of [
      ['Delivery', '73'],
      ['Collaboration', '82'],
      ['Ownership', '61'],
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByText('Quality')).toBeInTheDocument();
    expect(screen.queryByText('Leadership')).not.toBeInTheDocument();
  });

  it('says "not enough data" instead of showing a number (AI-01)', () => {
    render(
      <ImpactScoreCard score={null} dimensions={dimensions.map((d) => ({ ...d, score: null }))} />,
    );
    expect(screen.getByText(/Not enough activity in this period/)).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
