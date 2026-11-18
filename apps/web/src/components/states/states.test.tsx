import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errors';

import { Banner, ConfirmDialog, DataTable, DeltaText, EmptyState, ErrorState, StatCard } from './index';

describe('state components', () => {
  it('EmptyState: icon tile, heading, reason and actions', () => {
    render(<EmptyState title="No activity in Q3 2026" description="Try a longer period." actions={<button type="button">Change period</button>} />);
    expect(screen.getByRole('heading', { level: 2, name: 'No activity in Q3 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change period' })).toBeInTheDocument();
  });

  it('ErrorState: friendly copy, retry and the request ID', async () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new ApiError({ code: 'INTERNAL', message: 'raw', status: 500, requestId: 'req-42' })} what="your KPIs" onRetry={onRetry} />);
    expect(screen.getByRole('heading', { name: "Couldn't load your KPIs" })).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong on our side/)).toBeInTheDocument();
    expect(screen.getByText('req-42')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('StatCard: insufficient data is a dash with a reason, never 0', () => {
    render(<StatCard label="PRs merged" value={0} state="insufficient" insufficientNote="Not enough data · n = 2" testId="s" />);
    expect(screen.getByTestId('s')).toHaveTextContent('—');
    expect(screen.getByText('Not enough data · n = 2')).toBeInTheDocument();
  });

  it('DeltaText: neutral arrow with hidden direction and units', () => {
    const { container } = render(<DeltaText delta={-0.09} unit="ratio" comparison="vs same point last month" />);
    expect(container).toHaveTextContent('down9 ptsvs same point last month');
    expect(container.innerHTML).not.toMatch(/destructive|success/);
  });

  it('Banner: status role with icon + text', () => {
    render(<Banner tone="warning" title="GitHub needs to be reconnected">Your data is kept.</Banner>);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('GitHub needs to be reconnected');
    expect(banner.querySelector('svg')).not.toBeNull();
  });

  it('DataTable: sortable headers with aria-sort and pagination', async () => {
    const rows = [
      { id: 'a', name: 'alpha', n: 3 },
      { id: 'b', name: 'bravo', n: 10 },
      { id: 'c', name: 'charlie', n: 1 },
    ];
    render(
      <DataTable
        caption="Repositories"
        rows={rows}
        rowKey={(r) => r.id}
        pageSize={2}
        columns={[
          { key: 'name', header: 'Name', cell: (r) => r.name },
          { key: 'n', header: 'PRs', cell: (r) => r.n, sortValue: (r) => r.n, align: 'right' },
        ]}
      />,
    );
    const prs = screen.getByRole('columnheader', { name: /PRs/ });
    expect(prs).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(within(prs).getByRole('button'));
    expect(prs).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('bravo');
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('charlie')).toBeInTheDocument();
  });

  it('ConfirmDialog: typed confirmation gates destructive actions', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open onOpenChange={vi.fn()} title="Delete your account?" confirmLabel="Delete account" destructive typedConfirmation="delete" onConfirm={onConfirm} />,
    );
    const confirm = screen.getByRole('button', { name: 'Delete account' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Type delete to confirm/), 'delete');
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalled();
  });
});
