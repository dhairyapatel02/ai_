'use client';

import { Gauge } from 'lucide-react';
import Link from 'next/link';

import { ExplainDrawer } from '@/components/explain-drawer';
import { MetricRow } from '@/components/metric-row';
import { NotConnectedState, useConnected } from '@/components/not-connected-state';
import { InvalidPeriodState, isInvalidPeriodError } from '@/components/period-gate';
import { SyncBanner } from '@/components/shell/sync-banner';
import { ErrorState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { isBackfilling, useMe, useSyncStatus } from '@/lib/api/hooks';
import { useDefinitions, useImpact, useKpis, useTrends } from '@/lib/api/metrics-hooks';
import { startsBeforeRecentWindow, usePeriod } from '@/lib/period';
import { useSearchParamsState } from '@/lib/url-state';
import { cn } from '@/lib/utils';

import type { KpisResponse, MetricDefinition } from '@devimpact/shared';

/** Section intros (prototype `SECTIONS`, S8). Titles come from the API. */
export const SECTION_INTRO: Record<string, string> = {
  delivery: 'How steadily your own work reaches production.',
  quality: 'Habits that make changes easy to review and safe to ship.',
  collaboration: "How you support teammates' work through reviews.",
  ownership: 'Where you both ship and review — shared ownership of code.',
  consistency: 'Steadiness over the period. Shown for reflection; mostly not scored.',
};

/** KPIs (S8): five sections, honest values, trends and explanations. */
export function KpisView() {
  const connected = useConnected();
  const period = usePeriod();
  if (!connected) {
    return (
      <>
        <PageHeader title="KPIs" />
        <div className="flex flex-col gap-4">
          <NotConnectedState secondary={null} />
          <HowMetricsWork />
        </div>
      </>
    );
  }
  if (period.invalid) {
    return (
      <>
        <PageHeader title="KPIs" />
        <InvalidPeriodState message={period.invalid} />
      </>
    );
  }
  return <KpiPage />;
}

function KpiPage() {
  const period = usePeriod();
  const me = useMe();
  const sync = useSyncStatus();
  const url = useSearchParamsState();
  const kpis = useKpis(period.apiParam);
  const impact = useImpact(period.apiParam);
  const definitions = useDefinitions();
  const trends = useTrends(period.apiParam, 6);
  const metricParam = url.get('metric');

  const definitionOf = new Map((definitions.data?.metrics ?? []).map((m) => [m.key as string, m]));
  // An unknown `?metric=` (stale link) leaves the drawer closed instead of loading forever.
  const metric =
    metricParam && (!definitions.data || definitionOf.has(metricParam)) ? metricParam : null;
  const trendOf = new Map((trends.data?.series ?? []).map((s) => [s.metric as string, s.values]));
  const allValues = (kpis.data?.sections ?? []).flatMap((s) => s.metrics);
  const resolved = kpis.data?.period ?? null;
  const backfilling = isBackfilling(sync.data);
  const comparison = kpis.data?.comparison === 'same_elapsed' ? 'vs same point' : 'vs previous';

  const lede = period.resolved ? (
    <>
      {period.resolved.label}
      {period.resolved.inProgress ? ' · in progress' : ''} ·{' '}
      <span className="font-mono">
        {kpis.data?.metricsVersion ?? definitions.data?.metricsVersion ?? 'metrics@2.0.0'}
      </span>{' '}
      · Only included repositories count
      {backfilling && period.today && startsBeforeRecentWindow(period.resolved, period.today) ? (
        <span className="text-warning"> · Partial — import in progress</span>
      ) : null}
    </>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="KPIs"
        lede={lede}
        actions={
          <Button variant="secondary" asChild>
            <Link
              href={`/kpis/impact${period.urlSpec ? `?period=${encodeURIComponent(period.urlSpec)}` : ''}`}
            >
              <Gauge aria-hidden="true" />
              Impact score
              {impact.data?.overall !== null && impact.data?.overall !== undefined ? (
                <b className="font-semibold">{impact.data.overall}</b>
              ) : null}
            </Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <SyncBanner />
        {isInvalidPeriodError(kpis.error) ? (
          <InvalidPeriodState />
        ) : kpis.isError ? (
          <Card>
            <ErrorState error={kpis.error} what="your KPIs" onRetry={() => void kpis.refetch()} />
          </Card>
        ) : (
          <>
            <nav
              aria-label="KPI sections"
              className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 md:mx-0 md:px-0"
            >
              {(kpis.data?.sections.map((s) => [s.key, s.title]) ?? []).map(([key, title]) => (
                <a
                  key={key}
                  href={`#sec-${key}`}
                  className="shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:border-border-strong hover:text-foreground"
                >
                  {title}
                </a>
              ))}
            </nav>
            {kpis.isPending ? (
              <SectionsSkeleton />
            ) : (
              <div
                className={cn(
                  'flex flex-col gap-4 transition-opacity',
                  kpis.isPlaceholderData && 'opacity-60',
                )}
              >
                {kpis.data.sections.map((section) => (
                  <SectionCard
                    key={section.key}
                    section={section}
                    dimension={impact.data?.dimensions.find(
                      (d) => d.key === (section.key as string),
                    )}
                    scored={impact.data?.status === 'ok'}
                    definitionOf={definitionOf}
                    trendOf={trendOf}
                    comparison={comparison}
                    onExplain={(key) => {
                      url.set({ metric: key });
                    }}
                  />
                ))}
              </div>
            )}
            <p className="text-caption text-subtle-foreground">
              Durations use business hours (weekends excluded; holidays are not modelled). Volume
              metrics stop adding to the score beyond healthy levels. Lines of code are never used
              as a KPI.
            </p>
          </>
        )}
      </div>
      <ExplainDrawer
        metric={metric}
        definition={metric ? definitionOf.get(metric) : undefined}
        value={allValues.find((v) => v.key === metric)}
        period={resolved ?? undefined}
        periodSpec={period.apiParam}
        metricsVersion={kpis.data?.metricsVersion ?? definitions.data?.metricsVersion}
        timezone={me.data?.settings.timezone}
        onClose={() => {
          url.set({ metric: null });
        }}
      />
    </>
  );
}

function SectionCard({
  section,
  dimension,
  scored,
  definitionOf,
  trendOf,
  comparison,
  onExplain,
}: {
  section: KpisResponse['sections'][number];
  dimension: { score: number | null; weight: number } | undefined;
  scored: boolean;
  definitionOf: Map<string, MetricDefinition>;
  trendOf: Map<string, (number | null)[]>;
  comparison: string;
  onExplain: (key: string) => void;
}) {
  return (
    <section
      id={`sec-${section.key}`}
      aria-labelledby={`sh-${section.key}`}
      className="scroll-mt-(--topbar-height) rounded-md border bg-card"
    >
      <div className="flex flex-wrap items-start gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1 basis-56">
          <h2 id={`sh-${section.key}`} className="text-base font-semibold">
            {section.title}
          </h2>
          <p className="text-sm text-muted-foreground">{SECTION_INTRO[section.key]}</p>
        </div>
        {dimension ? (
          <div
            className="flex items-baseline gap-2 text-right"
            data-testid={`section-score-${section.key}`}
          >
            <span className="text-sm text-muted-foreground">{section.title} score</span>
            <b className="text-lg font-semibold">
              {scored && dimension.score !== null ? dimension.score : '—'}
            </b>
            <span className="text-caption text-subtle-foreground">
              weight {Math.round(dimension.weight * 100)}%
            </span>
          </div>
        ) : section.key === 'consistency' ? (
          <span className="text-caption text-subtle-foreground">Active weeks feeds Delivery</span>
        ) : null}
      </div>
      <ul>
        {section.metrics.map((m) => (
          <MetricRow
            key={m.key}
            value={m}
            definition={definitionOf.get(m.key)}
            trend={trendOf.get(m.key)}
            comparison={comparison}
            onExplain={() => {
              onExplain(m.key);
            }}
          />
        ))}
      </ul>
    </section>
  );
}

function SectionsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3 rounded-md border bg-card p-4">
          <Skeleton className="h-5 w-40" />
          {[0, 1, 2].map((j) => (
            <Skeleton key={j} className="h-10 w-full" />
          ))}
        </div>
      ))}
      <p className="sr-only" role="status">
        Loading your KPIs…
      </p>
    </div>
  );
}

/** Definitions stay browsable without a connection (S8 Empty — no integration). */
function HowMetricsWork() {
  const definitions = useDefinitions();
  if (!definitions.data) return null;
  const sections = ['delivery', 'quality', 'collaboration', 'ownership', 'consistency'];
  return (
    <section aria-labelledby="how-metrics" className="rounded-md border bg-card">
      <h2 id="how-metrics" className="border-b px-4 py-3 text-base font-semibold">
        How metrics work
      </h2>
      <dl className="flex flex-col">
        {definitions.data.metrics
          .filter((m) => !m.deferred && sections.includes(m.section))
          .map((m) => (
            <div key={m.key} className="border-b px-4 py-2.5 last:border-b-0">
              <dt className="font-medium">{m.label}</dt>
              <dd className="text-sm text-muted-foreground">{m.definition}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}
