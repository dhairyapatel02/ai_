'use client';

import { Award, FolderGit2, GitMerge, MessageSquareText, Printer } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { CareerMilestone } from '@/components/career-milestone';
import { ItemDrawer } from '@/components/item-drawer';
import { NotConnectedState, useConnected } from '@/components/not-connected-state';
import { EmptyState, ErrorState, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { isBackfilling, useMe, useSyncStatus } from '@/lib/api/hooks';
import { useCareerTimeline } from '@/lib/api/metrics-hooks';
import {
  hiddenOnServer,
  isEmptyQuarter,
  quarterRange,
  quarterTotals,
  reviewClusterLabel,
  type CareerQuarter,
  type CareerRepo,
} from '@/lib/career';
import { formatLocalDate } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useSearchParamsState } from '@/lib/url-state';
import { cn } from '@/lib/utils';

import { parseYear } from './year';

const SHOWN = 3;

/** Career timeline (S10): the story of the year by quarter. */
export function CareerView() {
  const connected = useConnected();
  const url = useSearchParamsState();
  const me = useMe();
  const year = parseYear(url.get('year'));
  const timeline = useCareerTimeline(connected ? year : undefined);
  const sync = useSyncStatus({ enabled: connected });
  const period = usePeriod();
  const shownYear = timeline.data?.year ?? year;
  const years = timeline.data?.years ?? [];
  const yearOptions = shownYear && !years.includes(shownYear) ? [shownYear, ...years] : years;

  // Quarters older than the newest 30 days show "Still importing" during the first backfill.
  const importingBefore =
    isBackfilling(sync.data) && period.today
      ? new Date(Date.parse(`${period.today}T00:00:00Z`) - 29 * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : null;

  if (!connected) {
    return (
      <>
        <PageHeader title="Career" />
        <NotConnectedState />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Career"
        lede="Your work by quarter: merged pull requests, reviews, milestones and achievements."
        actions={
          <>
            {yearOptions.length > 0 ? (
              <div
                role="radiogroup"
                aria-label="Year"
                className="inline-flex rounded-sm border bg-surface p-0.5"
              >
                {yearOptions.map((y) => (
                  <button
                    key={y}
                    type="button"
                    role="radio"
                    aria-checked={y === shownYear}
                    onClick={() => {
                      url.set({ year: String(y) });
                    }}
                    className={cn(
                      'h-7 cursor-pointer rounded-xs px-3 text-sm tabular-nums',
                      y === shownYear
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {y}
                  </button>
                ))}
              </div>
            ) : null}
            <Button variant="secondary" asChild>
              <Link href={`/career/print${shownYear ? `?year=${shownYear}` : ''}`} prefetch={false}>
                <Printer aria-hidden="true" />
                Print view
              </Link>
            </Button>
          </>
        }
      />
      {timeline.isPending ? (
        <TimelineSkeleton />
      ) : timeline.isError ? (
        <Card>
          <ErrorState
            error={timeline.error}
            what="your career timeline"
            onRetry={() => void timeline.refetch()}
          />
        </Card>
      ) : timeline.data.quarters.every(isEmptyQuarter) ? (
        <Card>
          <EmptyState
            icon={GitMerge}
            title={`No merged work, reviews or achievements in ${timeline.data.year}.`}
            description="Pick another year, or check that the right repositories are included."
            actions={
              <Button variant="secondary" asChild>
                <Link href="/settings/integrations">Manage repositories</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div
          className={cn(
            'flex flex-col rounded-md border bg-card transition-opacity',
            timeline.isPlaceholderData && 'opacity-60',
          )}
          data-testid="career-timeline"
        >
          {timeline.data.quarters.map((q) => (
            <Quarter
              key={q.quarter}
              quarter={q}
              year={timeline.data.year}
              importing={
                importingBefore !== null &&
                `${timeline.data.year}-${String(q.quarter * 3).padStart(2, '0')}-31` <
                  importingBefore
              }
              onOpen={(id) => {
                url.set({ item: `pr_merged:${id}` });
              }}
            />
          ))}
        </div>
      )}
      <ItemDrawer
        value={url.get('item')}
        timezone={me.data?.settings.timezone}
        onClose={() => {
          url.set({ item: null });
        }}
      />
    </>
  );
}

function Quarter({
  quarter,
  year,
  importing,
  onOpen,
}: {
  quarter: CareerQuarter;
  year: number;
  importing: boolean;
  onOpen: (id: string) => void;
}) {
  const label = `Q${quarter.quarter} ${year}`;
  const empty = isEmptyQuarter(quarter);
  return (
    <section
      aria-label={label}
      className="grid gap-x-6 gap-y-3 border-b p-4 last:border-b-0 md:grid-cols-[120px_minmax(0,1fr)] md:p-5"
      data-testid={`quarter-${quarter.quarter}`}
    >
      <div className="md:sticky md:top-[calc(var(--topbar-height)+16px)] md:self-start">
        <h2 className="font-semibold">{label}</h2>
        <p className="text-caption text-subtle-foreground">{quarterRange(quarter)}</p>
        {!empty ? (
          <p className="mt-1 text-caption text-subtle-foreground">
            {quarterTotals(quarter.totals)}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {empty ? (
          <p className="text-sm text-muted-foreground">
            {importing
              ? 'Still importing — this quarter fills in when the import finishes.'
              : 'No merged work or reviews this quarter.'}
          </p>
        ) : (
          <>
            {quarter.milestones.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {quarter.milestones.slice(0, 4).map((m, i) => (
                  <CareerMilestone key={`${m.kind}-${i}`} milestone={m} />
                ))}
              </div>
            ) : null}
            {quarter.repos.map((repo) => (
              <RepoGroup key={repo.repositoryId} repo={repo} year={year} onOpen={onOpen} />
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function RepoGroup({
  repo,
  year,
  onOpen,
}: {
  repo: CareerRepo;
  year: number;
  onOpen: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const merged = repo.items.filter((i) => i.type === 'pr_merged');
  const achievements = repo.items.filter((i) => i.type === 'achievement');
  const clusters = repo.items.filter((i) => i.type === 'review_cluster');
  const visible = expanded ? merged : merged.slice(0, SHOWN);
  const more = merged.length - visible.length;
  const onServer = hiddenOnServer(repo);
  return (
    <div className="flex flex-col gap-1">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <FolderGit2 className="size-4 text-subtle-foreground" aria-hidden="true" />
        {repo.fullName}
      </h3>
      <ul className="flex flex-col">
        {visible.map((item) => (
          <li key={item.id} className="flex items-start gap-2.5 py-1.5 pl-1">
            <GitMerge
              className="mt-0.5 size-4 shrink-0 text-subtle-foreground"
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <button
                type="button"
                className="cursor-pointer text-left hover:underline"
                onClick={() => {
                  onOpen(item.id);
                }}
              >
                {item.title}
              </button>
              <span className="flex flex-wrap items-center gap-1.5">
                {item.tags.slice(0, 3).map((t) => (
                  <Badge key={t} variant="outline">
                    {t}
                  </Badge>
                ))}
                <span className="text-caption text-subtle-foreground">
                  {item.ref.split('#')[1] ? `#${item.ref.split('#')[1]} · ` : ''}
                  {formatLocalDate(item.date, { currentYear: year })}
                </span>
              </span>
            </span>
          </li>
        ))}
        {more > 0 || (expanded && merged.length > SHOWN) ? (
          <li className="py-1 pl-7">
            <button
              type="button"
              aria-expanded={expanded}
              className="cursor-pointer text-sm text-link underline underline-offset-2"
              onClick={() => {
                setExpanded((v) => !v);
              }}
            >
              {expanded ? 'Show fewer' : `Show ${more} more`}
            </button>
          </li>
        ) : null}
        {achievements.map((item) => (
          <li key={item.id} className="flex items-start gap-2.5 py-1.5 pl-1">
            <Award className="mt-0.5 size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
            <span>{item.title}</span>
          </li>
        ))}
        {clusters.map((item) => (
          <li key={item.id} className="flex items-start gap-2.5 py-1.5 pl-1 text-muted-foreground">
            <MessageSquareText
              className="mt-0.5 size-4 shrink-0 text-subtle-foreground"
              aria-hidden="true"
            />
            <span>{reviewClusterLabel(item.count ?? 1)}</span>
          </li>
        ))}
      </ul>
      {expanded && onServer > 0 ? (
        <p className="ml-7 text-caption text-subtle-foreground">
          and {onServer} more in this quarter
        </p>
      ) : null}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-md border bg-card p-5" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid gap-4 md:grid-cols-[120px_1fr]">
          <Skeleton className="h-5 w-20" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
      <p className="sr-only" role="status">
        Loading your timeline…
      </p>
    </div>
  );
}
