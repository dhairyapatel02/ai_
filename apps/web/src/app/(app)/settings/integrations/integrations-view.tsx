'use client';

import { ConnectGitHubResult, DisconnectResult, type IntegrationDto } from '@devimpact/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plug, RefreshCw } from 'lucide-react';
import { useState } from 'react';
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
import { SyncStatusBadge } from '@/components/sync-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { apiClient } from '@/lib/api/browser';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { isSyncActive, useIntegrations, useMe, useStartSync, useSyncStatus } from '@/lib/api/hooks';
import { qk } from '@/lib/api/query-keys';
import { formatRelative } from '@/lib/format';
import { CONNECT_ERRORS } from '@/lib/onboarding';

const PLANNED = [
  { name: 'GitLab', text: 'Merge requests and commits.' },
  { name: 'Jira', text: 'Issues and project data.' },
  { name: 'Linear', text: 'Issues and project tracking.' },
];

/**
 * Interim Settings → Integrations (replaces the v0.1 `/connect` page; P10 builds S19): GitHub
 * connection status, Sync now, Reconnect, Disconnect (keep or delete data), planned providers.
 */
export function IntegrationsView({ connectError }: { connectError?: string }) {
  const integrations = useIntegrations();
  const github = integrations.data?.find((i) => i.status !== 'disconnected');
  const notice = connectError ? (CONNECT_ERRORS[connectError] ?? CONNECT_ERRORS.failed) : null;

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <PageHeader
        title="Integrations"
        lede="Where DevImpact reads your engineering activity."
        className="mb-2"
      />
      {notice ? (
        <Banner tone="danger" role="alert" title={notice.title}>
          {notice.body}
        </Banner>
      ) : null}
      {integrations.isPending ? (
        <ListSkeleton rows={2} label="Loading integrations…" />
      ) : integrations.isError ? (
        <Card>
          <ErrorState
            error={integrations.error}
            what="your integrations"
            onRetry={() => void integrations.refetch()}
          />
        </Card>
      ) : github ? (
        <GitHubCard integration={github} />
      ) : (
        <ConnectCard />
      )}
      <h2 className="mt-4 text-base font-semibold">Planned</h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {PLANNED.map((p) => (
          <li
            key={p.name}
            className="flex flex-col gap-1 rounded-md border border-dashed border-border-strong p-4"
          >
            <span className="font-medium">{p.name}</span>
            <span className="text-sm text-muted-foreground">{p.text}</span>
            <span className="text-caption text-subtle-foreground">Planned for v2.1</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConnectCard() {
  const [starting, setStarting] = useState(false);
  return (
    <Card>
      <EmptyState
        icon={Plug}
        title="GitHub isn't connected"
        description="Install the read-only DevImpact GitHub App to import pull requests, reviews and commits from the repositories you pick."
        actions={
          <Button
            loading={starting}
            onClick={() => {
              setStarting(true);
              startGitHubConnect('/settings/integrations').catch((error: unknown) => {
                toast.error(errorMessage(error, 'GitHub'));
                setStarting(false);
              });
            }}
          >
            <GitHubIcon className="size-4" />
            Connect GitHub
          </Button>
        }
      />
    </Card>
  );
}

function GitHubCard({ integration }: { integration: IntegrationDto }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const sync = useSyncStatus({ integrationId: integration.id });
  const start = useStartSync();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [purge, setPurge] = useState<'keep' | 'purge'>('keep');
  const [reconnecting, setReconnecting] = useState(false);
  const timezone = me.data?.settings.timezone;
  const needsReauth = integration.status === 'needs_reauth' || sync.data?.state === 'needs_reauth';
  const running = isSyncActive(sync.data);

  const reconnect = async () => {
    setReconnecting(true);
    try {
      const { url } = await apiClient.post(`/integrations/${integration.id}/reconnect`, {
        schema: ConnectGitHubResult,
      });
      window.location.assign(url);
    } catch (error) {
      toast.error(errorMessage(error, 'the reconnect link'));
      setReconnecting(false);
    }
  };

  const disconnect = useMutation({
    mutationFn: () =>
      apiClient.delete(`/integrations/${integration.id}`, {
        query: { purgeData: purge === 'purge' },
        schema: DisconnectResult,
      }),
    onSuccess: async (result) => {
      setConfirmOpen(false);
      toast.success(
        result.purged
          ? 'GitHub disconnected and its data deleted'
          : 'GitHub disconnected — your data is kept',
      );
      await Promise.all(
        [qk.integrations.all, qk.me.all, qk.sync.all].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
    onError: (error) => toast.error(errorMessage(error, 'the disconnect')),
  });

  const syncNow = () => {
    start.mutate(integration.id, {
      onSuccess: (result) => {
        toast.info(result.alreadyRunning ? 'A sync is already running' : 'Sync started');
      },
      onError: (error) => {
        if (isApiError(error) && error.code === 'INTEGRATION_NEEDS_REAUTH') void reconnect();
        else toast.error(errorMessage(error, 'the sync'));
      },
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-3">
        <GitHubIcon className="size-6" />
        <div className="min-w-0 flex-1">
          <CardTitle>
            <h2>GitHub</h2>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {integration.externalLogin ? `@${integration.externalLogin}` : 'Connected'}
            {integration.lastSuccessfulSyncAt
              ? ` · Last synced ${formatRelative(integration.lastSuccessfulSyncAt, { timeZone: timezone })}`
              : ''}
          </p>
        </div>
        <SyncStatusBadge status={sync.data} loading={sync.isPending} timezone={timezone} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {sync.data?.currentRun ? (
          <p className="text-sm text-muted-foreground" data-testid="sync-progress">
            {sync.data.currentRun.stage.replace('_', ' ')} · {sync.data.currentRun.progress}%
          </p>
        ) : null}
        {sync.data?.lastRun?.errorMessage && !sync.data.currentRun ? (
          <p className="text-sm text-destructive">{sync.data.lastRun.errorMessage}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {needsReauth ? (
            <Button loading={reconnecting} onClick={() => void reconnect()}>
              Reconnect GitHub
            </Button>
          ) : (
            <Button
              variant="secondary"
              loading={start.isPending}
              disabled={running}
              onClick={syncNow}
            >
              <RefreshCw aria-hidden="true" />
              Sync now
            </Button>
          )}
          <Button variant="ghost" asChild>
            <a href={integration.manageUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              Manage on GitHub
            </a>
          </Button>
          <Button
            variant="destructive-outline"
            onClick={() => {
              setConfirmOpen(true);
            }}
          >
            Disconnect
          </Button>
        </div>
        {running ? (
          <p className="text-caption text-subtle-foreground">A sync is already running.</p>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Disconnect GitHub?"
        description="DevImpact revokes its access at GitHub and stops importing. Choose what happens to the activity already imported."
        confirmLabel={purge === 'purge' ? 'Disconnect and delete data' : 'Disconnect'}
        destructive
        loading={disconnect.isPending}
        onConfirm={() => {
          disconnect.mutate();
        }}
      >
        <RadioGroup
          value={purge}
          onValueChange={(v) => {
            setPurge(v as 'keep' | 'purge');
          }}
          className="gap-2"
        >
          {[
            ['keep', 'Keep my data', 'Your KPIs and documents stay. You can reconnect later.'],
            [
              'purge',
              'Delete imported data',
              "Pull requests, reviews and commits from GitHub are deleted. This can't be undone.",
            ],
          ].map(([value, title, text]) => (
            <Label
              key={value}
              htmlFor={`purge-${value}`}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary"
            >
              <RadioGroupItem id={`purge-${value}`} value={value ?? ''} className="mt-0.5" />
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
