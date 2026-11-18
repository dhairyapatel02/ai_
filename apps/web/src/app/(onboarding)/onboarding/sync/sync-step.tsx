'use client';

import { CircleCheck, Clock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import { STAGES, stageIndex, SyncStages } from '@/components/onboarding/sync-stages';
import { useSaveOnboardingStep } from '@/components/onboarding/use-onboarding';
import { Banner, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api/errors';
import { useMe, useStartSync, useSyncStatus, useUpdateSettings } from '@/lib/api/hooks';
import { formatCount, formatTime } from '@/lib/format';

import type { SyncRunDto, SyncStatusDto } from '@devimpact/shared';

export type SyncPhase =
  | 'not_connected'
  | 'not_started'
  | 'preparing'
  | 'running'
  | 'rate_limited'
  | 'failed'
  | 'needs_reauth'
  | 'done'
  | 'done_empty';

const FINISHED = new Set(['succeeded', 'partial']);

/** The run the wizard follows (the active one, else the last) and its display phase. */
export function syncPhase(status: SyncStatusDto | null | undefined): {
  phase: SyncPhase;
  run: SyncRunDto | null;
} {
  if (status === null) return { phase: 'not_connected', run: null };
  if (!status) return { phase: 'preparing', run: null };
  const run = status.currentRun ?? status.lastRun;
  if (status.state === 'needs_reauth') return { phase: 'needs_reauth', run };
  if (status.state === 'waiting_rate_limit') return { phase: 'rate_limited', run };
  if (status.state === 'queued') return { phase: 'preparing', run };
  if (status.state === 'running') {
    return { phase: run && run.stage !== 'prepare' ? 'running' : 'preparing', run };
  }
  if (status.state === 'failed') return { phase: 'failed', run };
  if (!run) return { phase: 'not_started', run: null };
  if (FINISHED.has(run.status)) {
    const c = run.counts;
    const items = (c.prsAuthored ?? 0) + (c.prsReviewed ?? 0) + (c.commits ?? 0) + (c.reviews ?? 0);
    return { phase: items === 0 && (c.created ?? 0) === 0 ? 'done_empty' : 'done', run };
  }
  return { phase: 'failed', run };
}

/** SCREENS S5 · Onboarding · First sync (polling contract, GAP-11). */
export function SyncStep() {
  useSaveOnboardingStep('sync');
  const router = useRouter();
  const me = useMe();
  const sync = useSyncStatus();
  const start = useStartSync();
  const updateSettings = useUpdateSettings();
  const [finishing, setFinishing] = useState(false);
  const { phase, run } = syncPhase(sync.isSuccess ? sync.data : undefined);
  const timezone = me.data?.settings.timezone;
  const done = phase === 'done' || phase === 'done_empty';
  const progress = done ? 100 : (run?.progress ?? 0);
  const ready = done || Boolean(run?.recentWindowCompletedAt);
  const activeStage =
    run && !done ? STAGES[Math.min(stageIndex(run.stage), STAGES.length - 1)] : null;

  const finish = async () => {
    setFinishing(true);
    try {
      await updateSettings.mutateAsync({ onboardingCompleted: true, onboardingStep: null });
      router.push('/dashboard');
    } catch (error) {
      toast.error(errorMessage(error, 'your setup'));
      setFinishing(false);
    }
  };

  const retry = () => {
    start.mutate(undefined, {
      onError: (error) => toast.error(errorMessage(error, 'the import')),
    });
  };

  const goToDashboard = (
    <Button loading={finishing} onClick={() => void finish()}>
      Go to dashboard
    </Button>
  );

  return (
    <>
      <OnboardingStepper current={2} />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
            {done ? 'Import complete' : 'Importing your last 12 months'}
          </h1>
          <p className="text-muted-foreground">
            {done
              ? 'Every metric now covers your full history.'
              : 'This usually takes 1–3 minutes. You can leave this page — the import keeps running.'}
          </p>
        </div>

        {sync.isError ? (
          <div className="rounded-md border bg-card">
            <ErrorState
              error={sync.error}
              what="the import status"
              onRetry={() => void sync.refetch()}
            />
          </div>
        ) : phase === 'not_connected' ? (
          <Banner
            tone="warning"
            title="GitHub isn't connected yet"
            actions={
              <Button size="sm" asChild>
                <Link href="/onboarding/connect">Connect GitHub</Link>
              </Button>
            }
          >
            Connect the GitHub App to import your activity.
          </Banner>
        ) : (
          <div className="rounded-md border bg-card px-4 py-4">
            {sync.isPending ? (
              <div className="flex flex-col gap-3" aria-busy="true">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-1.5 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {done ? 'Done' : phase === 'preparing' ? 'Preparing…' : 'Overall progress'}
                  </span>
                  <span className="text-muted-foreground tabular-nums" aria-hidden="true">
                    {progress}%
                  </span>
                </div>
                <Progress value={progress} aria-label="Import progress" />
                <SyncStages run={run} finished={done} />
                {run && run.errors.length > 0 ? (
                  <p className="mt-3 text-sm text-warning">
                    {run.errors.length === 1 ? '1 repository' : `${run.errors.length} repositories`}{' '}
                    couldn&apos;t be read
                    {run.errors.some((e) => e.repo)
                      ? ` (${run.errors
                          .map((e) => e.repo)
                          .filter(Boolean)
                          .slice(0, 3)
                          .join(', ')})`
                      : ''}
                    . The rest imported normally.
                  </p>
                ) : null}
              </>
            )}
          </div>
        )}

        {/* Stage changes and the ready moment are announced politely (SCREENS S5). */}
        <p className="sr-only" aria-live="polite">
          {activeStage ? `Importing ${activeStage.label.toLowerCase()}.` : ''}
        </p>

        {phase === 'rate_limited' ? (
          <Banner
            tone="warning"
            icon={<Clock className="size-4" aria-hidden="true" />}
            title={
              run?.resumeAt
                ? `Paused until ${formatTime(run.resumeAt, timezone)} — GitHub's rate limit`
                : "Paused by GitHub's rate limit"
            }
          >
            It resumes automatically.
          </Banner>
        ) : null}
        {phase === 'failed' ? (
          <Banner
            tone="danger"
            role="alert"
            title="The import failed"
            actions={
              <Button size="sm" loading={start.isPending} onClick={retry}>
                Retry
              </Button>
            }
          >
            {run?.errorMessage ?? 'GitHub returned an error. Your selection is saved — try again.'}
          </Banner>
        ) : null}
        {phase === 'needs_reauth' ? (
          <Banner
            tone="warning"
            title="GitHub needs to be reconnected"
            actions={
              <Button size="sm" asChild>
                <Link href="/onboarding/connect">Reconnect GitHub</Link>
              </Button>
            }
          >
            DevImpact lost access before the import finished. Your data is kept.
          </Banner>
        ) : null}
        {phase === 'not_started' ? (
          <Banner
            tone="info"
            title="The import hasn't started"
            actions={
              <Button size="sm" loading={start.isPending} onClick={retry}>
                Start import
              </Button>
            }
          >
            Start it now — it keeps running if you leave this page.
          </Banner>
        ) : null}

        <div aria-live="polite">
          {phase === 'done_empty' ? (
            <Banner
              tone="neutral"
              title="No activity found"
              actions={
                <>
                  <Button size="sm" variant="secondary" asChild>
                    <Link href="/onboarding/repositories">Review repositories</Link>
                  </Button>
                  {goToDashboard}
                </>
              }
            >
              We didn&apos;t find any pull requests, reviews or commits by you in the selected
              repositories.
            </Banner>
          ) : ready ? (
            <Banner
              tone="info"
              icon={<CircleCheck className="size-4" aria-hidden="true" />}
              title={done ? 'Your dashboard is up to date' : 'Your dashboard is ready'}
              actions={goToDashboard}
            >
              {done && run
                ? `${formatCount(run.counts.prsAuthored ?? 0)} pull requests, ${formatCount(run.counts.prsReviewed ?? 0)} reviewed pull requests and ${formatCount(run.counts.commits ?? 0)} commits imported.`
                : 'Your last 30 days are in. Older history is still loading and will fill in automatically.'}
            </Banner>
          ) : null}
        </div>
      </div>
    </>
  );
}
