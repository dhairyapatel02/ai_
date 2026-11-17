'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/lib/auth-context';

import type { CareerTimelineResponse } from '@devimpact/shared';

/**
 * Minimal P07 career page on `GET /career/timeline` (server-side aggregation; fixes PERF-03's
 * 200-row client grouping and the reviewed-PR/commit-count noise). The designed timeline (S10)
 * arrives in P10.
 */
export default function CareerPage() {
  const { apiFetch, user } = useAuth();
  const [timeline, setTimeline] = useState<CareerTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const res = await apiFetch<CareerTimelineResponse>('/career/timeline');
      if (res.success && res.data) setTimeline(res.data);
      setLoading(false);
    }
    void load();
  }, [user, apiFetch]);

  if (loading && user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const quarters = (timeline?.quarters ?? []).filter(
    (q) => q.repos.length > 0 || q.milestones.length > 0,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Career Timeline</h1>
        <p className="text-muted-foreground">
          {timeline ? `${timeline.year} by quarter` : 'Your engineering journey visualized'}
        </p>
      </div>

      {quarters.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-lg font-medium text-muted-foreground">No timeline data yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Connect an integration and sync your data to build your career timeline.
            </p>
            <Link href="/connect">
              <Button className="mt-4">Connect GitHub</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {quarters.map((q) => (
            <div key={q.quarter} className="relative">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  Q{q.quarter}
                </div>
                <h2 className="text-xl font-semibold">
                  {q.label}
                  {q.inProgress ? ' · in progress' : ''}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {q.totals.prsMerged} PRs merged · {q.totals.prsReviewed} reviewed
                </span>
              </div>
              <div className="ml-5 space-y-3 border-l-2 border-border pl-6">
                {q.milestones.map((m) => (
                  <p key={`${m.kind}-${m.title}`} className="text-sm font-medium">
                    ★ {m.title}
                  </p>
                ))}
                {q.repos.map((repo) => (
                  <Card key={repo.repositoryId}>
                    <CardContent className="space-y-2 p-4">
                      <h3 className="font-medium">{repo.fullName}</h3>
                      {repo.items.slice(0, 8).map((item) => (
                        <div
                          key={item.id}
                          className="flex items-start justify-between gap-2 text-sm"
                        >
                          <span>{item.title}</span>
                          <div className="flex flex-wrap gap-1">
                            {item.tags.map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                      {repo.items.length > 8 && (
                        <p className="text-xs text-muted-foreground">
                          and {repo.totalItems - 8} more
                        </p>
                      )}
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
