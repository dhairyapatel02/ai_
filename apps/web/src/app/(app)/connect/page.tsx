'use client';

/* eslint-disable @typescript-eslint/no-deprecated -- lucide brand icons are deprecated upstream; the P09 design system replaces them. */
import { Github, GitlabIcon, Trello, RefreshCw, Loader2 } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';

import { SyncStatusBadge } from '@/components/sync-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuth } from '@/lib/auth-context';

import type { SyncStatusDto } from '@devimpact/shared';

interface Integration {
  id: string;
  provider: string;
  status: 'active' | 'needs_reauth' | 'suspended' | 'disconnected' | 'error';
  externalLogin: string | null;
  createdAt: string;
}

/** `GET /sync/status` (API_CONTRACT_V2 §8): read from the database, per integration. */
type SyncStatus = SyncStatusDto;

const ACTIVE_STATES = new Set(['queued', 'running', 'waiting_rate_limit']);

/** Transitional mapping onto the v1 badge (P10 builds the designed sync states). */
function badgeFor(status: SyncStatus | null): 'syncing' | 'complete' | 'error' | 'idle' {
  if (!status) return 'idle';
  if (ACTIVE_STATES.has(status.state)) return 'syncing';
  if (status.state === 'failed' || status.state === 'needs_reauth') return 'error';
  return status.lastRun ? 'complete' : 'idle';
}

const PROVIDER_CONFIG = [
  {
    id: 'GITHUB',
    name: 'GitHub',
    description: 'Connect your GitHub account to sync commits, PRs, and code reviews.',
    icon: Github,
    connectable: true,
  },
  {
    id: 'GITLAB',
    name: 'GitLab',
    description: 'Connect your GitLab account to sync merge requests and commits.',
    icon: GitlabIcon,
    connectable: false,
  },
  {
    id: 'JIRA',
    name: 'Jira',
    description: 'Connect Jira to sync issues, story points, and project data.',
    icon: Trello,
    connectable: false,
  },
  {
    id: 'LINEAR',
    name: 'Linear',
    description: 'Connect Linear to sync issues and project tracking data.',
    icon: Trello,
    connectable: false,
  },
];

