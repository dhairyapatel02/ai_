import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DocumentPreview } from './document-preview';

describe('DocumentPreview', () => {
  it('titles the card by type and shows the content as formatted JSON (UX-04 baseline)', () => {
    render(<DocumentPreview type="APPRAISAL" content={{ executiveSummary: 'Great quarter' }} />);

    expect(screen.getByText('appraisal Document')).toBeInTheDocument();
    expect(screen.getByText(/"executiveSummary": "Great quarter"/)).toBeInTheDocument();
  });
});
