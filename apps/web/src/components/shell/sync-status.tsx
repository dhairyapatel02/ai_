'use client';

import { CircleDashed } from 'lucide-react';
import Link from 'next/link';

import { useHydrated } from '@/hooks/use-hydrated';
import { useMe, useSyncStatus } from '@/lib/api/hooks';
import { formatRelative, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { SyncStatusDto } from '@devimpact/shared';

export type SyncTone = 'ok' | 'active' | 'warning' | 'danger' | 'none';

export interface SyncDescriptor {
  tone: SyncTone;
  text: string;
  /** Integrations nav item shows an attention dot. */
  attention: boolean;
}

/**
 * Sync status copy (DESIGN_SYSTEM §5.2 SyncStatus, prototype `syncState()`): synced (relative
 * time), syncing (%), paused until HH:MM, needs reconnection, failed, not connected.
 */
export function describeSync(
  status: SyncStatusDto | null | undefined,
  options: { loading?: boolean; error?: boolean; timezone?: string; now?: Date } = {},
): SyncDescriptor {
  if (options.loading) return { tone: 'none', text: 'Checking sync…', attention: false };
  if (options.error) return { tone: 'none', text: 'Status unavailable', attention: false };
  if (!status) return { tone: 'none', text: 'Not connected', attention: false };
  const run = status.currentRun;
  switch (status.state) {
    case 'needs_reauth':
      return { tone: 'warning', text: 'Needs reconnection', attention: true };
    case 'failed':
      return { tone: 'danger', text: 'Last sync failed', attention: true };
    case 'waiting_rate_limit':
      return {
        tone: 'warning',
        text: run?.resumeAt
          ? `Paused until ${formatTime(run.resumeAt, options.timezone)}`
          : 'Paused by rate limit',
        attention: false,
      };
    case 'queued':
      return { tone: 'active', text: 'Sync queued', attention: false };
    case 'running': {
      const importing = run?.kind === 'backfill' && run.recentWindowCompletedAt;
      return {
        tone: 'active',
        text: `${importing ? 'Importing history' : 'Syncing'} · ${run?.progress ?? 0}%`,
        attention: false,
      };
    }
    case 'idle':
      return status.lastSuccessfulAt
        ? {
            tone: 'ok',
            text: `Synced ${formatRelative(status.lastSuccessfulAt, { now: options.now, timeZone: options.timezone })}`,
            attention: false,
          }
        : { tone: 'none', text: 'Not synced yet', attention: false };
  }
}

const DOT: Record<SyncTone, string> = {
  ok: 'bg-success',
  active: 'bg-primary animate-pulse',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  none: '',
};

export function StatusDot({ tone, className }: { tone: SyncTone; className?: string }) {
  if (tone === 'none') {
    return (
      <CircleDashed
        className={cn('size-3.5 text-subtle-foreground', className)}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', DOT[tone], className)}
      aria-hidden="true"
    />
  );
}

export function useSyncDescriptor(): SyncDescriptor {
  const me = useMe();
  const sync = useSyncStatus();
  const hydrated = useHydrated();
  return describeSync(sync.data, {
    loading: sync.isPending || !hydrated,
    error: sync.isError,
    timezone: me.data?.settings.timezone,
  });
}

/** Sync chip (top bar, desktop) and sidebar footer item; both link to Settings → Integrations. */
export function SyncStatus({
  variant = 'chip',
  className,
}: {
  variant?: 'chip' | 'sidebar';
  className?: string;
}) {
  const sync = useSyncDescriptor();
  return (
    <Link
      href="/settings/integrations"
      className={cn(
        'inline-flex min-w-0 items-center gap-2 rounded-sm text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        variant === 'chip' ? 'h-7 px-2.5' : 'h-8 w-full px-2.5',
        className,
      )}
      aria-label={`Sync status: ${sync.text}. Open integrations`}
      data-testid={`sync-status-${variant}`}
    >
      <StatusDot tone={sync.tone} />
      <span className="truncate">{sync.text}</span>
    </Link>
  );
}
