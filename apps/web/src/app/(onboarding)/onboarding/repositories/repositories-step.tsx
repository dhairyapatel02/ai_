'use client';

import type { RepositoryDto } from '@devimpact/shared';
import { FolderGit2, Lock, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import { useSaveOnboardingStep } from '@/components/onboarding/use-onboarding';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/lib/api/errors';
import {
  useIntegrations,
  useRepos,
  useSyncStatus,
  useUpdateRepos,
  useUpdateSettings,
} from '@/lib/api/hooks';
import { formatRelative } from '@/lib/format';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function isRecentlyActive(repo: Pick<RepositoryDto, 'lastActivityAt'>, now = Date.now()) {
  return repo.lastActivityAt !== null && now - Date.parse(repo.lastActivityAt) <= YEAR_MS;
}

/** Ids whose inclusion changes, split by target value (PATCH /repos takes ≤ 200 ids). */
export function inclusionChanges(repos: RepositoryDto[], selected: Record<string, boolean>) {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const repo of repos) {
    const want = selected[repo.id] ?? repo.included;
    if (want !== repo.included) (want ? include : exclude).push(repo.id);
  }
  return { include, exclude };
}

function chunks<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** SCREENS S4 · Onboarding · Review repositories. */
export function RepositoriesStep() {
  useSaveOnboardingStep('repositories');
  const router = useRouter();
  const integrations = useIntegrations();
  const integration = integrations.data?.find((i) => i.status === 'active');
  const sync = useSyncStatus({ enabled: Boolean(integration) });
  const discovering =
    sync.data?.currentRun?.stage === 'repositories' || sync.data?.currentRun?.stage === 'prepare';
  const repos = useRepos(
    { integrationId: integration?.id, sort: '-lastActivityAt', limit: 100 },
    { enabled: Boolean(integration) },
  );
  const updateRepos = useUpdateRepos();
  const updateSettings = useUpdateSettings();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const searchId = useId();

  const items = useMemo(() => repos.data?.items ?? [], [repos.data]);
  const isOn = (repo: RepositoryDto) => selected[repo.id] ?? repo.included;
  const count = items.filter(isOn).length;
  const visible = query
    ? items.filter((r) => r.fullName.toLowerCase().includes(query.toLowerCase()))
    : items;

  const startImport = async () => {
    setSaving(true);
    try {
      if (repos.isSuccess) {
        const { include, exclude } = inclusionChanges(items, selected);
        for (const ids of chunks(include)) await updateRepos.mutateAsync({ ids, included: true });
        for (const ids of chunks(exclude)) await updateRepos.mutateAsync({ ids, included: false });
      }
      await updateSettings.mutateAsync({ onboardingStep: 'sync' });
      router.push('/onboarding/sync');
    } catch (error) {
      toast.error(errorMessage(error, 'your repository selection'));
      setSaving(false);
    }
  };

  const header = (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Review repositories</h1>
      <p className="text-muted-foreground">
        Repositories with activity in the last 12 months are selected. Excluded repositories are
        never counted in your KPIs or used in documents.
      </p>
    </div>
  );

  let body;
  if (integrations.isPending || (integration && repos.isPending)) {
    body = <ListSkeleton rows={6} label="Loading repositories…" />;
  } else if (integrations.isError) {
    body = (
      <div className="rounded-md border bg-card">
        <ErrorState
          error={integrations.error}
          what="your GitHub connection"
          onRetry={() => void integrations.refetch()}
        />
      </div>
    );
  } else if (!integration) {
    body = (
      <div className="rounded-md border bg-card">
        <EmptyState
          icon={FolderGit2}
          title="Connect GitHub first"
          description="DevImpact needs the GitHub App before it can list your repositories."
          actions={
            <Button asChild>
              <Link href="/onboarding/connect">Connect GitHub</Link>
            </Button>
          }
        />
      </div>
    );
  } else {
    body = (
      <div className="rounded-md border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <h2 className="flex-1 text-base font-semibold" aria-live="polite">
            {count} of {items.length} selected
          </h2>
          {items.length ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelected(Object.fromEntries(items.map((r) => [r.id, isRecentlyActive(r)])));
              }}
            >
              Select recently active
            </Button>
          ) : null}
        </div>
        {discovering ? (
          <p className="border-b px-4 py-2 text-sm text-info" role="status">
            Still discovering repositories… new ones appear here as they&apos;re found.
          </p>
        ) : null}
        {repos.isError ? (
          <ErrorState
            error={repos.error}
            what="your repositories"
            onRetry={() => void repos.refetch()}
            secondary={
              <span className="self-center text-caption text-subtle-foreground">
                You can still start the import with the defaults.
              </span>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title="DevImpact can't see any repositories yet"
            description="Add repositories to the app on GitHub, then come back."
            actions={
              <Button variant="secondary" asChild>
                <a href={integration.manageUrl} target="_blank" rel="noopener noreferrer">
                  Manage on GitHub
                </a>
              </Button>
            }
          />
        ) : (
          <>
            {items.length > 20 ? (
              <div className="relative border-b px-4 py-2">
                <label htmlFor={searchId} className="sr-only">
                  Search repositories
                </label>
                <Search
                  className="absolute top-1/2 left-6 size-4 -translate-y-1/2 text-subtle-foreground"
                  aria-hidden="true"
                />
                <Input
                  id={searchId}
                  type="search"
                  className="pl-8"
                  placeholder="Search repositories"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                  }}
                />
              </div>
            ) : null}
            <ul aria-label="Repositories" data-testid="repo-list">
              {visible.map((repo) => {
                const switchId = `repo-${repo.id}`;
                const recent = isRecentlyActive(repo);
                return (
                  <li
                    key={repo.id}
                    className="flex min-h-12 items-center gap-3 border-b px-4 py-2 last:border-b-0"
                  >
                    <Switch
                      id={switchId}
                      checked={isOn(repo)}
                      aria-label={`Include ${repo.fullName}${repo.isPrivate ? ' (private)' : ''}`}
                      onCheckedChange={(checked) => {
                        setSelected((s) => ({ ...s, [repo.id]: checked }));
                      }}
                    />
                    <label
                      htmlFor={switchId}
                      className="flex min-w-0 flex-1 cursor-pointer flex-col"
                    >
                      <span className="truncate font-medium">{repo.fullName}</span>
                      <span className="text-caption text-subtle-foreground">
                        {recent && repo.lastActivityAt
                          ? `Your last activity ${formatRelative(repo.lastActivityAt)}`
                          : 'No activity from you in the last 12 months'}
                      </span>
                    </label>
                    {repo.isPrivate ? (
                      <Badge variant="neutral" className="max-[400px]:hidden">
                        <Lock aria-hidden="true" />
                        Private
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="max-[400px]:hidden">
                        Public
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3">
          <span className="text-caption text-subtle-foreground">
            Missing a repository?{' '}
            <a
              href={integration.manageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link underline underline-offset-2"
            >
              Add it on GitHub
            </a>
          </span>
          <span className="flex-1" />
          <Button variant="secondary" asChild>
            <Link href="/onboarding/connect">Back</Link>
          </Button>
          <Button
            loading={saving}
            disabled={repos.isSuccess && count === 0}
            onClick={() => void startImport()}
          >
            Start import
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <OnboardingStepper current={1} />
      <div className="flex flex-col gap-4">
        {header}
        {body}
      </div>
    </>
  );
}
