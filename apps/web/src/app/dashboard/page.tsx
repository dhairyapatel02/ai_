'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ImpactScoreCard } from '@/components/impact-score-card';
import { useAuth } from '@/lib/auth-context';
import { GitCommit, GitPullRequest, Eye, TrendingUp, FileText, ClipboardList, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface Summary {
  totalCommits: number;
  totalPRs: number;
  totalReviews: number;
  totalIssues: number;
  topRepos: { repo: string; commits: number }[];
  impactScore: number | null;
}

interface ImpactScoreData {
  overall: number;
  featureDelivery: number;
  codeQuality: number;
  collaboration: number;
  leadership: number;
}

export default function DashboardPage() {
  const { apiFetch, user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [impactScore, setImpactScore] = useState<ImpactScoreData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const to = now.toISOString();

      const [summaryRes, scoreRes] = await Promise.all([
        apiFetch<Summary>(`/activity/summary?from=${from}&to=${to}`),
        apiFetch<ImpactScoreData>(
          `/generate/impact-score?month=${now.getMonth() + 1}&year=${now.getFullYear()}`
        ),
      ]);

      if (summaryRes.success && summaryRes.data) setSummary(summaryRes.data);
      if (scoreRes.success && scoreRes.data) setImpactScore(scoreRes.data);
      setLoading(false);
    }
    load();
  }, [user, apiFetch]);

  const hasData = summary && (summary.totalCommits > 0 || summary.totalPRs > 0 || summary.totalReviews > 0);

  if (loading && user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Your engineering impact at a glance</p>
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
            <p className="text-lg font-medium text-muted-foreground">No activity data yet</p>
            <p className="text-sm text-muted-foreground mt-2">
              Connect an integration and sync your data to see your engineering impact.
            </p>
            <Link href="/connect">
              <Button className="mt-4">Connect GitHub</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Commits This Month</CardTitle>
            <GitCommit className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalCommits ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">PRs Merged</CardTitle>
            <GitPullRequest className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalPRs ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reviews Done</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalReviews ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Impact Score</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {impactScore ? `${Math.round(impactScore.overall)}/100` : (summary?.impactScore != null ? `${summary.impactScore}/100` : '—')}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Impact Score */}
        <ImpactScoreCard
          score={impactScore?.overall ?? summary?.impactScore ?? 0}
          breakdown={{
            featureDelivery: impactScore?.featureDelivery ?? 0,
            codeQuality: impactScore?.codeQuality ?? 0,
            collaboration: impactScore?.collaboration ?? 0,
            leadership: impactScore?.leadership ?? 0,
          }}
        />

        {/* Top Repos */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top Repositories</CardTitle>
          </CardHeader>
          <CardContent>
            {summary?.topRepos && summary.topRepos.length > 0 ? (
              <div className="space-y-3">
                {summary.topRepos.map((repo) => (
                  <div key={repo.repo} className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">{repo.repo}</span>
                    <span className="text-sm text-muted-foreground">{repo.commits} commits</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No repository data yet. Sync your GitHub to see top repos.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
