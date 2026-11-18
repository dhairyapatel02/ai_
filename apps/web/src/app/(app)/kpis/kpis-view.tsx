'use client';

import { ImpactScoreCard } from '@/components/impact-score-card';
import { InvalidPeriodState, isInvalidPeriodError, PeriodGate } from '@/components/period-gate';
import { SyncBanner } from '@/components/shell/sync-banner';
import { DeltaText, ErrorState, InfoPopover, PageHeader, PageSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDefinitions, useImpact, useKpis } from '@/lib/api/metrics-hooks';
import { formatMetric } from '@/lib/metrics-format';

/**
 * Interim KPI page (P10 builds S8 with explain drawers): the five methodology sections with
 * catalogue labels/definitions, "Not enough data · n = x of y" states and the impact score.
 */
export function KpisView() {
  return (
    <>
      <PageHeader
        title="KPIs"
        lede="Signal from your GitHub activity — not a judgement of your performance."
      />
      <PeriodGate>{(period) => <KpiSections period={period} />}</PeriodGate>
    </>
  );
}

function KpiSections({ period }: { period: string | undefined }) {
  const kpis = useKpis(period);
  const impact = useImpact(period);
  const definitions = useDefinitions();

  if (isInvalidPeriodError(kpis.error)) return <InvalidPeriodState />;
  if (kpis.isPending) return <PageSkeleton kind="list" label="Loading your KPIs…" />;
  if (kpis.isError) {
    return (
      <Card>
        <ErrorState error={kpis.error} what="your KPIs" onRetry={() => void kpis.refetch()} />
      </Card>
    );
  }

  const definitionOf = new Map((definitions.data?.metrics ?? []).map((m) => [m.key, m]));
  const scoreOf = new Map((impact.data?.dimensions ?? []).map((d) => [d.key as string, d.score]));
  const comparison =
    kpis.data.comparison === 'same_elapsed' ? 'vs same point last period' : 'vs previous period';

  return (
    <div className="flex flex-col gap-4">
      <SyncBanner />
      <ImpactScoreCard
        loading={impact.isPending}
        score={impact.data?.overall ?? null}
        band={impact.data?.band ?? null}
        scoreVersion={impact.data?.scoreVersion}
        dimensions={(impact.data?.dimensions ?? []).map((d) => ({
          key: d.key,
          label: d.label,
          score: d.score,
        }))}
      />
      {kpis.data.sections.map((section) => {
        const dimensionScore = scoreOf.get(section.key);
        return (
          <Card key={section.key} id={section.key}>
            <CardHeader className="flex flex-row flex-wrap items-center gap-2">
              <CardTitle className="flex-1">
                <h2>{section.title}</h2>
              </CardTitle>
              {section.key !== 'consistency' ? (
                <span className="text-sm text-muted-foreground">
                  {section.title} score {dimensionScore ?? '—'}
                </span>
              ) : null}
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col">
                {section.metrics.map((m) => {
                  const def = definitionOf.get(m.key);
                  const insufficient = m.status !== 'ok' || m.value === null;
                  return (
                    <li
                      key={m.key}
                      className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b py-3 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1 basis-60">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{m.label}</span>
                          <Badge variant={m.inScore ? 'accent' : 'neutral'}>
                            {m.inScore ? 'Scored' : 'Informational'}
                          </Badge>
                          {def ? (
                            <InfoPopover label={`How is ${m.label} calculated?`} title={m.label}>
                              <p>{def.definition}</p>
                              <p className="mt-2 font-mono text-caption">{def.formula}</p>
                            </InfoPopover>
                          ) : null}
                        </div>
                        {def ? (
                          <p className="text-sm text-muted-foreground">{def.definition}</p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-semibold tabular-nums" data-testid={`kpi-${m.key}`}>
                          {insufficient ? '—' : formatMetric(m)}
                        </div>
                        {insufficient ? (
                          <span className="text-caption text-subtle-foreground">
                            Not enough data · n = {m.n}
                            {def ? ` of ${def.minN} needed` : ''}
                          </span>
                        ) : (
                          <DeltaText delta={m.delta} unit={m.unit} comparison={comparison} />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-caption text-subtle-foreground">
        Durations use business hours (weekends excluded). Lines of code are never used as a KPI.{' '}
        <span className="font-mono">{kpis.data.metricsVersion}</span>
      </p>
    </div>
  );
}
