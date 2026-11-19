'use client';

import {
  Award,
  ChevronRight,
  FileText,
  FolderGit2,
  Gauge,
  GitCommitHorizontal,
  GitMerge,
  ListChecks,
  MessageSquareText,
  Plug,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ActivityChart } from '@/components/activity-chart';
import { ActivityHeatmap } from '@/components/activity-heatmap';
import { FeedItemRow, itemParam } from '@/components/feed-item';
import { ImpactScoreCard } from '@/components/impact-score-card';
import { ItemDrawer } from '@/components/item-drawer';
import { NextStepCard } from '@/components/next-step-card';
import { InvalidPeriodState, isInvalidPeriodError } from '@/components/period-gate';
import { SyncBanner } from '@/components/shell/sync-banner';
import {
  CardSkeleton,
  ErrorState,
  ListSkeleton,
  PageHeader,
  StatCard,
  StatCardSkeleton,
} from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/lib/api/errors';
import {
  isBackfilling,
  reconnectUrl,
  useIntegrations,
  useMe,
  useSyncStatus,
} from '@/lib/api/hooks';
import {
  useActivityFeed,
  useDefinitions,
  useHeatmap,
  useImpact,
  useOverview,
  useRecentDocuments,
} from '@/lib/api/metrics-hooks';
import { bucketActivity, chooseInterval, daysBetween } from '@/lib/charts';
import { DASHBOARD_FEED } from '@/lib/dashboard';
import { formatRelative } from '@/lib/format';
import { formatMetric } from '@/lib/metrics-format';
import { appraisalTarget, pickNextStep, readDismissed, type NextStepRule } from '@/lib/next-step';
import { longerPeriod, startsBeforeRecentWindow, usePeriod } from '@/lib/period';
import { useSearchParamsState } from '@/lib/url-state';

import type { MetricValue, OverviewResponse } from '@devimpact/shared';
import type { LucideIcon } from 'lucide-react';

const CARD_ICON: Record<string, LucideIcon> = {
  commits: GitCommitHorizontal,
  prs_merged: GitMerge,
  prs_reviewed: MessageSquareText,
};

/** "vs same point last month" for in-progress periods (KPI §3.7), else "vs Oct 2026". */
export function comparisonLabel(overview: OverviewResponse | undefined): string {
  if (!overview) return '';
  if (overview.comparison === 'same_elapsed') {
    const unit = overview.period.type === 'custom' ? 'period' : overview.period.type;
    return `vs same point last ${unit}`;
  }
  return `vs ${overview.previousPeriod.label}`;
}

/** Dashboard (S6): the period at a glance and the next useful action. */
export function DashboardView() {
  const me = useMe();
  const connected = me.data ? me.data.integrations.some((i) => i.status !== 'disconnected') : true;
  const url = useSearchParamsState();

  return (
    <>
      <DashboardHeader connected={connected} />
      {connected ? <DashboardBody /> : <FirstRun />}
      <ItemDrawer
        value={url.get('item')}
        timezone={me.data?.settings.timezone}
        onClose={() => {
          url.set({ item: null });
        }}
      />
    </>
  );
}

