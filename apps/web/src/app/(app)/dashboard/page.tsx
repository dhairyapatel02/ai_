'use client';

import {
  GitCommit,
  GitPullRequest,
  Eye,
  TrendingUp,
  FileText,
  ClipboardList,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ImpactScoreCard } from '@/components/impact-score-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth-context';
import { formatDelta, formatMetric } from '@/lib/metrics-format';

import type { ImpactDto, MetricValue, OverviewResponse, ReposResponse } from '@devimpact/shared';

const CARD_ICONS: Record<string, typeof GitCommit> = {
  commits: GitCommit,
  prs_merged: GitPullRequest,
  prs_reviewed: Eye,
};

/**
 * Minimal P07 dashboard on the deterministic metrics API (DATA-02, AI-01, UX-06): stat cards from
 * `GET /metrics/overview`, dimensions from `GET /impact`, repositories from `GET /metrics/repos`.
 * No AI call on page load. The designed dashboard (S6) arrives in P10.
 */
export default function DashboardPage() {
  const { apiFetch, user } = useAuth();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [impact, setImpact] = useState<ImpactDto | null>(null);
  const [repos, setRepos] = useState<ReposResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const [overviewRes, impactRes, reposRes] = await Promise.all([
        apiFetch<OverviewResponse>('/metrics/overview'),
        apiFetch<ImpactDto>('/impact'),
        apiFetch<ReposResponse>('/metrics/repos?limit=5'),
      ]);
      if (overviewRes.success && overviewRes.data) setOverview(overviewRes.data);
      if (impactRes.success && impactRes.data) setImpact(impactRes.data);
      if (reposRes.success && reposRes.data) setRepos(reposRes.data);
      setLoading(false);
    }
    void load();
  }, [user, apiFetch]);

  const hasData = overview?.cards.some((c) => (c.value ?? 0) > 0) ?? false;
  const comparisonLabel =
    overview?.comparison === 'same_elapsed' ? 'vs same point last period' : 'vs previous period';

  if (loading && user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            {overview
              ? `${overview.period.label}${overview.period.inProgress ? ' · in progress' : ''}`
              : 'Your engineering impact at a glance'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/resume">
            <Button variant="outline" className="gap-2">
              <FileText className="h-4 w-4" />
              Generate Resume
            </Button>
          </Link>
          <Link href="/appraisal">
            <Button className="gap-2">
              <ClipboardList className="h-4 w-4" />
              Generate Appraisal
            </Button>
          </Link>
        </div>
      </div>

      {!hasData && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-lg font-medium text-muted-foreground">No activity in this period</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Connect an integration and sync your data to see your engineering impact.
            </p>
            <Link href="/connect">
              <Button className="mt-4">Connect GitHub</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {(overview?.cards ?? []).map((card) => (
          <StatCard key={card.key} card={card} comparisonLabel={comparisonLabel} />
        ))}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Impact score</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {overview?.impact.overall != null ? `${overview.impact.overall}/100` : '—'}
            </div>
            <p className="text-xs text-muted-foreground">
              {overview?.impact.overall != null
                ? `${overview.impact.band ?? ''}${overview.impact.delta != null ? ` · ${overview.impact.delta >= 0 ? '+' : ''}${overview.impact.delta} pts` : ''}`
                : 'Not enough data'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
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

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top Repositories</CardTitle>
          </CardHeader>
          <CardContent>
            {repos && repos.repos.length > 0 ? (
              <div className="space-y-3">
                {repos.repos.map((repo) => (
                  <div key={repo.repositoryId} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{repo.fullName}</span>
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {repo.prsMerged} merged · {repo.prsReviewed} reviewed · {repo.commits} commits
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No repository activity in this period.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ card, comparisonLabel }: { card: MetricValue; comparisonLabel: string }) {
  const Icon = CARD_ICONS[card.key] ?? GitCommit;
  const delta = formatDelta(card);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={`stat-${card.key}`}>
          {formatMetric(card)}
        </div>
        {delta && (
          <p className="text-xs text-muted-foreground">
            {delta} {comparisonLabel}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
