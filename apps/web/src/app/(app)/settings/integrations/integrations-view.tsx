'use client';

import {
  ChevronDown,
  ExternalLink,
  Lock,
  Plug,
  RefreshCw,
  Search,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { GitHubIcon } from '@/components/icons/github';
import { startGitHubConnect } from '@/components/onboarding/use-onboarding';
import {
  Banner,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ListSkeleton,
  PageHeader,
} from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { errorMessage, isApiError } from '@/lib/api/errors';
import {
  reconnectUrl,
  useDisconnect,
  useIntegrations,
  useMe,
  useRepos,
  useStartSync,
  useSyncRuns,
  useSyncStatus,
  useUpdateRepo,
  useUpdateRepos,
} from '@/lib/api/hooks';
import { formatDate, formatDuration, formatRelative, formatTime, plural } from '@/lib/format';
import {
  describeIntegration,
  newItems,
  runDurationSeconds,
  type IntegrationBadge,
} from '@/lib/integration-state';
import { CONNECT_ERRORS } from '@/lib/onboarding';
import { cn } from '@/lib/utils';

import type { IntegrationDto, RepositoryDto, SyncRunDto } from '@devimpact/shared';

const PLANNED = [
  { name: 'GitLab', text: 'Merge requests and reviews' },
  { name: 'Jira', text: 'Issues and story points' },
  { name: 'Linear', text: 'Issues and cycles' },
];

const BADGE: Record<IntegrationBadge, 'success' | 'accent' | 'warning' | 'danger' | 'neutral'> = {
  success: 'success',
  accent: 'accent',
  warning: 'warning',
  danger: 'danger',
  neutral: 'neutral',
};

const TRIGGER: Record<string, string> = {
  initial: 'Initial',
  manual: 'Manual',
  scheduled: 'Scheduled',
  webhook: 'Webhook',
  reconnect: 'Reconnect',
};

/** Settings → Integrations (S19): connection health, repositories, sync history, planned providers. */
export function IntegrationsView({ connectError }: { connectError?: string }) {
  const integrations = useIntegrations();
  const github = integrations.data?.find((i) => i.status !== 'disconnected');
  const notice = connectError ? (CONNECT_ERRORS[connectError] ?? CONNECT_ERRORS.failed) : null;

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <PageHeader
        title="Integrations"
        lede="Where DevImpact gets your engineering activity."
        className="mb-2"
      />
      {notice ? (
        <Banner tone="danger" role="alert" title={notice.title}>
          {notice.body}
        </Banner>
      ) : null}
      {integrations.isPending ? (
        <ListSkeleton rows={3} label="Loading integrations…" />
      ) : integrations.isError ? (
        <Card>
          <ErrorState
            error={integrations.error}
            what="your integrations"
            onRetry={() => void integrations.refetch()}
          />
        </Card>
      ) : github ? (
        <>
          <GitHubCard integration={github} />
          <RepositoriesSection integrationId={github.id} manageUrl={github.manageUrl} />
          <SyncHistory integrationId={github.id} />
        </>
      ) : (
        <ConnectCard />
      )}
      <section aria-labelledby="planned-title" className="mt-2 flex flex-col gap-3">
        <h2 id="planned-title" className="text-base font-semibold">
          Planned
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {PLANNED.map((p) => (
            <li
              key={p.name}
              className="flex flex-col gap-1 rounded-md border border-dashed border-border-strong p-4"
              data-testid="planned-provider"
            >
              <span className="font-medium">{p.name}</span>
              <span className="text-sm text-muted-foreground">{p.text}</span>
              <span className="text-caption text-subtle-foreground">Planned for v2.1</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ConnectCard() {
  const [starting, setStarting] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <GitHubIcon className="size-6" />
        <div className="min-w-0 flex-1">
          <CardTitle>
            <h2>GitHub</h2>
          </CardTitle>
          <p className="text-sm text-muted-foreground">Pull requests, reviews and commits</p>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Install the read-only GitHub App and choose repositories on GitHub.
        </p>
        <Button
          className="self-start"
          loading={starting}
          onClick={() => {
            setStarting(true);
            startGitHubConnect('/settings/integrations').catch((error: unknown) => {
              toast.error(errorMessage(error, 'GitHub'));
              setStarting(false);
            });
          }}
        >
          <Plug aria-hidden="true" />
          Connect GitHub
        </Button>
      </CardContent>
    </Card>
  );
}

function GitHubCard({ integration }: { integration: IntegrationDto }) {
  const me = useMe();
  const sync = useSyncStatus({ integrationId: integration.id });
  const start = useStartSync();
  const disconnect = useDisconnect();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [purge, setPurge] = useState<'keep' | 'purge'>('keep');
  const [reconnecting, setReconnecting] = useState(false);
  const timezone = me.data?.settings.timezone;
  const state = describeIntegration(integration, sync.data, { timezone });
  const run = sync.data?.currentRun ?? null;

  const reconnect = () => {
    setReconnecting(true);
    reconnectUrl(integration.id).then(
      (url) => {
        window.location.assign(url);
      },
      (error: unknown) => {
        toast.error(errorMessage(error, 'the reconnect link'));
        setReconnecting(false);
      },
    );
  };

  const syncNow = () => {
    start.mutate(integration.id, {
      onSuccess: (result) => {
        toast.info(
          result.alreadyRunning
            ? 'A sync is already running.'
            : 'Sync started. New activity appears in a minute or two.',
        );
      },
      onError: (error) => {
        if (isApiError(error) && error.code === 'INTEGRATION_NEEDS_REAUTH') reconnect();
        else if (isApiError(error) && error.code === 'RATE_LIMITED' && error.retryAfterSeconds) {
          toast.error(
            `You can sync again at ${formatTime(new Date(Date.now() + error.retryAfterSeconds * 1000), timezone)}.`,
          );
        } else toast.error(errorMessage(error, 'the sync'));
      },
    });
  };

  return (
    <Card aria-labelledby="github-title" data-testid="github-card">
      <CardHeader className="flex flex-row flex-wrap items-center gap-3">
        <GitHubIcon className="size-6" />
        <div className="min-w-0 flex-1">
          <CardTitle>
            <h2 id="github-title">GitHub</h2>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {integration.externalLogin ? `@${integration.externalLogin} · ` : ''}via GitHub App
            (read-only)
          </p>
        </div>
        {sync.isPending ? (
          <Badge variant="neutral">Checking…</Badge>
        ) : (
          <Badge variant={BADGE[state.badge.variant]} data-testid="sync-status-badge">
            {state.badge.text}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground" data-testid="integration-explanation">
          {state.explanation}
        </p>
        {state.key === 'syncing' && run ? (
          <Progress
            value={run.progress}
            aria-label="Sync progress"
            className="max-w-sm"
            data-testid="sync-progress"
          />
        ) : null}
        {integration.installations.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">GitHub App installations</caption>
              <thead className="max-sm:sr-only">
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Installed on
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Repositories
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {integration.installations.map((inst) => (
                  <tr
                    key={inst.installationId}
                    className="border-b last:border-b-0 max-sm:flex max-sm:flex-wrap max-sm:gap-x-3 max-sm:py-2"
                  >
                    <td className="py-2 pr-3 max-sm:w-full max-sm:py-0">
                      {inst.accountType === 'User' ? `@${inst.accountLogin}` : inst.accountLogin}{' '}
                      <span className="text-caption text-subtle-foreground">
                        {inst.accountType === 'User' ? 'personal' : 'organization'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 max-sm:py-0">
                      {inst.repositorySelection === 'all'
                        ? 'All repositories'
                        : 'Selected repositories'}
                    </td>
                    <td className="py-2 max-sm:py-0">
                      {inst.suspended ? (
                        <Badge variant="warning">Suspended</Badge>
                      ) : (
                        <Badge variant="success">Active</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {state.primary === 'reconnect' ? (
            <Button size="sm" loading={reconnecting} onClick={reconnect}>
              Reconnect GitHub
            </Button>
          ) : (
            <Button
              size="sm"
              variant={state.primary === 'retry' ? 'default' : 'secondary'}
              loading={start.isPending}
              disabled={state.syncDisabledReason !== null}
              aria-describedby={state.syncDisabledReason ? 'sync-disabled-reason' : undefined}
              onClick={syncNow}
            >
              <RefreshCw aria-hidden="true" />
              {state.primary === 'retry' ? 'Retry sync' : 'Sync now'}
            </Button>
          )}
          <Button size="sm" variant="ghost" asChild>
            <a href={integration.manageUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              Manage on GitHub
            </a>
          </Button>
          <Button
            size="sm"
            variant="destructive-outline"
            className="ml-auto"
            onClick={() => {
              setConfirmOpen(true);
            }}
          >
            Disconnect
          </Button>
          {state.syncDisabledReason ? (
            <p id="sync-disabled-reason" className="w-full text-caption text-subtle-foreground">
              {state.syncDisabledReason}.
            </p>
          ) : null}
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Disconnect GitHub?"
        description="DevImpact stops syncing and revokes its GitHub token. Choose what happens to the data already imported."
        confirmLabel="Disconnect"
        destructive
        loading={disconnect.isPending}
        onConfirm={() => {
          disconnect.mutate(
            { id: integration.id, purgeData: purge === 'purge' },
            {
              onSuccess: (result) => {
                setConfirmOpen(false);
                toast.success(
                  result.purged
                    ? 'GitHub disconnected and imported activity deleted.'
                    : 'GitHub disconnected. Your data is kept.',
                );
              },
              onError: (error) => toast.error(errorMessage(error, 'the disconnect')),
            },
          );
        }}
      >
        <RadioGroup
          value={purge}
          onValueChange={(v) => {
            setPurge(v as 'keep' | 'purge');
          }}
          className="gap-2"
          aria-label="Imported data"
        >
          {(
            [
              [
                'keep',
                'Keep my data',
                'KPIs, timeline and documents stay as they are. Reconnect any time to continue.',
              ],
              [
                'purge',
                'Delete imported activity',
                "Removes imported pull requests, reviews and commits. Documents and achievements are kept. This can't be undone.",
              ],
            ] as const
          ).map(([value, title, text]) => (
            <Label
              key={value}
              htmlFor={`purge-${value}`}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary"
            >
              <RadioGroupItem id={`purge-${value}`} value={value} className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{title}</span>
                <span className="text-sm text-muted-foreground">{text}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </ConfirmDialog>
    </Card>
  );
}

function RepositoriesSection({
  integrationId,
  manageUrl,
}: {
  integrationId: string;
  manageUrl: string;
}) {
  const me = useMe();
  const repos = useRepos({ integrationId, limit: 100, sort: 'fullName' });
  const updateOne = useUpdateRepo();
  const updateMany = useUpdateRepos();
  const [query, setQuery] = useState('');
  const items = useMemo(() => repos.data?.items ?? [], [repos.data]);
  const total = repos.data?.meta.total ?? items.length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((r) => r.fullName.toLowerCase().includes(q)) : items;
  }, [items, query]);
  const includedCount = items.filter((r) => r.included).length;
  const timezone = me.data?.settings.timezone;

  const toggle = (repo: RepositoryDto, included: boolean) => {
    updateOne.mutate(
      { id: repo.id, included },
      {
        onSuccess: () => {
          toast.info(
            `${repo.fullName} ${included ? 'included' : 'excluded'}. KPIs are being recalculated.`,
          );
        },
        onError: (error) => toast.error(errorMessage(error, 'the repository')),
      },
    );
  };
  const bulk = (included: boolean) => {
    const ids = shown.filter((r) => r.included !== included && r.accessible).map((r) => r.id);
    if (ids.length === 0) return;
    updateMany.mutate(
      { ids: ids.slice(0, 200), included },
      {
        onSuccess: (result) => {
          toast.info(
            `${plural(result.updated, 'repository', 'repositories')} ${included ? 'included' : 'excluded'}. KPIs are being recalculated.`,
          );
        },
        onError: (error) => toast.error(errorMessage(error, 'the repositories')),
      },
    );
  };

  return (
    <section aria-labelledby="repos-title" className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 id="repos-title" className="mr-auto text-base font-semibold">
          Repositories
        </h2>
        {repos.data ? (
          <span className="text-sm text-muted-foreground" data-testid="repos-included">
            {includedCount} of {total} included
          </span>
        ) : null}
      </div>
      {repos.isPending ? (
        <ListSkeleton rows={4} label="Loading repositories…" />
      ) : repos.isError ? (
        <ErrorState
          error={repos.error}
          what="your repositories"
          onRetry={() => void repos.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No repositories yet"
          description="Repositories appear after the first sync finds your contributions."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            {items.length > 20 ? (
              <div className="relative w-full sm:w-64">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle-foreground"
                  aria-hidden="true"
                />
                <label htmlFor="repo-search" className="sr-only">
                  Search repositories
                </label>
                <Input
                  id="repo-search"
                  type="search"
                  placeholder="Search repositories"
                  className="pl-8"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                  }}
                />
              </div>
            ) : null}
            <div className="flex gap-1 sm:ml-auto">
              <Button
                size="sm"
                variant="ghost"
                loading={updateMany.isPending && updateMany.variables.included}
                onClick={() => { bulk(true); }}
              >
                Include all{query ? ' shown' : ''}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={updateMany.isPending && !updateMany.variables.included}
                onClick={() => { bulk(false); }}
              >
                Exclude all{query ? ' shown' : ''}
              </Button>
            </div>
          </div>
          <ul className="py-1">
            {shown.map((repo) => {
              const pending = updateOne.isPending && updateOne.variables.id === repo.id;
              const included = pending ? updateOne.variables.included : repo.included;
              return (
                <li
                  key={repo.id}
                  className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
                  data-testid="repo-row"
                >
                  <Switch
                    checked={included}
                    disabled={pending || !repo.accessible}
                    onCheckedChange={(checked) => {
                      toggle(repo, checked);
                    }}
                    aria-label={`Include ${repo.fullName}`}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{repo.fullName}</span>
                    <span className="text-caption text-subtle-foreground">
                      {!repo.accessible ? (
                        <>
                          No longer accessible to the app ·{' '}
                          <a
                            href={manageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-link underline"
                          >
                            Manage on GitHub
                          </a>
                        </>
                      ) : (
                        <>
                          {included
                            ? 'Counted in KPIs and documents'
                            : 'Excluded — data kept, never counted'}
                          {repo.lastActivityAt
                            ? ` · last activity ${formatRelative(repo.lastActivityAt, { timeZone: timezone })}`
                            : ' · no activity from you in the last 12 months'}
                        </>
                      )}
                    </span>
                  </span>
                  {repo.isPrivate ? (
                    <Badge variant="neutral" className="max-sm:hidden">
                      <Lock aria-hidden="true" />
                      Private
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="border-t px-4 py-3 text-caption text-subtle-foreground">
            Changing a repository recalculates your KPIs for all periods in about a minute.
          </p>
        </>
      )}
    </section>
  );
}

function SyncHistory({ integrationId }: { integrationId: string }) {
  const runs = useSyncRuns(integrationId);
  const items = runs.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section aria-labelledby="runs-title" className="rounded-md border bg-card">
      <h2 id="runs-title" className="border-b px-4 py-3 text-base font-semibold">
        Sync history
      </h2>
      {runs.isPending ? (
        <ListSkeleton rows={3} label="Loading sync history…" />
      ) : runs.isError ? (
        <ErrorState
          error={runs.error}
          what="your sync history"
          onRetry={() => void runs.refetch()}
        />
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-center text-muted-foreground">No syncs yet.</p>
      ) : (
        <>
          <div
            className="hidden grid-cols-[1.4fr_0.9fr_1.4fr_0.7fr_0.7fr_auto] gap-3 border-b px-4 py-2 text-sm font-medium text-muted-foreground md:grid"
            aria-hidden="true"
          >
            <span>Started</span>
            <span>Trigger</span>
            <span>Result</span>
            <span className="text-right">New items</span>
            <span className="text-right">Duration</span>
            <span className="w-7" />
          </div>
          <ul data-testid="sync-history">
            {items.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
          {runs.hasNextPage ? (
            <div className="flex justify-center border-t px-4 py-3">
              <Button
                size="sm"
                variant="secondary"
                loading={runs.isFetchingNextPage}
                onClick={() => void runs.fetchNextPage()}
              >
                Show older syncs
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

const RESULT: Record<
  SyncRunDto['status'],
  { variant: 'success' | 'warning' | 'danger' | 'accent' | 'neutral'; text: string }
> = {
  succeeded: { variant: 'success', text: 'Succeeded' },
  partial: { variant: 'warning', text: 'Partial' },
  failed: { variant: 'danger', text: 'Failed' },
  cancelled: { variant: 'neutral', text: 'Cancelled' },
  queued: { variant: 'accent', text: 'Queued' },
  running: { variant: 'accent', text: 'Running' },
  waiting_rate_limit: { variant: 'warning', text: 'Paused' },
};

function RunRow({ run }: { run: SyncRunDto }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const timezone = me.data?.settings.timezone;
  const started = run.startedAt ?? run.queuedAt;
  const duration = runDurationSeconds(run);
  const result = RESULT[run.status];
  const first = run.errors[0];
  const detailsId = `run-${run.id}-errors`;
  useEffect(() => {
    if (run.errors.length === 0) setOpen(false);
  }, [run.errors.length]);
  return (
    <li className="border-b last:border-b-0">
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-2.5 text-sm md:grid-cols-[1.4fr_0.9fr_1.4fr_0.7fr_0.7fr_auto] md:items-start">
        <span className="tabular-nums">
          {formatDate(started, { timeZone: timezone })}, {formatTime(started, timezone)}
          <span className="text-muted-foreground md:hidden">
            {' '}
            · {TRIGGER[run.trigger] ?? run.trigger}
          </span>
        </span>
        <span className="hidden text-muted-foreground md:block">
          {TRIGGER[run.trigger] ?? run.trigger}
        </span>
        <span className="flex min-w-0 flex-col gap-1 max-md:order-first max-md:col-span-2">
          <span>
            <Badge variant={result.variant}>{result.text}</Badge>
          </span>
          {first ? (
            <span className="text-caption text-subtle-foreground">
              {first.repo ? `${first.repo}: ` : ''}
              {first.message}
            </span>
          ) : run.errorMessage ? (
            <span className="text-caption text-subtle-foreground">{run.errorMessage}</span>
          ) : null}
        </span>
        <span className="text-muted-foreground tabular-nums md:text-right md:text-foreground">
          <span className="md:hidden">New items </span>
          {newItems(run).toLocaleString('en-US')}
        </span>
        <span className="text-muted-foreground tabular-nums max-md:col-start-2 max-md:row-start-2 max-md:text-right md:text-right md:text-foreground">
          {duration === null ? '—' : formatDuration(duration)}
        </span>
        <span className="flex w-7 justify-end max-md:col-start-2 max-md:row-start-3">
          {run.errors.length > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={detailsId}
              aria-label={`${open ? 'Hide' : 'Show'} ${plural(run.errors.length, 'error')}`}
              className="inline-flex size-7 cursor-pointer items-center justify-center rounded-sm text-subtle-foreground hover:bg-surface-2"
              onClick={() => {
                setOpen((v) => !v);
              }}
            >
              <ChevronDown
                className={cn('size-4 transition-transform', open && 'rotate-180')}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </span>
      </div>
      {run.errors.length > 0 ? (
        <ul
          id={detailsId}
          hidden={!open}
          className="flex flex-col gap-1 bg-surface-2 px-4 py-2 text-caption"
        >
          {run.errors.map((e, i) => (
            <li key={i} className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
              <span>
                <b className="font-medium">{e.repo ?? 'All repositories'}</b> · {e.message}{' '}
                <span className="font-mono text-subtle-foreground">{e.code}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
