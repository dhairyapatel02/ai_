'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface CommitData {
  message: string;
  repo: string;
  timestamp: string;
  sha: string;
}

interface PRData {
  title: string;
  repo: string;
  state: string;
  timestamp: string;
}

interface TimelinePeriod {
  year: string;
  quarter: string;
  items: { title: string; repo: string; tags: string[] }[];
}

function groupByQuarter(commits: CommitData[], prs: PRData[]): TimelinePeriod[] {
  const quarters: Record<string, { title: string; repo: string; tags: string[] }[]> = {};

  for (const pr of prs) {
    const d = new Date(pr.timestamp);
    const q = `Q${Math.ceil((d.getMonth() + 1) / 3)}`;
    const key = `${d.getFullYear()}-${q}`;
    if (!quarters[key]) quarters[key] = [];
    quarters[key].push({
      title: pr.title,
      repo: pr.repo,
      tags: [pr.state === 'MERGED' ? 'merged' : pr.state.toLowerCase()],
    });
  }

  const repoCommitCounts: Record<string, Record<string, number>> = {};
  for (const c of commits) {
    const d = new Date(c.timestamp);
    const q = `Q${Math.ceil((d.getMonth() + 1) / 3)}`;
    const key = `${d.getFullYear()}-${q}`;
    if (!repoCommitCounts[key]) repoCommitCounts[key] = {};
    repoCommitCounts[key][c.repo] = (repoCommitCounts[key][c.repo] || 0) + 1;
  }

  for (const [key, repos] of Object.entries(repoCommitCounts)) {
    if (!quarters[key]) quarters[key] = [];
    for (const [repo, count] of Object.entries(repos)) {
      const existing = quarters[key].find((i) => i.repo === repo);
      if (existing) {
        existing.tags.push(`${count} commits`);
      } else {
        quarters[key].push({ title: `${count} commits`, repo, tags: ['commits'] });
      }
    }
  }

  return Object.entries(quarters)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, items]) => {
      const [year, quarter] = key.split('-');
      return { year, quarter, items: items.slice(0, 8) };
    });
}

export default function CareerPage() {
  const { apiFetch, user } = useAuth();
  const [timeline, setTimeline] = useState<TimelinePeriod[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const from = sixMonthsAgo.toISOString();
      const to = new Date().toISOString();

      const [commitsRes, prsRes] = await Promise.all([
        apiFetch<{ data: CommitData[]; total: number }>(`/activity/commits?from=${from}&to=${to}&limit=200`),
        apiFetch<{ data: PRData[]; total: number }>(`/activity/prs?from=${from}&to=${to}&limit=200`),
      ]);

      const commits = commitsRes.success && commitsRes.data ? commitsRes.data.data : [];
      const prs = prsRes.success && prsRes.data ? prsRes.data.data : [];
      setTimeline(groupByQuarter(commits, prs));
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
        <h1 className="text-3xl font-bold">Career Timeline</h1>
        <p className="text-muted-foreground">Your engineering journey visualized</p>
      </div>

      {timeline.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-lg font-medium text-muted-foreground">No timeline data yet</p>
            <p className="text-sm text-muted-foreground mt-2">
              Connect an integration and sync your data to build your career timeline.
            </p>
            <Link href="/connect">
              <Button className="mt-4">Connect GitHub</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {timeline.map((period, idx) => (
            <div key={idx} className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold text-sm">
                  {period.quarter}
                </div>
                <h2 className="text-xl font-semibold">{period.year} {period.quarter}</h2>
              </div>
              <div className="ml-5 border-l-2 border-border pl-6 space-y-3">
                {period.items.map((item, i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-medium">{item.title}</h3>
                          <p className="text-sm text-muted-foreground">{item.repo}</p>
                        </div>
                        <div className="flex gap-1 flex-wrap">
                          {item.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
