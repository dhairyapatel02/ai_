'use client';

import { Milestone, Star } from 'lucide-react';
import Link from 'next/link';

import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useCareerTimeline } from '@/lib/api/metrics-hooks';
import { formatCount } from '@/lib/format';

/** Interim career timeline on `GET /career/timeline` (P10 builds S10). */
export function CareerView() {
  const timeline = useCareerTimeline();
  const quarters = (timeline.data?.quarters ?? []).filter(
    (q) => q.repos.length > 0 || q.milestones.length > 0,
  );

  return (
    <>
      <PageHeader
        title="Career"
        lede={
          timeline.data ? `${timeline.data.year} by quarter` : 'Your engineering work over time.'
        }
      />
      {timeline.isPending ? (
        <PageSkeleton kind="list" label="Loading your timeline…" />
      ) : timeline.isError ? (
        <Card>
          <ErrorState
            error={timeline.error}
            what="your career timeline"
            onRetry={() => void timeline.refetch()}
          />
        </Card>
      ) : quarters.length === 0 ? (
        <Card>
          <EmptyState
            icon={Milestone}
            title="No timeline yet"
            description="Merged pull requests and reviews appear here by quarter once GitHub is connected and synced."
            actions={
              <Button asChild>
                <Link href="/settings/integrations">Check GitHub connection</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <ol className="flex flex-col gap-8">
          {quarters.map((q) => (
            <li key={q.quarter}>
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span
                  className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
                  aria-hidden="true"
                >
                  Q{q.quarter}
                </span>
                <h2 className="text-lg font-semibold">{q.label}</h2>
                {q.inProgress ? <Badge variant="neutral">In progress</Badge> : null}
                <span className="text-sm text-muted-foreground">
                  {formatCount(q.totals.prsMerged)} PRs merged · {formatCount(q.totals.prsReviewed)}{' '}
                  reviewed
                </span>
              </div>
              <div className="ml-4 flex flex-col gap-3 border-l pl-5">
                {q.milestones.map((m) => (
                  <p key={`${m.kind}-${m.title}`} className="flex items-center gap-2 font-medium">
                    <Star className="size-4 text-muted-foreground" aria-hidden="true" />
                    {m.title}
                  </p>
                ))}
                {q.repos.map((repo) => (
                  <Card key={repo.repositoryId}>
                    <CardContent className="flex flex-col gap-2 pt-4">
                      <h3 className="font-medium">{repo.fullName}</h3>
                      <ul className="flex flex-col gap-1.5">
                        {repo.items.slice(0, 8).map((item) => (
                          <li
                            key={item.id}
                            className="flex flex-wrap items-start justify-between gap-2 text-sm"
                          >
                            <span className="min-w-0">{item.title}</span>
                            <span className="flex flex-wrap gap-1">
                              {item.tags.map((tag) => (
                                <Badge key={tag} variant="neutral">
                                  {tag}
                                </Badge>
                              ))}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {repo.totalItems > 8 ? (
                        <p className="text-caption text-subtle-foreground">
                          and {repo.totalItems - 8} more
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
