import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DocumentPreview } from './document-preview';
import { shortRef } from './evidence-chip';

describe('DocumentPreview', () => {
  it('renders sections, evidence chips, flags and engine metrics labelled as calculated', () => {
    render(
      <DocumentPreview
        type="appraisal"
        content={{
          sections: {
            executiveSummary: { id: 'es1', text: 'Great quarter', citations: ['PR-acme/api#12'] },
            keyContributions: [
              { id: 'kc1', title: 'Refunds', text: 'Shipped refunds', citations: [], flags: ['uncited'] },
            ],
            metrics: [{ key: 'prs_merged', label: 'PRs merged', unit: 'count', value: 7, n: 7, status: 'ok' }],
          },
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Appraisal' })).toBeInTheDocument();
    expect(screen.getByText('Great quarter')).toBeInTheDocument();
    expect(screen.getByLabelText('Evidence PR-acme/api#12')).toHaveTextContent('api #12');
    expect(screen.getByText('No evidence linked')).toBeInTheDocument();
    expect(screen.getByText('Calculated by DevImpact — not written by AI')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'PRs merged' })).toBeInTheDocument();
  });

  it('marks imported v0.1 documents as read-only', () => {
    render(<DocumentPreview type="resume" content={{ legacy: true, raw: { summary: 'Old' } }} />);
    expect(screen.getByText(/Imported from DevImpact v0.1/)).toBeInTheDocument();
    expect(screen.getByText(/"summary": "Old"/)).toBeInTheDocument();
  });

  it('shortens refs for chips', () => {
    expect(shortRef('PR-harbor-io/payments-api#1935')).toBe('payments-api #1935');
    expect(shortRef('C-acme/api@abc1234')).toBe('api@abc1234');
  });
});
