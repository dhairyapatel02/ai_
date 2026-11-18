'use client';

import { ConnectGitHubResult } from '@devimpact/shared';
import { Clock, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { Banner } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { apiClient } from '@/lib/api/browser';
import { errorMessage } from '@/lib/api/errors';
import { useMe, useStartSync, useSyncStatus } from '@/lib/api/hooks';
import { formatDate, formatTime } from '@/lib/format';

/**
 * Sync state banners on Overview pages (prototype `banners()`, FLOWS F2/F3/F4): needs
 * reconnection, last sync failed, paused by rate limit, and "recent 30 days ready, older history
 * still loading" during the first backfill.
 */
export function SyncBanner() {
  const me = useMe();
  const sync = useSyncStatus();
  const start = useStartSync();
  const [reconnecting, setReconnecting] = useState(false);
  const status = sync.data;
  const timezone = me.data?.settings.timezone;
  if (!status) return null;

  const reconnect = async () => {
    setReconnecting(true);
    try {
      const { url } = await apiClient.post(`/integrations/${status.integrationId}/reconnect`, {
        schema: ConnectGitHubResult.pick({ url: true }),
      });
      window.location.assign(url);
    } catch (error) {
      setReconnecting(false);
      toast.error(errorMessage(error, 'the reconnect link'));
    }
  };

  if (status.state === 'needs_reauth') {
    return (
      <Banner
        tone="warning"
        title="GitHub needs to be reconnected"
        actions={
          <Button size="sm" loading={reconnecting} onClick={() => void reconnect()}>
            Reconnect GitHub
          </Button>
        }
      >
        GitHub revoked DevImpact&apos;s access. Your data is kept, but nothing new is imported until
        you reconnect.
      </Banner>
    );
  }
  if (status.state === 'failed') {
    const at = status.lastRun?.finishedAt;
    return (
      <Banner
        tone="danger"
        title={at ? `Last sync failed at ${formatTime(at, timezone)}` : 'Last sync failed'}
        actions={
          <>
            <Button size="sm" variant="secondary" asChild>
              <Link href="/settings/integrations">View details</Link>
            </Button>
            <Button
              size="sm"
              loading={start.isPending}
              onClick={() => {
                start.mutate(undefined, {
                  onError: (error) => toast.error(errorMessage(error, 'the sync')),
                });
              }}
            >
              Retry sync
            </Button>
          </>
        }
      >
        {status.lastRun?.errorMessage ?? 'GitHub returned an error during the last sync.'}
        {status.lastSuccessfulAt
          ? ` Data up to ${formatDate(status.lastSuccessfulAt, { timeZone: timezone })} is shown.`
          : ''}
      </Banner>
    );
  }
  if (status.state === 'waiting_rate_limit') {
    const resumeAt = status.currentRun?.resumeAt;
    return (
      <Banner
        tone="warning"
        icon={<Clock className="size-4" aria-hidden="true" />}
        title={resumeAt ? `Sync paused until ${formatTime(resumeAt, timezone)}` : 'Sync paused'}
      >
        GitHub&apos;s rate limit was reached. DevImpact resumes automatically — no action needed.
      </Banner>
    );
  }
  const run = status.currentRun;
  if (run && run.kind === 'backfill' && (status.state === 'running' || status.state === 'queued')) {
    const ready = Boolean(run.recentWindowCompletedAt);
    return (
      <Banner
        tone="info"
        icon={<LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
        title={
          ready
            ? 'Your last 30 days are ready. Older history is still loading.'
            : 'Importing your GitHub history'
        }
      >
        <span>
          {ready
            ? `Longer periods may show partial numbers until this finishes · ${run.progress}%`
            : `This usually takes 1–3 minutes · ${run.progress}%`}
        </span>
        <Progress value={run.progress} className="mt-2 max-w-sm" aria-label="Import progress" />
      </Banner>
    );
  }
  return null;
}