export default function ConnectPage() {
  const { apiFetch, user } = useAuth();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const fetchIntegrations = useCallback(async () => {
    const res = await apiFetch<Integration[]>('/integrations');
    if (res.success && res.data) setIntegrations(res.data);
  }, [apiFetch]);

  const fetchSyncStatus = useCallback(async () => {
    const res = await apiFetch<SyncStatus>('/sync/status');
    if (res.success && res.data) setSyncStatus(res.data);
  }, [apiFetch]);

  useEffect(() => {
    if (!user) return;
    async function load() {
      await Promise.all([fetchIntegrations(), fetchSyncStatus()]);
      setLoading(false);
    }
    void load();
  }, [user, fetchIntegrations, fetchSyncStatus]);

  const handleConnect = async (providerId: string) => {
    if (providerId === 'GITHUB') {
      setConnectingProvider('GITHUB');
      const res = await apiFetch<{ url: string }>('/integrations/github/connect', {
        method: 'POST',
        body: JSON.stringify({ returnTo: '/connect' }),
      });
      if (res.success && res.data?.url) {
        window.location.href = res.data.url;
      } else {
        setConnectingProvider(null);
        alert(res.error || 'Failed to start the GitHub connection.');
      }
    }
  };

  const handleReconnect = async (integrationId: string) => {
    const res = await apiFetch<{ url: string }>(`/integrations/${integrationId}/reconnect`, {
      method: 'POST',
    });
    if (res.success && res.data?.url) window.location.href = res.data.url;
    else alert(res.error || 'Failed to start the GitHub reconnection.');
  };

  const handleDisconnect = async (integrationId: string) => {
    // Confirmable (F-17): revoke access, then keep or purge the synced activity.
    if (!window.confirm('Disconnect GitHub? DevImpact will revoke its access token.')) return;
    const purge = window.confirm(
      'Also delete the activity synced from this account? Press Cancel to keep it.',
    );
    setDisconnecting(integrationId);
    await apiFetch(`/integrations/${integrationId}?purgeData=${purge}`, { method: 'DELETE' });
    await fetchIntegrations();
    setDisconnecting(null);
  };

  const handleSync = async () => {
    setSyncing(true);
    // POST /sync replaces the v1 POST /sync/trigger. 409 SYNC_IN_PROGRESS just means "already
    // running": keep polling the current run.
    const started = await apiFetch('/sync', { method: 'POST', body: JSON.stringify({}) });
    if (!started.success && !/already running/i.test(started.error ?? '')) {
      setSyncing(false);
      alert(started.error || 'Could not start a sync.');
      return;
    }
    // Polling contract: every 2 s while queued/running (API_CONTRACT_V2 §8).
    const poll = setInterval(() => {
      void (async () => {
        const res = await apiFetch<SyncStatus>('/sync/status');
        if (res.success && res.data) {
          setSyncStatus(res.data);
          if (!ACTIVE_STATES.has(res.data.state)) {
            clearInterval(poll);
            setSyncing(false);
          }
        }
      })();
    }, 2000);
  };

  const live = integrations.filter((i) => i.status !== 'disconnected');
  const isConnected = (providerId: string) =>
    live.some((i) => i.provider.toUpperCase() === providerId);

  const getIntegration = (providerId: string) =>
    live.find((i) => i.provider.toUpperCase() === providerId);

  if (loading && user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Integrations</h1>
        <p className="text-muted-foreground">Connect your developer tools to sync activity data</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDER_CONFIG.map((provider) => {
          const connected = isConnected(provider.id);
          const integration = getIntegration(provider.id);

          return (
            <Card key={provider.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <provider.icon className="h-8 w-8" />
                    <div>
                      <CardTitle className="text-lg">{provider.name}</CardTitle>
                      <CardDescription>{provider.description}</CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SyncStatusBadge
                      status={
                        connected && integration
                          ? syncing
                            ? 'syncing'
                            : badgeFor(syncStatus)
                          : 'idle'
                      }
                    />
                    {connected && syncStatus?.currentRun && (
                      <span className="text-xs text-muted-foreground">
                        {syncStatus.currentRun.stage.replace('_', ' ')} ·{' '}
                        {syncStatus.currentRun.progress}%
                      </span>
                    )}
                    {connected && !syncStatus?.currentRun && syncStatus?.lastSuccessfulAt && (
                      <span className="text-xs text-muted-foreground">
                        Last sync: {new Date(syncStatus.lastSuccessfulAt).toLocaleString()}
                      </span>
                    )}
                    {connected && syncStatus?.lastRun?.errorMessage && !syncStatus.currentRun && (
                      <span className="text-xs text-destructive">
                        {syncStatus.lastRun.errorMessage}
                      </span>
                    )}
                    {connected && integration?.externalLogin && (
                      <span className="text-xs text-muted-foreground">
                        @{integration.externalLogin}
                      </span>
                    )}
                    {integration?.status === 'needs_reauth' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleReconnect(integration.id)}
                      >
                        Reconnect
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {connected && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={handleSync}
                        disabled={syncing}
                      >
                        <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
                        {syncing ? 'Syncing...' : 'Sync'}
                      </Button>
                    )}
                    {connected && integration ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDisconnect(integration.id)}
                        disabled={disconnecting === integration.id}
                      >
                        {disconnecting === integration.id ? 'Disconnecting...' : 'Disconnect'}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleConnect(provider.id)}
                        disabled={!provider.connectable || connectingProvider === provider.id}
                      >
                        {!provider.connectable
                          ? 'Coming Soon'
                          : connectingProvider === provider.id
                            ? 'Connecting...'
                            : 'Connect'}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
