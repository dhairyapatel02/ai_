'use client';

import type { MetricValue, OverviewResponse } from '@devimpact/shared';
import { Award, FileText, Plug } from 'lucide-react';
import Link from 'next/link';

import { ActivityHeatmap } from '@/components/activity-heatmap';
import { ImpactScoreCard } from '@/components/impact-score-card';
import { InvalidPeriodState, isInvalidPeriodError, PeriodGate } from '@/components/period-gate';
import { SyncBanner } from '@/components/shell/sync-banner';
import { CardSkeleton, EmptyState, ErrorState, PageHeader, StatCard } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMe } from '@/lib/api/hooks';
import { useHeatmap, useImpact, useMetricsRepos, useOverview } from '@/lib/api/metrics-hooks';
import { formatCount } from '@/lib/format';
import { formatMetric } from '@/lib/metrics-format';

function comparisonLabel(overview: OverviewResponse | undefined): string {
  if (!overview) return '';
  const unit = overview.period.type === 'custom' ? 'period' : overview.period.type;
  return overview.comparison === 'same_elapsed'
    ? `vs same point last ${unit}`
    : `vs previous ${unit}`;
}

function MetricCard({ card, comparison }: { card: MetricValue; comparison: string }) {
  return (
    <StatCard
      label={card.label}
      value={formatMetric(card)}
      delta={card.delta}
      unit={card.unit}
      comparison={comparison}
      state={card.status === 'ok' && card.value !== null ? 'ok' : 'insufficient'}
      insufficientNote={`Not enough data · n = ${card.n}`}
      testId={`stat-${card.key}`}
    />
  );
}

/**
 * Interim dashboard on the deterministic metrics API inside the new shell (P10 builds S6): stat
 * cards from `/metrics/overview`, `/impact`, top repositories, 12-month heatmap. No AI call.
 */
export function DashboardView() {
  const me = useMe();
  const connected = me.data ? me.data.integrations.some((i) => i.status !== 'disconnected') : true;

  return (
    <>
      <PageHeader
        title="Dashboard"
        lede="What you did and how it looks — computed from your GitHub activity."
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/achievements">
                <Award aria-hidden="true" />
                Add achievement
              </Link>
            </Button>
            <Button asChild>
              <Link href="/documents/new/appraisal">
                <FileText aria-hidden="true" />
                Draft appraisal
              </Link>
            </Button>
          </>
        }
      />
      {connected ? (
        <PeriodGate>{(period) => <DashboardPanels period={period} />}</PeriodGate>
      ) : (
        <div className="rounded-md border bg-card">
          <EmptyState
            icon={Plug}
            title="Connect GitHub to see your impact"
            description="DevImpact reads your pull requests, reviews and commits (read-only) and turns them into KPIs you can explain. It takes about 3 minutes."
            actions={
              <>
                <Button asChild>
                  <Link href="/onboarding/connect">Connect GitHub</Link>
                </Button>
                <Button variant="secondary" asChild>
                  <Link href="/kpis">How metrics work</Link>
                </Button>
              </>
            }
          />
        </div>
      )}
    </>
  );
}

function DashboardPanels({ period }: { period: string | undefined }) {
  const overview = useOverview(period);
  const impact = useImpact(period);
  const repos = useMetricsRepos(period, 5);
  const heatmap = useHeatmap();

  if (isInvalidPeriodError(overview.error)) return <InvalidPeriodState />;

  const comparison = comparisonLabel(overview.data);
  const hasActivity = overview.data?.cards.some((c) => (c.value ?? 0) > 0) ?? true;

  return (
    <div className="flex flex-col gap-4">
      <SyncBanner />
      {overview.isError ? (
        <Card>
          <ErrorState
            error={overview.error}
            what="your dashboard"
            onRetry={() => void overview.refetch()}
            retrying={overview.isFetching}
          />
        </Card>
      ) : (
        <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {overview.data
            ? overview.data.cards.map((card) => (
                <MetricCard key={card.key} card={card} comparison={comparison} />
              ))
            : ['Commits', 'PRs merged', 'PRs reviewed'].map((label) => (
                <StatCard key={label} label={label} value={null} state="loading" />
              ))}
          <StatCard
            label="Impact score"
            value={overview.data?.impact.overall ?? null}
            delta={overview.data?.impact.delta ?? null}
            unit="score"
            comparison={comparison}
            state={
              !overview.data
                ? 'loading'
                : overview.data.impact.overall === null
                  ? 'insufficient'
                  : 'ok'
            }
            testId="stat-impact"
          />
        </section>
      )}
      {!hasActivity && overview.data ? (
        <p className="rounded-md border bg-card px-4 py-3 text-muted-foreground" role="status">
          No activity in {overview.data.period.label}. Try a longer period.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {impact.isError ? (
          <Card>
            <ErrorState
              error={impact.error}
              what="your impact score"
              onRetry={() => void impact.refetch()}
            />
          </Card>
        ) : (
          <ImpactScoreCard
            loading={impact.isPending}
            score={impact.data?.overall ?? null}
            band={impact.data?.band ?? null}
            scoreVersion={impact.data?.scoreVersion}
            detailHref="/kpis"
            dimensions={(impact.data?.dimensions ?? []).map((d) => ({
              key: d.key,
              label: d.label,
              score: d.score,
            }))}
          />
        )}
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Top repositories</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {repos.isPending ? (
              <CardSkeleton height={120} className="border-0 p-0" />
            ) : repos.isError ? (
              <ErrorState
                error={repos.error}
                what="your repositories"
                onRetry={() => void repos.refetch()}
              />
            ) : repos.data.repos.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground">
                No repository activity in this period.
              </p>
            ) : (
              <ul className="flex flex-col">
                {repos.data.repos.map((repo) => (
                  <li
                    key={repo.repositoryId}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b py-2 last:border-b-0"
                  >
                    <span className="min-w-0 truncate font-medium">{repo.fullName}</span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {formatCount(repo.prsMerged)} merged · {formatCount(repo.prsReviewed)}{' '}
                      reviewed · {formatCount(repo.commits)} commits
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      {heatmap.isPending ? (
        <CardSkeleton height={110} />
      ) : heatmap.isError ? (
        <Card>
          <ErrorState
            error={heatmap.error}
            what="your contributions"
            onRetry={() => void heatmap.refetch()}
          />
        </Card>
      ) : (
        <ActivityHeatmap days={heatmap.data.days} title="Contributions in the last 12 months" />
      )}
    </div>
  );
}
