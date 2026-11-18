'use client';

import {
  ImpactNarrativeContent,
  type EvidenceItem,
  type ImpactDto,
  type ImpactHistoryResponse,
} from '@devimpact/shared';
import { RotateCw, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { ImpactHistoryChart } from '@/components/impact-history-chart';
import { NotConnectedState, useConnected } from '@/components/not-connected-state';
import { InvalidPeriodState, isInvalidPeriodError } from '@/components/period-gate';
import { SyncBanner } from '@/components/shell/sync-banner';
import { CardSkeleton, ErrorState, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError, quotaDetails, errorMessage } from '@/lib/api/errors';
import { isBackfilling, useMe, useSyncStatus } from '@/lib/api/hooks';
import {
  useDefinitions,
  useDocument,
  useGenerateHighlights,
  useImpact,
  useImpactHistory,
} from '@/lib/api/metrics-hooks';
import { formatUnitValue, type LinePoint } from '@/lib/charts';
import { formatDate, formatLocalMonth, formatTime } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { cn } from '@/lib/utils';


/** §6.7: what each dimension combines. */
const DIMENSION_SUMMARY: Record<string, string> = {
  delivery: 'PRs merged, cycle time, steady weeks',
  quality: 'Small PRs, reverts, merge rate',
  collaboration: 'PRs reviewed, review turnaround, review balance',
  ownership: 'Repositories where you both ship and review, breadth',
};

/** History points → line points (gaps for insufficient months, notes for old versions / importing). */
export function historyPoints(
  history: ImpactHistoryResponse,
  options: { importingBefore?: string } = {},
): LinePoint[] {
  return history.points.map((p) => {
    const value = p.status === 'ok' ? p.overall : null;
    let note: string | undefined;
    if (value === null) {
      note =
        options.importingBefore && p.period.startDate < options.importingBefore
          ? 'Importing'
          : 'Not enough activity for a fair score';
    } else if (p.scoreVersion !== history.scoreVersion) {
      note = `Calculated with an earlier version (${p.scoreVersion})`;
    } else if (p.band) {
      note = p.band;
    }
    return {
      label: `${p.period.label}${p.period.inProgress ? ' (in progress)' : ''}`,
      short: formatLocalMonth(p.period.startDate, false),
      value,
      note,
    };
  });
}

/** Impact score detail (S9): explanation, components, history and AI highlights. */
export function ImpactView() {
  const connected = useConnected();
  const period = usePeriod();
  if (!connected) {
    return (
      <>
        <PageHeader title="Impact score" />
        <NotConnectedState />
      </>
    );
  }
  if (period.invalid) {
    return (
      <>
        <PageHeader title="Impact score" />
        <InvalidPeriodState message={period.invalid} />
      </>
    );
  }
  return <ImpactPage />;
}

function ImpactPage() {
  const period = usePeriod();
  const sync = useSyncStatus();
  const impact = useImpact(period.apiParam);
  const history = useImpactHistory('month', 12);
  const resolved = impact.data?.period ?? period.resolved;

  const importingBefore =
    isBackfilling(sync.data) && period.today
      ? new Date(Date.parse(`${period.today}T00:00:00Z`) - 29 * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : undefined;

  return (
    <>
      <PageHeader
        title="Impact score"
        lede={
          resolved ? (
            <>
              {resolved.label}
              {resolved.inProgress ? ' · in progress' : ''} ·{' '}
              <span className="font-mono">{impact.data?.scoreVersion ?? 'impact@2.0.0'}</span>
            </>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-4">
        <SyncBanner />
        {isInvalidPeriodError(impact.error) ? (
          <InvalidPeriodState />
        ) : impact.isError ? (
          <Card>
            <ErrorState
              error={impact.error}
              what="your impact score"
              onRetry={() => void impact.refetch()}
            />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr] [&>*]:min-w-0">
            {impact.data ? <OverallCard impact={impact.data} /> : <CardSkeleton height={200} />}
            <HighlightsCard impact={impact.data} periodSpec={period.apiParam ?? resolved?.spec} />
          </div>
        )}
        {history.isPending ? (
          <CardSkeleton height={220} />
        ) : history.isError ? (
          <Card>
            <ErrorState
              error={history.error}
              what="your score history"
              onRetry={() => void history.refetch()}
            />
          </Card>
        ) : (
          <ImpactHistoryChart
            points={historyPoints(history.data, { importingBefore })}
            description="Monthly · last 12 months"
          />
        )}
        {impact.data ? (
          <div
            className={cn(
              'grid gap-4 md:grid-cols-2 [&>*]:min-w-0',
              impact.isPlaceholderData && 'opacity-60',
            )}
          >
            {impact.data.dimensions.map((d) => (
              <DimensionCard
                key={d.key}
                dimension={d}
                scored={impact.data.status === 'ok'}
                periodSpec={period.urlSpec}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <CardSkeleton key={i} height={140} />
            ))}
          </div>
        )}
        <p className="text-caption text-subtle-foreground">
          &ldquo;Adjusted&rdquo; pulls small samples toward 50 (k = 3). A component without enough
          data is dropped and the others in its dimension are re-weighted. Bands: 0–39 Low signal ·
          40–59 Moderate · 60–79 Strong · 80–100 Very strong.
        </p>
      </div>
    </>
  );
}

function OverallCard({ impact }: { impact: ImpactDto }) {
  const paragraphs = impact.explanation.split(/\n{2,}/);
  return (
    <section
      aria-label="Overall score"
      className="flex flex-col gap-4 rounded-md border bg-card p-5"
    >
      {impact.status === 'ok' && impact.overall !== null ? (
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-5xl font-semibold tracking-tight" data-testid="impact-overall">
            {impact.overall}
          </span>
          <span className="text-lg text-subtle-foreground">/ 100</span>
          {impact.band ? <Badge variant="accent">{impact.band}</Badge> : null}
        </div>
      ) : (
        <div>
          <Badge variant="neutral" data-testid="impact-overall">
            Not enough data
          </Badge>
        </div>
      )}
      <div className="flex max-w-[68ch] flex-col gap-3 text-base">
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className={cn(
              i === 0 && 'font-medium',
              i === paragraphs.length - 1 && 'text-caption text-subtle-foreground',
              i > 0 && i < paragraphs.length - 1 && 'text-muted-foreground',
            )}
          >
            {p}
          </p>
        ))}
      </div>
    </section>
  );
}

