import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SyncStatusBadge } from './sync-status-badge';

describe('SyncStatusBadge', () => {
  it.each([
    ['syncing', 'Syncing'],
    ['complete', 'Synced'],
    ['error', 'Error'],
    ['idle', 'Idle'],
  ] as const)('status %s renders "%s"', (status, label) => {
    render(<SyncStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
