'use client';

import type { SyncStatusDto } from '@devimpact/shared';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  LoaderCircle,
  TriangleAlert,
} from 'lucide-react';

import { describeSync, type SyncTone } from '@/components/shell/sync-status';
import { Badge } from '@/components/ui/badge';

const VARIANT: Record<SyncTone, 'success' | 'accent' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success',
  active: 'accent',
  warning: 'warning',
  danger: 'danger',
  none: 'neutral',
};

/**
 * Status badge for a GitHub connection (icon + text, never colour alone — WCAG 1.4.1). Same copy
 * as the shell's SyncStatus: synced, syncing (%), paused until HH:MM, needs reconnection, failed.
 */
export function SyncStatusBadge({
  status,
  timezone,
  loading,
}: {
  status: SyncStatusDto | null | undefined;
  timezone?: string;
  loading?: boolean;
}) {
  const sync = describeSync(status, { loading, timezone });
  const Icon =
    sync.tone === 'ok'
      ? CircleCheck
      : sync.tone === 'active'
        ? LoaderCircle
        : sync.tone === 'danger'
          ? CircleAlert
          : sync.tone === 'warning'
            ? status?.state === 'waiting_rate_limit'
              ? Clock
              : TriangleAlert
            : CircleDashed;
  return (
    <Badge variant={VARIANT[sync.tone]} data-testid="sync-status-badge">
      <Icon className={sync.tone === 'active' ? 'animate-spin' : undefined} aria-hidden="true" />
      {sync.text}
    </Badge>
  );
}
