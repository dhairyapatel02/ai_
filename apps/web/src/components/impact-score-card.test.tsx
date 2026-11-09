import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ImpactScoreCard } from './impact-score-card';

describe('ImpactScoreCard', () => {
  it('shows the overall score and each breakdown dimension', () => {
    render(
      <ImpactScoreCard
        score={78}
        breakdown={{ featureDelivery: 80, codeQuality: 70, collaboration: 65, leadership: 55 }}
      />,
    );

    expect(screen.getByText('Impact Score')).toBeInTheDocument();
    expect(screen.getByText('78')).toBeInTheDocument();
    for (const [label, value] of [
      ['Features', '80'],
      ['Quality', '70'],
      ['Collab', '65'],
      ['Leadership', '55'],
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(value)).toBeInTheDocument();
    }
  });
});