function EvidenceRefLink({
  refId,
  evidence,
}: {
  refId: string;
  evidence: Map<string, EvidenceItem>;
}) {
  const item = evidence.get(refId);
  const cls =
    'inline-flex h-6 items-center rounded-xs border border-border-strong px-1.5 align-middle font-mono text-[11.5px] text-muted-foreground';
  if (item?.url) {
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(cls, 'hover:text-foreground')}
        aria-label={`Evidence ${refId}: ${item.title} (opens on GitHub)`}
      >
        {refId.replace(/^[A-Z]+-(?:[^/]+\/)?/, '')}
      </a>
    );
  }
  return (
    <span className={cls} aria-label={`Evidence ${refId}`} role="note">
      {refId.replace(/^[A-Z]+-(?:[^/]+\/)?/, '')}
    </span>
  );
}

/**
 * Highlights (F-29, P08): explicit, cached per period, fast model. The narrative never carries
 * numbers of its own — every number on this page comes from the metrics engine.
 */
function HighlightsCard({
  impact,
  periodSpec,
}: {
  impact: ImpactDto | undefined;
  periodSpec: string | undefined;
}) {
  const me = useMe();
  const generate = useGenerateHighlights();
  const doc = useDocument(impact?.highlights?.documentId ?? null);
  const timezone = me.data?.settings.timezone;
  const fresh =
    generate.data && generate.data.document.period?.spec === impact?.period.spec
      ? generate.data
      : null;
  const parsed = fresh
    ? { content: fresh.content, evidence: fresh.evidence, at: fresh.document.updatedAt }
    : doc.data?.version
      ? (() => {
          const content = ImpactNarrativeContent.safeParse(doc.data.version.content);
          return content.success
            ? {
                content: content.data,
                evidence: doc.data.document.evidence,
                at: doc.data.document.updatedAt,
              }
            : null;
        })()
      : null;
  const evidence = new Map((parsed?.evidence ?? []).map((e) => [e.ref, e]));
  const insufficient = impact?.status === 'insufficient_data';
  const error = generate.error;
  const quota = isApiError(error) ? quotaDetails(error) : null;
  const errorText = !error
    ? null
    : quota
      ? `Quick AI actions used up for ${formatLocalMonth(new Date().toISOString().slice(0, 10))}. They reset on ${formatDate(quota.resetsAt, { withYear: false })}.`
      : isApiError(error) && error.code === 'CONFLICT'
        ? 'Highlights need an impact score for the period.'
        : isApiError(error) && (error.code === 'UPSTREAM_UNAVAILABLE' || error.status === 503)
          ? 'The AI service is busy. Try again in a minute.'
          : errorMessage(error, 'the highlights');

  const run = (regenerate: boolean) => {
    if (!periodSpec) return;
    generate.mutate({ period: periodSpec, regenerate });
  };

  return (
    <Card aria-labelledby="highlights-title">
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle className="mr-auto">
          <h2 id="highlights-title">Highlights</h2>
        </CardTitle>
        <Badge variant="neutral">
          <Sparkles aria-hidden="true" />
          AI
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3" aria-live="polite">
        {!impact ? (
          <Skeleton className="h-20 w-full" />
        ) : insufficient ? (
          <>
            <p className="text-sm text-muted-foreground">
              Highlights need an impact score for the period.
            </p>
            <Button size="sm" variant="secondary" className="self-start" disabled>
              <Sparkles aria-hidden="true" />
              Generate highlights
            </Button>
          </>
        ) : generate.isPending || (doc.isPending && impact.highlights) ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-5/6" />
            <span className="text-caption text-subtle-foreground" role="status">
              {generate.isPending ? 'Writing highlights…' : 'Loading highlights…'}
            </span>
          </div>
        ) : parsed ? (
          <>
            <p className="text-sm">{parsed.content.summary.text}</p>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm" data-testid="highlights">
              {parsed.content.highlights.map((h) => (
                <li key={h.id}>
                  <b className="font-medium">{h.title}.</b> {h.text}{' '}
                  {h.citations.map((ref) => (
                    <EvidenceRefLink key={ref} refId={ref} evidence={evidence} />
                  ))}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-caption text-subtle-foreground">
                Generated {formatTime(parsed.at, timezone)} · cached for this period
              </span>
              <Button size="sm" variant="ghost" onClick={() => { run(true); }}>
                <RotateCw aria-hidden="true" />
                Regenerate
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Get a short narrative of what drove this score, with links to the pull requests behind
              it. Numbers always come from the metrics engine.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" disabled={!!quota} onClick={() => { run(false); }}>
                <Sparkles aria-hidden="true" />
                Generate highlights
              </Button>
              <span className="text-caption text-subtle-foreground">Uses 1 quick AI action</span>
            </div>
          </>
        )}
        {errorText ? (
          <p className="text-sm text-destructive" role="alert">
            {errorText}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DimensionCard({
  dimension,
  scored,
  periodSpec,
}: {
  dimension: ImpactDto['dimensions'][number];
  scored: boolean;
  periodSpec: string | null;
}) {
  const definitions = useDefinitions();
  const labelOf = (key: string) =>
    definitions.data?.metrics.find((m) => m.key === key)?.label ?? key;
  const unitOf = (key: string) =>
    definitions.data?.metrics.find((m) => m.key === key)?.unit ?? 'count';
  const qs = periodSpec ? `&period=${encodeURIComponent(periodSpec)}` : '';
  return (
    <section
      aria-labelledby={`dim-${dimension.key}`}
      className="rounded-md border bg-card"
      data-testid={`dimension-${dimension.key}`}
    >
      <div className="flex flex-wrap items-start gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id={`dim-${dimension.key}`} className="text-base font-semibold">
            {dimension.label}
          </h2>
          <p className="text-sm text-muted-foreground">
            {DIMENSION_SUMMARY[dimension.key]} · weight {Math.round(dimension.weight * 100)}%
          </p>
        </div>
        <b className="text-2xl font-semibold">
          {scored && dimension.score !== null ? dimension.score : '—'}
        </b>
      </div>
      {!dimension.available && scored ? (
        <p className="border-b px-4 py-2 text-caption text-subtle-foreground">
          {dimension.label} wasn&apos;t scored this period because there wasn&apos;t enough data;
          the other dimensions were re-weighted.
        </p>
      ) : null}
      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label={`${dimension.label} components`}
      >
        <table className="w-full min-w-[520px] text-sm">
          <caption className="sr-only">{dimension.label} components</caption>
          <thead>
            <tr className="border-b text-muted-foreground">
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Metric
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Value
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                n
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Band
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Adjusted
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Weight
              </th>
            </tr>
          </thead>
          <tbody>
            {dimension.components.map((c) => (
              <tr key={c.metric} className="border-b last:border-b-0">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  <Link
                    href={`/kpis?metric=${c.metric}${qs}`}
                    className="text-link underline-offset-2 hover:underline"
                  >
                    {labelOf(c.metric)}
                  </Link>
                </th>
                <td className="px-2 py-2 text-right tabular-nums">
                  {formatUnitValue(c.value, unitOf(c.metric))}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{c.n}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {c.bandScore === null ? '—' : c.bandScore.toFixed(1)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {c.shrunkScore === null ? (
                    c.available ? (
                      <span className="text-subtle-foreground">no shrink</span>
                    ) : (
                      '—'
                    )
                  ) : (
                    c.shrunkScore.toFixed(1)
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {c.available ? (
                    `${Math.round(c.effectiveWeight * 100)}%`
                  ) : (
                    <span className="text-subtle-foreground">dropped</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
