'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SyncStatusBadge } from '@/components/sync-status-badge';
import { useAuth } from '@/lib/auth-context';
import { Github, GitlabIcon, Trello, RefreshCw, Loader2 } from 'lucide-react';

interface Integration {
  id: string;
  provider: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface SyncStatus {
  status: string;
  jobId?: string;
  lastSync: string | null;
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
    load();
  }, [user, fetchIntegrations, fetchSyncStatus]);

  const handleConnect = async (providerId: string) => {
    if (providerId === 'GITHUB') {
      setConnectingProvider('GITHUB');
      const res = await apiFetch<{ url: string }>('/integrations/github/connect', {
        method: 'POST',
      });
      if (res.success && res.data?.url) {
        window.location.href = res.data.url;
      } else {
        setConnectingProvider(null);
        alert(res.error || 'Failed to get GitHub OAuth URL. Check GITHUB_CLIENT_ID is configured.');
      }
    }
  };

  const handleDisconnect = async (integrationId: string) => {
    setDisconnecting(integrationId);
    await apiFetch(`/integrations/${integrationId}`, { method: 'DELETE' });
    await fetchIntegrations();
    setDisconnecting(null);
  };

  const handleSync = async () => {
    setSyncing(true);
    await apiFetch('/sync/trigger', { method: 'POST' });
    // Poll sync status
    const poll = setInterval(async () => {
      const res = await apiFetch<SyncStatus>('/sync/status');
      if (res.success && res.data) {
        setSyncStatus(res.data);
        if (
          res.data.status === 'completed' ||
          res.data.status === 'failed' ||
          res.data.status === 'idle'
        ) {
          clearInterval(poll);
          setSyncing(false);
        }
      }
    }, 2000);
  };

  const isConnected = (providerId: string) => integrations.some((i) => i.provider === providerId);

  const getIntegration = (providerId: string) =>
    integrations.find((i) => i.provider === providerId);

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
                      status={connected ? (syncing ? 'syncing' : 'complete') : 'idle'}
                    />
                    {connected && syncStatus?.lastSync && (
                      <span className="text-xs text-muted-foreground">
                        Last sync: {new Date(syncStatus.lastSync).toLocaleString()}
                      </span>
                    )}
                    {connected && integration?.metadata && (
                      <span className="text-xs text-muted-foreground">
                        {(integration.metadata as Record<string, string>).username
                          ? `@${(integration.metadata as Record<string, string>).username}`
                          : ''}
                      </span>
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
                    {connected ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDisconnect(integration!.id)}
                        disabled={disconnecting === integration!.id}
                      >
                        {disconnecting === integration!.id ? 'Disconnecting...' : 'Disconnect'}
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
