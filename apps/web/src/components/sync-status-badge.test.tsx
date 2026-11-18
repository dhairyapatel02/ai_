import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { syncRun, syncStatus } from '../../test/fixtures';
import { SyncStatusBadge } from './sync-status-badge';

describe('SyncStatusBadge', () => {
  it.each([
    ['not connected', null, 'Not connected'],
    [
      'syncing',
      syncStatus({ state: 'running', currentRun: syncRun({ kind: 'incremental', progress: 64 }) }),
      'Syncing · 64%',
    ],
    ['needs reconnection', syncStatus({ state: 'needs_reauth' }), 'Needs reconnection'],
    ['failed', syncStatus({ state: 'failed' }), 'Last sync failed'],
    ['never synced', syncStatus(), 'Not synced yet'],
  ] as const)('%s → text and icon (never colour alone)', (_name, status, text) => {
    render(<SyncStatusBadge status={status} />);
    const badge = screen.getByTestId('sync-status-badge');
    expect(badge).toHaveTextContent(text);
    expect(badge.querySelector('svg')).not.toBeNull();
  });

  it('shows the resume time while paused by the rate limit', () => {
    render(
      <SyncStatusBadge
        timezone="UTC"
        status={syncStatus({
          state: 'waiting_rate_limit',
          currentRun: syncRun({ resumeAt: '2026-11-18T16:32:00.000Z' }),
        })}
      />,
    );
    expect(screen.getByText('Paused until 16:32')).toBeInTheDocument();
  });
});
