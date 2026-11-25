'use client';

import {
  PROVIDER_LABELS,
  type ActivityType,
  type EvidenceItem,
  type FeedItem,
} from '@devimpact/shared';
import {
  CircleCheckBig,
  ExternalLink,
  GitCommitHorizontal,
  GitMerge,
  MessageSquareText,
  Search,
  SearchX,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { FeedItemRow, itemParam } from '@/components/feed-item';
import { ItemDrawer } from '@/components/item-drawer';
import { NotConnectedState, useConnected } from '@/components/not-connected-state';
import { InvalidPeriodState, isInvalidPeriodError } from '@/components/period-gate';
import { SyncBanner } from '@/components/shell/sync-banner';
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isBackfilling, useIntegrations, useMe, useRepos, useSyncStatus } from '@/lib/api/hooks';
import {
  useActivityFeed,
  useDefinitions,
  useMetricEvidenceInfinite,
} from '@/lib/api/metrics-hooks';
import { formatLocalDate, localDateKey, plural } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useSearchParamsState } from '@/lib/url-state';
import { cn } from '@/lib/utils';


export const TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'prs', label: 'Pull requests' },
  { key: 'review', label: 'Reviews' },
  { key: 'commit', label: 'Commits' },
  { key: 'issue', label: 'Issues' },
  { key: 'achievement', label: 'Achievements' },
] as const;

/** `?provider=` values (P13). The filter shows once a second source is connected. */
export const PROVIDER_FILTERS = ['github', 'gitlab', 'jira', 'linear'] as const;
export type ProviderFilter = (typeof PROVIDER_FILTERS)[number];
export const parseProviderFilter = (value: string | null): ProviderFilter | null =>
  (PROVIDER_FILTERS as readonly string[]).includes(value ?? '') ? (value as ProviderFilter) : null;
export type TypeFilter = (typeof TYPE_FILTERS)[number]['key'];

/** `?type=` → API `types` (undefined = every type). */
export function typesFor(filter: string | null): ActivityType[] | undefined {
  switch (filter) {
    case 'prs':
      return ['pr_opened', 'pr_merged', 'pr_closed'];
    case 'review':
      return ['review'];
    case 'commit':
      return ['commit'];
    case 'achievement':
      return ['achievement'];
    case 'issue':
      return ['issue'];
    default:
      return undefined;
  }
}

