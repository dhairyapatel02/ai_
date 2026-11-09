import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GenerateButton } from './generate-button';

describe('GenerateButton', () => {
  it('calls onClick with the provided label when idle', async () => {
    const onClick = vi.fn();
    render(
      <GenerateButton loading={false} onClick={onClick}>
        Generate Resume Bullets
      </GenerateButton>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Generate Resume Bullets' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and shows progress text while loading', () => {
    render(<GenerateButton loading onClick={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Generating...' });
    expect(button).toBeDisabled();
  });
});
