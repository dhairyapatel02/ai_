'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ImpactScoreCard } from '@/components/impact-score-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth-context';
import { formatDelta, formatMetric } from '@/lib/metrics-format';

import type { DefinitionsResponse, ImpactDto, KpisResponse } from '@devimpact/shared';

/**
 * Minimal P07 KPI page on `GET /metrics/kpis` (UX-06): the five methodology sections with the
 * catalogue's labels and definitions, honest "Not enough data" states and the deterministic impact
 * score. The designed KPI page with explain drawers (S8) arrives in P10.
 */
export default function KPIsPage() {
  const { apiFetch, user } = useAuth();
  const [kpis, setKpis] = useState<KpisResponse | null>(null);
  const [impact, setImpact] = useState<ImpactDto | null>(null);
  const [definitions, setDefinitions] = useState<DefinitionsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const [kpisRes, impactRes, defsRes] = await Promise.all([
        apiFetch<KpisResponse>('/metrics/kpis'),
        apiFetch<ImpactDto>('/impact'),
        apiFetch<DefinitionsResponse>('/metrics/definitions'),
      ]);
      if (kpisRes.success && kpisRes.data) setKpis(kpisRes.data);
      if (impactRes.success && impactRes.data) setImpact(impactRes.data);
      if (defsRes.success && defsRes.data) setDefinitions(defsRes.data);
      setLoading(false);
    }
    void load();
  }, [user, apiFetch]);

  const definitionOf = new Map((definitions?.metrics ?? []).map((m) => [m.key, m.definition]));
  const scoreOf = new Map((impact?.dimensions ?? []).map((d) => [d.key, d.score]));

  if (loading && user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">KPIs</h1>
        <p className="text-muted-foreground">
          {kpis
            ? `${kpis.period.label}${kpis.period.inProgress ? ' · in progress' : ''} · ${kpis.metricsVersion} · Only included repositories count`
            : 'Engineering KPIs from your GitHub activity'}
        </p>
      </div>

      <ImpactScoreCard
        score={impact?.overall ?? null}
        band={impact?.band ?? null}
        dimensions={(impact?.dimensions ?? []).map((d) => ({
          key: d.key,
          label: d.label,
          score: d.score,
        }))}
        scoreVersion={impact?.scoreVersion}
      />

      {(kpis?.sections ?? []).map((section) => {
        const dimensionScore = scoreOf.get(section.key as 'delivery');
        return (
          <Card key={section.key}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">{section.title}</CardTitle>
              {section.key !== 'consistency' && (
                <span className="text-sm text-muted-foreground">
                  {section.title} score {dimensionScore ?? '—'}
                </span>
              )}
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {section.metrics.map((m) => {
                  const delta = formatDelta(m);
                  return (
                    <div key={m.key} className="flex items-start justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{m.label}</span>
                          <Badge variant="secondary" className="text-xs">
                            {m.inScore ? 'Scored' : 'Informational'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{definitionOf.get(m.key)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-semibold" data-testid={`kpi-${m.key}`}>
                          {formatMetric(m)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {m.status === 'ok' ? (delta ?? '') : `n = ${m.n}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Durations use business hours (weekends excluded). Lines of code are never used as a KPI.
      </p>
    </div>
  );
}