function DashboardHeader({ connected }: { connected: boolean }) {
  const period = usePeriod();
  const sync = useSyncStatus({ enabled: connected });
  const me = useMe();
  const overview = useOverview(connected && !period.invalid ? period.apiParam : undefined, {
    enabled: connected && !period.invalid,
  });
  const resolved = period.resolved;
  const backfilling = isBackfilling(sync.data);
  const lastSync = overview.data?.dataFreshness.lastSuccessfulSyncAt;
  const lede =
    connected && resolved ? (
      <>
        {resolved.label}
        {resolved.inProgress ? ' · in progress' : ''}
        {backfilling
          ? ' · importing older history'
          : lastSync
            ? ` · synced ${formatRelative(lastSync, { timeZone: me.data?.settings.timezone })}`
            : ''}
        {backfilling && period.today && startsBeforeRecentWindow(resolved, period.today) ? (
          <span className="ml-1 text-warning"> · Partial — import in progress</span>
        ) : null}
      </>
    ) : undefined;
  const qs = period.urlSpec ? `?period=${encodeURIComponent(period.urlSpec)}` : '';
  return (
    <PageHeader
      title="Dashboard"
      lede={lede}
      actions={
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button variant="secondary" asChild>
            <Link href="/achievements">
              <Award aria-hidden="true" />
              Add achievement
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/documents/new/appraisal${qs}`}>
              <Sparkles aria-hidden="true" />
              Draft appraisal
            </Link>
          </Button>
        </div>
      }
    />
  );
}

/** Empty — no integration: three-step checklist + value cards; no zero-filled stats, no score. */
function FirstRun() {
  const steps: [LucideIcon, string, string, boolean][] = [
    [Plug, 'Connect GitHub data', 'Install the read-only GitHub App and pick repositories.', true],
    [FolderGit2, 'Review repositories', 'Exclude anything that should not count.', false],
    [RefreshCw, 'Watch your first sync', 'Your last 30 days appear within a minute or two.', false],
  ];
  const values: [LucideIcon, string, string][] = [
    [Gauge, 'Explainable KPIs', 'Every number links to the PRs behind it.'],
    [
      FileText,
      'Documents with evidence',
      'Appraisals, promotion packets and resume bullets cite your work.',
    ],
    [
      Award,
      'Capture what GitHub misses',
      'Log mentoring, incidents and design docs as achievements.',
    ],
  ];
  return (
    <div className="flex flex-col gap-4" data-testid="dashboard-first-run">
      <Card>
        <CardContent className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Set up DevImpact in three steps</h2>
            <p className="text-muted-foreground">
              Connect GitHub once. Your dashboard, KPIs and documents fill in from real work —
              nothing is estimated.
            </p>
          </div>
          <ol className="flex flex-col">
            {steps.map(([Icon, title, text, active], i) => (
              <li
                key={title}
                className="flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
              >
                <span
                  className={
                    active
                      ? 'flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground'
                      : 'flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted-foreground'
                  }
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 basis-48 flex-col">
                  <b className="font-medium">
                    {i + 1}. {title}
                  </b>
                  <span className="text-sm text-muted-foreground">{text}</span>
                </span>
                {active ? (
                  <Button asChild>
                    <Link href="/onboarding/connect">Connect GitHub</Link>
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <ul className="grid gap-3 md:grid-cols-3">
        {values.map(([Icon, title, text]) => (
          <li key={title} className="flex flex-col gap-1.5 rounded-md border bg-card p-4">
            <span className="flex size-7 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <b className="font-medium">{title}</b>
            <span className="text-sm text-muted-foreground">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DashboardBody() {
  const period = usePeriod();
  if (period.invalid) return <InvalidPeriodState message={period.invalid} />;
  return <DashboardPanels />;
}

/** "Show Q4 2026" — the next longer period (no-data state). */
function useLongerPeriodChip() {
  const period = usePeriod();
  const me = useMe();
  const timezone = me.data?.settings.timezone;
  const resolved = period.resolved;
  const longer =
    resolved && timezone && period.today ? longerPeriod(resolved, timezone, period.today) : null;
  return longer ? (
    <Button
      size="sm"
      variant="secondary"
      className="self-start"
      onClick={() => {
        period.setPeriod(longer.spec);
      }}
    >
      Show {longer.label}
    </Button>
  ) : null;
}

/**
 * Each panel subscribes to its own query, so a resolving query re-renders only that panel
 * (TanStack tracked properties); the parent only reads error flags for the whole-page error.
 */
function DashboardPanels() {
  const period = usePeriod();
  const overview = useOverview(period.apiParam);
  const impact = useImpact(period.apiParam);
  const heatmap = useHeatmap();

  if (isInvalidPeriodError(overview.error)) return <InvalidPeriodState />;
  if (overview.isError && impact.isError && heatmap.isError) {
    return (
      <Card>
        <ErrorState
          error={overview.error}
          what="your dashboard"
          onRetry={() => {
            void overview.refetch();
            void impact.refetch();
            void heatmap.refetch();
          }}
          retrying={overview.isFetching}
        />
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <SyncBanner />
      <KeyNumbers />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr] [&>*]:min-w-0">
        <ActivityPanel />
        <ImpactPanel />
      </div>
      <HeatmapPanel />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr] [&>*]:min-w-0">
        <RecentActivity />
        <div className="flex flex-col gap-4">
          <NextStep />
          <QuickActions />
        </div>
      </div>
    </div>
  );
}

function KeyNumbers() {
  const period = usePeriod();
  const overview = useOverview(period.apiParam);
  const comparison = comparisonLabel(overview.data);
  const noActivity = overview.data ? overview.data.cards.every((c) => (c.value ?? 0) === 0) : false;
  const qs = period.urlSpec ? `&period=${encodeURIComponent(period.urlSpec)}` : '';
  if (overview.isError) {
    return (
      <Card>
        <ErrorState
          error={overview.error}
          what="your key numbers"
          onRetry={() => void overview.refetch()}
          retrying={overview.isFetching}
        />
      </Card>
    );
  }
  return (
    <section aria-label="Key numbers" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {overview.data
          ? overview.data.cards.map((card) => (
              <MetricCard
                key={card.key}
                card={card}
                comparison={comparison}
                explainHref={`/kpis?metric=${card.key}${qs}`}
              />
            ))
          : [0, 1, 2].map((i) => <StatCardSkeleton key={i} />)}
        {overview.data ? (
          <StatCard
            label="Impact score"
            icon={<Gauge className="size-4" aria-hidden="true" />}
            value={
              <>
                {overview.data.impact.overall}
                <span className="ml-1 text-base font-normal text-subtle-foreground">
                  / 100 · {overview.data.impact.band}
                </span>
              </>
            }
            delta={overview.data.impact.delta}
            unit="score"
            comparison={comparison}
            compactComparison
            state={overview.data.impact.overall === null ? 'insufficient' : 'ok'}
            insufficientNote="Not enough activity yet to compute a fair score."
            info={
              <>
                A weighted summary of Delivery, Quality, Collaboration and Ownership, computed from
                your GitHub activity. Signal, not a judgement of your performance.{' '}
                <Link href="/kpis/impact" className="text-link underline underline-offset-2">
                  See details
                </Link>
              </>
            }
            testId="stat-impact"
          />
        ) : (
          <StatCardSkeleton />
        )}
      </div>
      {comparison ? (
        <p className="text-caption text-subtle-foreground md:hidden">Changes are {comparison}.</p>
      ) : null}
      {noActivity && overview.data ? (
        <p className="text-sm text-muted-foreground" role="status">
          No activity in {overview.data.period.label}.
        </p>
      ) : null}
    </section>
  );
}

function ActivityPanel() {
  const period = usePeriod();
  const heatmap = useHeatmap();
  const longerChip = useLongerPeriodChip();
  const resolved = period.resolved;
  // The activity chart reuses the 12-month heatmap days when the period lies inside it;
  // an older period (e.g. last year) fetches its own range (≤ 366 days).
  const needsOwnRange = !!resolved && !!heatmap.data && resolved.startDate < heatmap.data.from;
  const periodHeatmap = useHeatmap(
    needsOwnRange ? resolved.startDate : undefined,
    needsOwnRange ? resolved.endDate : undefined,
    { enabled: needsOwnRange },
  );
  const chartDays = needsOwnRange ? periodHeatmap.data?.days : heatmap.data?.days;
  const interval = resolved
    ? chooseInterval(daysBetween(resolved.startDate, resolved.endDate))
    : 'day';
  const startDate = resolved?.startDate;
  const endDate = resolved?.endDate;
  const year = period.today ? Number(period.today.slice(0, 4)) : undefined;
  const rows = useMemo(
    () =>
      startDate && endDate && chartDays
        ? bucketActivity(chartDays, startDate, endDate, interval, year)
        : null,
    [chartDays, startDate, endDate, interval, year],
  );
  const chartError = needsOwnRange ? periodHeatmap.error : heatmap.error;
  if (chartError) {
    return (
      <Card>
        <ErrorState
          error={chartError}
          what="your activity chart"
          onRetry={() => void (needsOwnRange ? periodHeatmap.refetch() : heatmap.refetch())}
        />
      </Card>
    );
  }
  if (!rows || !resolved) return <CardSkeleton height={268} />;
  return (
    <ActivityChart
      rows={rows}
      interval={interval}
      periodLabel={resolved.label}
      height={268}
      fetching={periodHeatmap.isFetching}
      empty={
        <span className="flex flex-col items-center gap-2 px-4">
          No activity in {resolved.label}.{longerChip}
        </span>
      }
    />
  );
}

function ImpactPanel() {
  const period = usePeriod();
  const impact = useImpact(period.apiParam);
  const longerChip = useLongerPeriodChip();
  if (impact.isError) {
    return (
      <Card>
        <ErrorState
          error={impact.error}
          what="your impact score"
          onRetry={() => void impact.refetch()}
        />
      </Card>
    );
  }
  return (
    <ImpactScoreCard
      loading={impact.isPending}
      fetching={impact.isPlaceholderData}
      score={impact.data?.overall ?? null}
      band={impact.data?.band ?? null}
      periodLabel={impact.data?.period.label ?? period.resolved?.label}
      explanation={impact.data?.explanation}
      detailHref={`/kpis/impact${period.urlSpec ? `?period=${encodeURIComponent(period.urlSpec)}` : ''}`}
      insufficientAction={longerChip}
      dimensions={(impact.data?.dimensions ?? []).map((d) => ({
        key: d.key,
        label: d.label,
        score: d.score,
        available: d.available,
      }))}
    />
  );
}

function HeatmapPanel() {
  const period = usePeriod();
  const sync = useSyncStatus();
  const heatmap = useHeatmap();
  const importingBefore =
    isBackfilling(sync.data) && sync.data?.currentRun?.recentWindowCompletedAt && period.today
      ? new Date(Date.parse(`${period.today}T00:00:00Z`) - 29 * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : undefined;
  if (heatmap.isPending) return <CardSkeleton height={120} />;
  if (heatmap.isError) {
    return (
      <Card>
        <ErrorState
          error={heatmap.error}
          what="your contributions"
          onRetry={() => void heatmap.refetch()}
        />
      </Card>
    );
  }
  return <ActivityHeatmap days={heatmap.data.days} importingBefore={importingBefore} />;
}

/** Popover body: the catalogue definition, fetched only when the popover opens (cached 1 h). */
function MetricDefinitionText({ metricKey }: { metricKey: string }) {
  const definitions = useDefinitions();
  const definition = definitions.data?.metrics.find((m) => m.key === metricKey)?.definition;
  return <>{definition ?? 'Computed from your GitHub activity in included repositories.'}</>;
}

function MetricCard({
  card,
  comparison,
  explainHref,
}: {
  card: MetricValue;
  comparison: string;
  explainHref: string;
}) {
  const Icon = CARD_ICON[card.key];
  return (
    <StatCard
      label={card.label}
      icon={Icon ? <Icon className="size-4" aria-hidden="true" /> : undefined}
      value={formatMetric(card)}
      delta={card.delta}
      unit={card.unit}
      comparison={comparison}
      compactComparison
      state={card.status === 'ok' && card.value !== null ? 'ok' : 'insufficient'}
      insufficientNote={`Not enough data · n = ${card.n}`}
      info={
        <>
          <MetricDefinitionText metricKey={card.key} />{' '}
          <Link href={explainHref} className="text-link underline underline-offset-2">
            Explain
          </Link>
        </>
      }
      testId={`stat-${card.key}`}
    />
  );
}

function RecentActivity() {
  const me = useMe();
  const period = usePeriod();
  const url = useSearchParamsState();
  const feed = useActivityFeed(DASHBOARD_FEED);
  const items = feed.data?.pages[0]?.items ?? [];
  const qs = period.urlSpec ? `?period=${encodeURIComponent(period.urlSpec)}` : '';
  return (
    <Card className="gap-0">
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle className="mr-auto">
          <h2>Recent activity</h2>
        </CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/activity${qs}`}>View all</Link>
        </Button>
      </CardHeader>
      <div className="pt-2 pb-2">
        {feed.isPending ? (
          <ListSkeleton rows={6} label="Loading recent activity…" />
        ) : feed.isError ? (
          <ErrorState
            error={feed.error}
            what="your recent activity"
            onRetry={() => void feed.refetch()}
          />
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground">
            No merged pull requests or reviews yet.
          </p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <FeedItemRow
                  item={item}
                  timezone={me.data?.settings.timezone}
                  today={period.today}
                  onOpen={(i) => {
                    url.set({ item: itemParam(i) });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function NextStep() {
  const me = useMe();
  const period = usePeriod();
  const sync = useSyncStatus();
  const integrations = useIntegrations();
  const appraisals = useRecentDocuments('appraisal', 20);
  const resumes = useRecentDocuments('resume', 1);
  const [dismissed, setDismissed] = useState<Partial<Record<NextStepRule, number>>>({});
  const [reconnecting, setReconnecting] = useState(false);
  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  const settings = me.data?.settings;
  const github = integrations.data?.find((i) => i.status !== 'disconnected');
  const suspendedOrg = github?.installations.find((i) => i.suspended)?.accountLogin ?? null;
  const needsReconnect =
    github?.status === 'needs_reauth' ||
    sync.data?.state === 'needs_reauth' ||
    suspendedOrg !== null;

  const step = useMemo(() => {
    if (!settings || !period.today) return null;
    return pickNextStep({
      today: period.today,
      timezone: settings.timezone,
      defaultPeriodType: settings.defaultPeriodType,
      needsReconnect,
      suspendedOrg,
      lastSyncFailed: sync.data?.state === 'failed',
      appraisalPeriods: appraisals.data
        ? appraisals.data.items.map((d) => d.period?.spec ?? null)
        : null,
      newestResumeAt: resumes.data ? (resumes.data.items[0]?.createdAt ?? undefined) : null,
      dismissed,
      now: Date.now(),
    });
  }, [
    settings,
    period.today,
    needsReconnect,
    suspendedOrg,
    sync.data?.state,
    appraisals.data,
    resumes.data,
    dismissed,
  ]);

  const halfSpec =
    step?.rule === 'appraisal' && settings && period.today
      ? appraisalTarget(period.today, settings.timezone, settings.defaultPeriodType).spec
      : undefined;
  const half = useOverview(halfSpec, { enabled: halfSpec !== undefined });
  const halfCounts = half.data
    ? {
        merged: half.data.cards.find((c) => c.key === 'prs_merged')?.value ?? 0,
        reviewed: half.data.cards.find((c) => c.key === 'prs_reviewed')?.value ?? 0,
      }
    : null;

  if (!step) return <CardSkeleton height={96} />;
  return (
    <NextStepCard
      step={step}
      halfCounts={halfCounts}
      suspendedOrg={suspendedOrg}
      reconnecting={reconnecting}
      reconnect={() => {
        if (!github) return;
        setReconnecting(true);
        reconnectUrl(github.id).then(
          (href) => {
            window.location.assign(href);
          },
          (error: unknown) => {
            setReconnecting(false);
            toast.error(errorMessage(error, 'the reconnect link'));
          },
        );
      }}
      onDismiss={() => {
        setDismissed(readDismissed());
      }}
    />
  );
}

const CREATE: [string, LucideIcon, string, string][] = [
  [
    '/documents/new/appraisal',
    FileText,
    'Appraisal',
    'Self-review for a month, quarter, half or year',
  ],
  [
    '/documents/new/promotion',
    TrendingUp,
    'Promotion packet',
    'Your case for the next level, with evidence',
  ],
  ['/documents/new/resume', ListChecks, 'Resume bullets', 'Quantified bullets for a role'],
];

function QuickActions() {
  return (
    <Card className="gap-0">
      <CardHeader>
        <CardTitle>
          <h2>Create</h2>
        </CardTitle>
      </CardHeader>
      <ul className="pt-2 pb-2">
        {CREATE.map(([href, Icon, title, text]) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{title}</span>
                <span className="truncate text-caption text-subtle-foreground">{text}</span>
              </span>
              <ChevronRight className="size-4 text-subtle-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
