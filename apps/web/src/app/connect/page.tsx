'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SyncStatusBadge } from '@/components/sync-status-badge';
import { Github, GitlabIcon, Trello, RefreshCw } from 'lucide-react';

const integrations = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Connect your GitHub account to sync commits, PRs, and code reviews.',
    icon: Github,
    connected: false,
    lastSync: null,
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'Connect your GitLab account to sync merge requests and commits.',
    icon: GitlabIcon,
    connected: false,
    lastSync: null,
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Connect Jira to sync issues, story points, and project data.',
    icon: Trello,
    connected: false,
    lastSync: null,
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Connect Linear to sync issues and project tracking data.',
    icon: Trello,
    connected: false,
    lastSync: null,
  },
];

export default function ConnectPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Integrations</h1>
        <p className="text-muted-foreground">Connect your developer tools to sync activity data</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {integrations.map((integration) => (
          <Card key={integration.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <integration.icon className="h-8 w-8" />
                  <div>
                    <CardTitle className="text-lg">{integration.name}</CardTitle>
                    <CardDescription>{integration.description}</CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SyncStatusBadge status={integration.connected ? 'complete' : 'idle'} />
                  {integration.lastSync && (
                    <span className="text-xs text-muted-foreground">
                      Last sync: {integration.lastSync}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {integration.connected && (
                    <Button variant="outline" size="sm" className="gap-1">
                      <RefreshCw className="h-3 w-3" />
                      Sync
                    </Button>
                  )}
                  <Button
                    variant={integration.connected ? 'destructive' : 'default'}
                    size="sm"
                  >
                    {integration.connected ? 'Disconnect' : 'Connect'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
