import {
  PROVIDER_LABELS,
  type IntegrationDto,
  type SyncRunDto,
  type SyncStage,
  type SyncStatusDto,
} from '@devimpact/shared';

import { formatDate, formatRelative, formatTime } from '@/lib/format';

/**
 * GitHub card state on Settings → Integrations (SCREENS S19 table): badge, explanation line,
 * primary action and the reason Sync now is disabled. Pure, unit-tested.
 */
export type IntegrationBadge = 'success' | 'accent' | 'warning' | 'danger' | 'neutral';

export interface IntegrationState {
  key:
    | 'active'
    | 'syncing'
    | 'waiting_rate_limit'
    | 'needs_reauth'
    | 'suspended'
    | 'failed'
    | 'not_synced';
  badge: { variant: IntegrationBadge; text: string };
  explanation: string;
  primary: 'sync' | 'reconnect' | 'retry' | 'manage';
  /** Why Sync now is disabled (shown next to the button), or null when it is enabled. */
  syncDisabledReason: string | null;
}

const STAGE_LABEL: Record<SyncStage, string> = {
  prepare: 'Preparing',
  repositories: 'Finding repositories',
  authored_prs: 'Importing your pull requests',
  reviewed_prs: 'Importing pull requests you reviewed',
  commits: 'Importing commits',
  issues: 'Importing issues',
  persist: 'Saving',
  rollups: 'Calculating KPIs',
  done: 'Finishing',
};

export function stageLabel(stage: SyncStage): string {
  return STAGE_LABEL[stage];
}

/** "tomorrow at 03:40" / "today at 15:00" / "Nov 20 at 03:40". */
export function scheduleLabel(
  at: string,
  timeZone: string | undefined,
  now: Date = new Date(),
): string {
  const time = formatTime(at, timeZone);
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  const target = dayKey(new Date(at));
  if (target === dayKey(now)) return `today at ${time}`;
  if (target === dayKey(new Date(now.getTime() + 86_400_000))) return `tomorrow at ${time}`;
  return `${formatDate(at, { timeZone, now })} at ${time}`;
}

export function describeIntegration(
  integration: IntegrationDto,
  sync: SyncStatusDto | null | undefined,
  options: { timezone?: string; now?: Date } = {},
): IntegrationState {
  const { timezone, now } = options;
  const run = sync?.currentRun ?? null;
  const suspended = integration.installations.find((i) => i.suspended);
  const label = PROVIDER_LABELS[integration.provider];

  if (integration.status === 'needs_reauth' || sync?.state === 'needs_reauth') {
    return {
      key: 'needs_reauth',
      badge: { variant: 'warning', text: 'Needs reconnection' },
      explanation: `${label} access was revoked. Reconnect to resume syncing — nothing has been deleted.`,
      primary: 'reconnect',
      syncDisabledReason: null,
    };
  }
  if (sync?.state === 'waiting_rate_limit') {
    const until = run?.resumeAt ? formatTime(run.resumeAt, timezone) : null;
    return {
      key: 'waiting_rate_limit',
      badge: { variant: 'warning', text: until ? `Paused until ${until}` : 'Paused' },
      explanation: `${label}'s rate limit was reached. The sync resumes automatically.`,
      primary: 'sync',
      syncDisabledReason: `The sync resumes automatically when ${label} allows it`,
    };
  }
  if (sync?.state === 'queued' || sync?.state === 'running') {
    const importing = run?.kind === 'backfill';
    return {
      key: 'syncing',
      badge: {
        variant: 'accent',
        text: `${importing ? 'Importing history' : 'Syncing'} · ${run?.progress ?? 0}%`,
      },
      explanation: run
        ? `${stageLabel(run.stage)}${importing && run.recentWindowCompletedAt ? ' · your last 30 days are ready' : ''}`
        : 'Waiting for a worker to pick up the sync',
      primary: 'sync',
      syncDisabledReason: 'A sync is already running',
    };
  }
  if (sync?.state === 'failed') {
    const first = sync.lastRun?.errors[0];
    return {
      key: 'failed',
      badge: { variant: 'danger', text: 'Last sync failed' },
      explanation:
        sync.lastRun?.errorMessage ??
        (first
          ? `${first.repo ? `${first.repo}: ` : ''}${first.message}`
          : `${label} returned an error during the last sync.`),
      primary: 'retry',
      syncDisabledReason: null,
    };
  }
  if (suspended) {
    return {
      key: 'suspended',
      badge: { variant: 'warning', text: 'Suspended' },
      explanation: `${suspended.accountLogin} suspended DevImpact. Ask an owner to unsuspend it. Your other repositories keep syncing.`,
      primary: 'manage',
      syncDisabledReason: null,
    };
  }
  const last = sync?.lastSuccessfulAt ?? integration.lastSuccessfulSyncAt;
  const next = sync?.nextScheduledAt ?? integration.nextScheduledSyncAt;
  if (!last) {
    return {
      key: 'not_synced',
      badge: { variant: 'neutral', text: 'Not synced yet' },
      explanation:
        integration.category === 'issues'
          ? 'The first sync imports issues assigned to you, newest 30 days first.'
          : 'The first sync imports your last 30 days first, then the rest of the year.',
      primary: 'sync',
      syncDisabledReason: null,
    };
  }
  return {
    key: 'active',
    badge: { variant: 'success', text: 'Connected' },
    explanation: `Synced ${formatRelative(last, { now, timeZone: timezone })}${
      next ? ` · next scheduled sync ${scheduleLabel(next, timezone, now)}` : ''
    }`,
    primary: 'sync',
    syncDisabledReason: null,
  };
}

/** New items of a run: `created` when reported, else the sum of imported records. */
export function newItems(run: Pick<SyncRunDto, 'counts'>): number {
  const c = run.counts;
  if (typeof c.created === 'number') return c.created;
  return (c.prsAuthored ?? 0) + (c.reviews ?? 0) + (c.commits ?? 0) + (c.issues ?? 0);
}

/** Run duration in seconds, or null while it has not finished. */
export function runDurationSeconds(
  run: Pick<SyncRunDto, 'startedAt' | 'finishedAt' | 'queuedAt'>,
): number | null {
  if (!run.finishedAt) return null;
  return Math.max(
    0,
    (Date.parse(run.finishedAt) - Date.parse(run.startedAt ?? run.queuedAt)) / 1000,
  );
}
