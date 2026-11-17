import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DocumentPreview } from './document-preview';

describe('DocumentPreview', () => {
  it('renders sections, claims with citation chips, flags and engine metrics', () => {
    render(
      <DocumentPreview
        type="APPRAISAL"
        content={{
          sections: {
            executiveSummary: { id: 'es1', text: 'Great quarter', citations: ['PR-acme/api#12'] },
            keyContributions: [
              {
                id: 'kc1',
                title: 'Refunds',
                text: 'Shipped refunds',
                citations: [],
                flags: ['uncited'],
              },
            ],
            metrics: [
              {
                key: 'prs_merged',
                label: 'PRs merged',
                unit: 'count',
                value: 7,
                n: 7,
                status: 'ok',
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText('appraisal Document')).toBeInTheDocument();
    expect(screen.getByText('Great quarter')).toBeInTheDocument();
    expect(screen.getByText('PR-acme/api#12')).toBeInTheDocument();
    expect(screen.getByText('No evidence linked')).toBeInTheDocument();
    expect(screen.getByText('PRs merged')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows imported v0.1 documents as raw JSON', () => {
    render(<DocumentPreview type="RESUME" content={{ legacy: true, raw: { summary: 'Old' } }} />);
    expect(screen.getByText(/"summary": "Old"/)).toBeInTheDocument();
  });
});
