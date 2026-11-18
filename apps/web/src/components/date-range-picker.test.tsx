import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DateRangePicker } from './date-range-picker';

describe('DateRangePicker', () => {
  it('validates the range inline and applies only on submit', async () => {
    const onApply = vi.fn();
    render(<DateRangePicker today="2026-11-18" value={{ from: '2026-11-15', to: '2026-11-18' }} onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: 'Apply range' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least 7 days.');
    expect(screen.getByLabelText('From')).toHaveAttribute('aria-invalid', 'true');

    const from = screen.getByLabelText('From');
    await userEvent.clear(from);
    await userEvent.type(from, '2026-10-01');
    await userEvent.click(screen.getByRole('button', { name: 'Apply range' }));
    expect(onApply).toHaveBeenCalledWith(
      { from: '2026-10-01', to: '2026-11-18' },
      'custom:2026-10-01..2026-11-18',
    );
  });
});
