import { render, screen } from '@testing-library/react';
import { Plus } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Badge } from './badge';
import { Button } from './button';

describe('design-system primitives', () => {
  it('Button: variants map to tokens, loading keeps the label and sets aria-busy', () => {
    const { rerender } = render(
      <Button variant="secondary">
        <Plus aria-hidden="true" />
        New
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'New' });
    expect(button.className).toContain('border-border-strong');
    rerender(
      <Button loading>
        <Plus aria-hidden="true" />
        Save
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('Badge: status variants use semantic tokens, never palette colours', () => {
    render(<Badge variant="warning">Low sample</Badge>);
    const badge = screen.getByText('Low sample');
    expect(badge.className).toContain('bg-warning-soft');
    expect(badge.className).not.toMatch(/(amber|green|red)-\d/);
  });
});
