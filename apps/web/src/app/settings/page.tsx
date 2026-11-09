'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/lib/auth-context';

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <input
                type="text"
                defaultValue={user?.name || ''}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <input
                type="email"
                defaultValue={user?.email || ''}
                disabled
                className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm"
              />
            </div>
          </div>
          <Button>Save Changes</Button>
        </CardContent>
      </Card>

      {/* Plan */}
      <Card>
        <CardHeader>
          <CardTitle>Plan & Billing</CardTitle>
          <CardDescription>Manage your subscription</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Badge variant="default">{user?.plan || 'FREE'}</Badge>
            <span className="text-sm text-muted-foreground">
              5 generations/month, 1 integration
            </span>
          </div>
          <Separator />
          <div className="grid gap-3 md:grid-cols-3">
            <Card className="border-2">
              <CardContent className="p-4">
                <h3 className="font-semibold">Pro</h3>
                <p className="mt-1 text-2xl font-bold">
                  $12<span className="text-sm font-normal">/mo</span>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Unlimited generations, all integrations
                </p>
              </CardContent>
            </Card>
            <Card className="border-2">
              <CardContent className="p-4">
                <h3 className="font-semibold">Team</h3>
                <p className="mt-1 text-2xl font-bold">
                  $29<span className="text-sm font-normal">/mo</span>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Team dashboards, shared reports
                </p>
              </CardContent>
            </Card>
            <Card className="border-2">
              <CardContent className="p-4">
                <h3 className="font-semibold">Enterprise</h3>
                <p className="mt-1 text-2xl font-bold">Custom</p>
                <p className="mt-2 text-xs text-muted-foreground">SSO, custom integrations, SLA</p>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>Configure notification preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Weekly Summary</p>
              <p className="text-xs text-muted-foreground">Receive weekly activity digest</p>
            </div>
            <Button variant="outline" size="sm">
              Enable
            </Button>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Sync Notifications</p>
              <p className="text-xs text-muted-foreground">Get notified when sync completes</p>
            </div>
            <Button variant="outline" size="sm">
              Enable
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
