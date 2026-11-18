'use client';

import Link from 'next/link';

import { MetricColumnChart } from '@/components/metric-column-chart';
import { ErrorState } from '@/components/states';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useHydrated } from '@/hooks/use-hydrated';
import { useMetricEvidence, useTimeseries } from '@/lib/api/metrics-hooks';
import { formatUnitValue, timeseriesColumns } from '@/lib/charts';
import { formatDate, plural } from '@/lib/format';

import type { MetricDefinition, MetricValue, ResolvedPeriodDto } from '@devimpact/shared';
import type { ReactNode } from 'react';

const SECTION: Record<string, string> = {
  delivery: 'Delivery',
  quality: 'Quality',
  collaboration: 'Collaboration',
  ownership: 'Ownership',
  consistency: 'Consistency',
  issues: 'Issues',
};

const DIRECTION: Record<string, string> = {
  lower_is_better: 'Lower is better',
  higher_is_better: 'Higher is better, up to a point',
  neutral: 'Context only',
};

/** First day of the month five months before `endDate`'s month → 6 calendar months. */
export function sixMonthRange(endDate: string): { from: string; to: string } {
  const year = Number(endDate.slice(0, 4));
  const month = Number(endDate.slice(5, 7)) - 1 - 5;
  const d = new Date(Date.UTC(year, month, 1));
  return { from: d.toISOString().slice(0, 10), to: endDate };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  );
}

function DrawerChart({
  metric,
  period,
  label,
}: {
  metric: string;
  period: ResolvedPeriodDto;
  label: string;
}) {
  const range = sixMonthRange(period.endDate);
  // Custom from/to: the API accepts `period` or a local-date range; the drawer always shows months.
  const series = useTimeseries(metric, 'month', `custom:${range.from}..${range.to}`);
  if (series.isPending) return <Skeleton className="h-40 w-full" />;
  if (series.isError) {
    return (
      <ErrorState
        error={series.error}
        what="the last 6 months"
        headingLevel={3}
        className="py-4"
        onRetry={() => void series.refetch()}
      />
    );
  }
  return (
    <MetricColumnChart
      points={timeseriesColumns(series.data)}
      unit={series.data.unit}
      metricLabel={label}
    />
  );
}

function Evidence({
  metric,
  periodSpec,
  timezone,
}: {
  metric: string;
  periodSpec: string | undefined;
  timezone?: string;
}) {
  const evidence = useMetricEvidence(metric, periodSpec, 8);
  const total = evidence.data?.meta.total ?? evidence.data?.items.length ?? 0;
  const activityHref = `/activity?metric=${metric}${periodSpec ? `&period=${encodeURIComponent(periodSpec)}` : ''}`;
  return (
    <section className="flex flex-col gap-1.5" aria-labelledby="evidence-title">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 id="evidence-title" className="font-medium">
          Evidence
        </h3>
        {evidence.data ? (
          <span className="text-caption text-subtle-foreground">{plural(total, 'record')}</span>
        ) : null}
        {total > 0 ? (
          <Link
            href={activityHref}
            className="ml-auto text-sm text-link underline underline-offset-2"
          >
            Open in Activity
          </Link>
        ) : null}
      </div>
      {evidence.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : evidence.isError ? (
        <ErrorState
          error={evidence.error}
          what="the evidence"
          headingLevel={3}
          className="py-4"
          onRetry={() => void evidence.refetch()}
        />
      ) : evidence.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No records behind this metric in this period.
        </p>
      ) : (
        <ul className="flex flex-col">
          {evidence.data.items.map((e) => (
            <li
              key={`${e.kind}:${e.id}`}
              className="flex flex-col gap-0.5 border-b py-2 last:border-b-0"
            >
              {e.url ? (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-sm font-medium hover:underline"
                >
                  {e.title}
                  <span className="sr-only"> (opens on GitHub)</span>
                </a>
              ) : (
                <span className="truncate text-sm font-medium">{e.title}</span>
              )}
              <span className="flex flex-wrap items-center gap-2">
                <span className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-caption text-muted-foreground">
                  {e.ref}
                </span>
                <span className="text-caption text-subtle-foreground">
                  {formatDate(e.occurredAt, { timeZone: timezone })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * ExplainDrawer (DESIGN_SYSTEM §5.2, FLOWS F9): definition, value / n / min n, good range and
 * direction, formula (mono), last 6 months as columns + table, caveats, anti-gaming, evidence,
 * versions and time zone. Opened from `?metric=` so it can be linked and Back closes it.
 */
export function ExplainDrawer({
  metric,
  definition,
  value,
  period,
  periodSpec,
  metricsVersion,
  timezone,
  onClose,
}: {
  metric: string | null;
  definition: MetricDefinition | undefined;
  value: MetricValue | undefined;
  period: ResolvedPeriodDto | undefined;
  periodSpec: string | undefined;
  metricsVersion: string | undefined;
  timezone: string | undefined;
  onClose: () => void;
}) {
  const hydrated = useHydrated();
  const open = hydrated && metric !== null;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent side="right" className="w-full gap-0 sm:max-w-lg" data-testid="explain-drawer">
        {!definition || !metric ? (
          <SheetHeader>
            <SheetTitle>{open ? 'Loading metric…' : 'Metric'}</SheetTitle>
            <SheetDescription className="sr-only">Metric definition</SheetDescription>
            {open ? <Skeleton className="h-40 w-full" /> : null}
          </SheetHeader>
        ) : (
          <>
            <SheetHeader className="pr-12">
              <SheetDescription>
                {SECTION[definition.section] ?? definition.section} ·{' '}
                {definition.inScore ? 'Scored' : 'Informational — not scored'}
              </SheetDescription>
              <SheetTitle className="text-lg">{definition.label}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6">
              <p>{definition.definition}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-0.5 rounded-md bg-surface-2 p-3">
                  <span className="text-caption text-subtle-foreground">
                    {period?.label ?? 'This period'}
                  </span>
                  <b className="text-lg font-semibold" data-testid="explain-value">
                    {value?.status === 'ok' && value.value !== null
                      ? formatUnitValue(value.value, value.unit)
                      : 'Not enough data'}
                  </b>
                  <span className="text-caption text-subtle-foreground">
                    Sample n = {value?.n ?? 0}
                    {definition.minN ? ` · minimum ${definition.minN}` : ''}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 rounded-md bg-surface-2 p-3">
                  <span className="text-caption text-subtle-foreground">Good range</span>
                  <span className="text-sm font-medium">{definition.goodRange}</span>
                  <span className="text-caption text-subtle-foreground">
                    {DIRECTION[definition.direction] ?? ''}
                  </span>
                </div>
              </div>
              <Section title="Formula">
                <code className="block rounded-md bg-surface-2 p-3 font-mono text-caption whitespace-pre-wrap">
                  {definition.formula}
                </code>
              </Section>
              <Section title="Last 6 months">
                {period ? (
                  <DrawerChart metric={metric} period={period} label={definition.label} />
                ) : null}
              </Section>
              {definition.caveats.length ? (
                <Section title="Keep in mind">
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                    {definition.caveats.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </Section>
              ) : null}
              {definition.antiGaming ? (
                <Section title="Why gaming it doesn't help">
                  <p className="text-sm text-muted-foreground">{definition.antiGaming}</p>
                </Section>
              ) : null}
              <Evidence metric={metric} periodSpec={periodSpec} timezone={timezone} />
              <p className="text-caption text-subtle-foreground">
                <span className="font-mono">{metricsVersion ?? ''}</span>
                {timezone ? ` · Times in ${timezone}` : ''} · Excluded repositories are ignored.
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