/** Groups rows under local-day headings (`Mon, Nov 9`), newest first as returned. */
export function groupByDay<T>(items: T[], dateOf: (item: T) => string, timezone?: string) {
  const groups: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = localDateKey(dateOf(item), timezone);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Activity explorer (S7): unified feed with URL-synced filters and the item drawer. */
export function ActivityView() {
  const connected = useConnected();
  const period = usePeriod();
  const me = useMe();
  const url = useSearchParamsState();
  const metric = url.get('metric');

  return (
    <>
      {!connected ? (
        <>
          <PageHeader title="Activity" />
          <NotConnectedState />
        </>
      ) : period.invalid ? (
        <>
          <PageHeader title="Activity" />
          <InvalidPeriodState message={period.invalid} />
        </>
      ) : metric ? (
        <EvidenceList metric={metric} />
      ) : (
        <ActivityFeed />
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

function useInfiniteSentinel(enabled: boolean, onVisible: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onVisible);
  latest.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) latest.current();
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [enabled]);
  return ref;
}

function ActivityFeed() {
  const period = usePeriod();
  const me = useMe();
  const sync = useSyncStatus();
  const url = useSearchParamsState();
  const type = (url.get('type') ?? 'all') as TypeFilter;
  const repoParam = url.get('repo');
  const repo = repoParam && ID.test(repoParam) ? repoParam : null;
  const q = url.get('q') ?? '';
  const provider = parseProviderFilter(url.get('provider'));
  const integrations = useIntegrations();
  const connected = [
    ...new Set(
      (integrations.data ?? []).filter((i) => i.status !== 'disconnected').map((i) => i.provider),
    ),
  ];
  const repos = useRepos({ limit: 100, sort: 'fullName' });
  const included = (repos.data?.items ?? []).filter((r) => r.included);
  const excluded = (repos.data?.items ?? []).filter((r) => !r.included);

  const feed = useActivityFeed({
    period: period.apiParam,
    types: typesFor(type),
    repoIds: repo ? [repo] : undefined,
    providers: provider ? [provider] : undefined,
    q: q.trim() || undefined,
    limit: 40,
  });
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const timezone = me.data?.settings.timezone;
  const groups = groupByDay(items, (i) => i.occurredAt, timezone);
  const sentinel = useInfiniteSentinel(feed.hasNextPage && !feed.isFetchingNextPage, () => {
    void feed.fetchNextPage();
  });
  const filtered = type !== 'all' || repo !== null || q !== '' || provider !== null;
  const currentYear = period.today ? Number(period.today.slice(0, 4)) : undefined;

  if (isInvalidPeriodError(feed.error)) {
    return (
      <>
        <PageHeader title="Activity" />
        <InvalidPeriodState />
      </>
    );
  }

  const countLabel = feed.data
    ? feed.hasNextPage
      ? `${items.length.toLocaleString('en-US')}+ items`
      : plural(items.length, 'item')
    : null;

  return (
    <>
      <PageHeader
        title="Activity"
        lede={
          period.resolved ? (
            <>
              {period.resolved.label}
              {countLabel ? ` · ${countLabel}` : ''}
            </>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-3">
        <SyncBanner />
        <Filters
          type={type}
          repo={repo}
          q={q}
          repos={included}
          excluded={excluded.map((r) => r.fullName)}
          provider={provider}
          providers={connected}
        />
        <div
          className={cn(
            'rounded-md border bg-card transition-opacity',
            feed.isPlaceholderData && 'opacity-60',
          )}
          data-testid="activity-list"
        >
          {feed.isPending ? (
            <ListSkeleton rows={6} label="Loading activity…" />
          ) : feed.isError ? (
            <ErrorState
              error={feed.error}
              what="your activity"
              onRetry={() => void feed.refetch()}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No activity matches these filters"
              description="Try another type or repository, or a longer period."
              actions={
                filtered ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      url.set({ type: null, repo: null, q: null });
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null
              }
            />
          ) : (
            <>
              {groups.map((g) => (
                <section
                  key={g.day}
                  aria-label={formatLocalDate(g.day, { weekday: true, currentYear })}
                >
                  <h2 className="sticky top-(--topbar-height) z-[1] border-b bg-card px-4 py-1.5 text-caption font-medium text-subtle-foreground">
                    {formatLocalDate(g.day, { weekday: true, currentYear })}
                  </h2>
                  <ul>
                    {g.items.map((item: FeedItem) => (
                      <li key={item.id} className="border-b last:border-b-0">
                        <FeedItemRow
                          item={item}
                          timezone={timezone}
                          today={period.today}
                          onOpen={(i) => {
                            url.set({ item: itemParam(i) });
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <div
                ref={sentinel}
                className="flex flex-wrap items-center justify-center gap-3 border-t px-4 py-3"
              >
                {feed.hasNextPage ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={feed.isFetchingNextPage}
                    onClick={() => void feed.fetchNextPage()}
                  >
                    Show more
                  </Button>
                ) : null}
                <span className="text-caption text-subtle-foreground">
                  {feed.hasNextPage
                    ? `${items.length.toLocaleString('en-US')} shown`
                    : isBackfilling(sync.data)
                      ? 'More history is still importing'
                      : `All ${plural(items.length, 'item')} shown`}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Filters({
  type,
  repo,
  q,
  repos,
  excluded,
  provider,
  providers,
}: {
  type: TypeFilter;
  repo: string | null;
  q: string;
  repos: { id: string; fullName: string }[];
  excluded: string[];
  provider: ProviderFilter | null;
  providers: ProviderFilter[];
}) {
  const url = useSearchParamsState();
  const [text, setText] = useState(q);
  useEffect(() => {
    setText(q);
  }, [q]);
  // Debounced search (replace, so typing doesn't fill the history).
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => {
      url.set({ q: text.trim() || null }, { replace: true });
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [text, q, url]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Type"
          className="-mx-4 flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0"
        >
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={type === f.key}
              onClick={() => {
                url.set({ type: f.key === 'all' ? null : f.key });
              }}
              className={cn(
                'h-7 shrink-0 cursor-pointer rounded-full border px-3 text-sm whitespace-nowrap',
                type === f.key
                  ? 'border-primary bg-accent text-accent-foreground'
                  : 'bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row md:ml-auto md:w-auto">
          {providers.length > 1 || provider ? (
            <Select
              value={provider ?? 'all'}
              onValueChange={(v) => {
                url.set({ provider: v === 'all' ? null : v });
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Source">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {PROVIDER_FILTERS.filter((p) => providers.includes(p) || p === provider).map(
                  (p) => (
                    <SelectItem key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          ) : null}
          <Select
            value={repo ?? 'all'}
            onValueChange={(v) => {
              url.set({ repo: v === 'all' ? null : v });
            }}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label="Repository">
              <SelectValue placeholder="All repositories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All repositories</SelectItem>
              {repos.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle-foreground"
              aria-hidden="true"
            />
            <label htmlFor="activity-q" className="sr-only">
              Search activity
            </label>
            <Input
              id="activity-q"
              type="search"
              placeholder="Search titles or refs"
              className="pl-8"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
            />
          </div>
        </div>
      </div>
      {excluded.length > 0 ? (
        <p className="text-caption text-subtle-foreground">
          Excluded repositories never appear: {excluded.join(', ')}.{' '}
          <Link href="/settings/integrations" className="text-link underline underline-offset-2">
            Manage repositories
          </Link>
        </p>
      ) : null}
    </div>
  );
}

const EVIDENCE_ICON = {
  pull_request: GitMerge,
  review: MessageSquareText,
  commit: GitCommitHorizontal,
  achievement: GitMerge,
  issue: CircleCheckBig,
} as const;

function evidenceItemParam(item: EvidenceItem): string | null {
  if (item.kind === 'pull_request') return `pr_merged:${item.id}`;
  if (item.kind === 'commit') return `commit:${item.id}`;
  if (item.kind === 'issue') return `issue:${item.id}`;
  return null; // reviews open on GitHub (the evidence item has no PR id for the drawer)
}

/** `?metric=` (from the explain drawer, FLOWS F9): the records behind a metric (A-2). */
function EvidenceList({ metric }: { metric: string }) {
  const period = usePeriod();
  const me = useMe();
  const url = useSearchParamsState();
  const definitions = useDefinitions();
  const label = definitions.data?.metrics.find((m) => m.key === metric)?.label ?? metric;
  const evidence = useMetricEvidenceInfinite(metric, period.apiParam);
  const items = evidence.data?.pages.flatMap((p) => p.items) ?? [];
  const total = evidence.data?.pages[0]?.meta.total;
  const timezone = me.data?.settings.timezone;
  const currentYear = period.today ? Number(period.today.slice(0, 4)) : undefined;
  const groups = groupByDay(items, (i) => i.occurredAt, timezone);

  return (
    <>
      <PageHeader
        title="Activity"
        lede={
          period.resolved ? (
            <>
              {period.resolved.label}
              {total !== undefined ? ` · ${plural(total, 'record')}` : ''}
            </>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-surface-2 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            Showing the evidence behind <b className="font-medium">{label}</b>
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              url.set({ metric: null });
            }}
          >
            <X aria-hidden="true" />
            Show all activity
          </Button>
        </div>
        <div className="rounded-md border bg-card" data-testid="evidence-list">
          {evidence.isPending ? (
            <ListSkeleton rows={6} label="Loading evidence…" />
          ) : evidence.isError ? (
            isInvalidPeriodError(evidence.error) ? (
              <InvalidPeriodState />
            ) : (
              <ErrorState
                error={evidence.error}
                what="the evidence"
                onRetry={() => void evidence.refetch()}
              />
            )
          ) : items.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No records behind this metric in this period"
              description="Try a longer period, or open all activity."
            />
          ) : (
            <>
              {groups.map((g) => (
                <section
                  key={g.day}
                  aria-label={formatLocalDate(g.day, { weekday: true, currentYear })}
                >
                  <h2 className="border-b bg-card px-4 py-1.5 text-caption font-medium text-subtle-foreground">
                    {formatLocalDate(g.day, { weekday: true, currentYear })}
                  </h2>
                  <ul>
                    {g.items.map((item) => {
                      const Icon = EVIDENCE_ICON[item.kind];
                      const param = evidenceItemParam(item);
                      const body = (
                        <>
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
                            <Icon className="size-4" aria-hidden="true" />
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{item.title}</span>
                            <span className="truncate font-mono text-caption text-subtle-foreground">
                              {item.ref}
                            </span>
                          </span>
                          {param ? null : (
                            <ExternalLink
                              className="size-4 text-subtle-foreground"
                              aria-hidden="true"
                            />
                          )}
                        </>
                      );
                      const cls =
                        'flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2';
                      return (
                        <li key={`${item.kind}:${item.id}`} className="border-b last:border-b-0">
                          {param ? (
                            <button
                              type="button"
                              className={cn(cls, 'cursor-pointer')}
                              onClick={() => {
                                url.set({ item: param });
                              }}
                            >
                              {body}
                            </button>
                          ) : item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cls}
                            >
                              {body}
                              <span className="sr-only">(opens on GitHub)</span>
                            </a>
                          ) : (
                            <div className={cls}>{body}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {evidence.hasNextPage ? (
                <div className="flex justify-center border-t px-4 py-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={evidence.isFetchingNextPage}
                    onClick={() => void evidence.fetchNextPage()}
                  >
                    Show more
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
