import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GenerateButton } from './generate-button';

describe('GenerateButton', () => {
  it('calls onClick with the provided label when idle', async () => {
    const onClick = vi.fn();
    render(
      <GenerateButton loading={false} onClick={onClick}>
        Generate resume bullets
      </GenerateButton>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate resume bullets' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is busy and announces progress while loading', () => {
    render(<GenerateButton loading onClick={vi.fn()} progress="Writing section 2 of 5" />);
    const button = screen.getByRole('button', { name: 'Generating…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Writing section 2 of 5')).toBeInTheDocument();
  });

  it('shows why it is disabled', () => {
    render(
      <GenerateButton
        loading={false}
        onClick={vi.fn()}
        disabledReason="You've used all 15 generations."
      />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByText("You've used all 15 generations.")).toBeInTheDocument();
  });
});
