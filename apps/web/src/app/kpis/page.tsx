'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ImpactScoreCard } from '@/components/impact-score-card';
import { useAuth } from '@/lib/auth-context';
import { TrendingUp, Code2, Users, Shield, Loader2 } from 'lucide-react';

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

export default function KPIsPage() {
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

  if (loading && user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">KPI Dashboard</h1>
        <p className="text-muted-foreground">Track your engineering performance metrics</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Productivity</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalCommits ?? 0}</div>
            <p className="text-xs text-muted-foreground">Commits this month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Code Quality</CardTitle>
            <Code2 className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalPRs ?? 0}</div>
            <p className="text-xs text-muted-foreground">Pull requests this month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Collaboration</CardTitle>
            <Users className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalReviews ?? 0}</div>
            <p className="text-xs text-muted-foreground">Reviews this month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ownership</CardTitle>
            <Shield className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.topRepos?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground">Repos contributed</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ImpactScoreCard
          score={impactScore?.overall ?? 0}
          breakdown={{
            featureDelivery: impactScore?.featureDelivery ?? 0,
            codeQuality: impactScore?.codeQuality ?? 0,
            collaboration: impactScore?.collaboration ?? 0,
            leadership: impactScore?.leadership ?? 0,
          }}
        />

        {/* Top Repos Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top Repositories</CardTitle>
          </CardHeader>
          <CardContent>
            {summary?.topRepos && summary.topRepos.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Repository</th>
                      <th className="text-right py-2">Commits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topRepos.map((repo) => (
                      <tr key={repo.repo} className="border-b last:border-0">
                        <td className="py-2 truncate max-w-[200px]">{repo.repo}</td>
                        <td className="text-right py-2">{repo.commits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No data yet. Connect and sync your GitHub to see KPIs.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
