'use client';

import { Copy, Hourglass, RotateCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import { startGitHubConnect, useSaveOnboardingStep } from '@/components/onboarding/use-onboarding';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/errors';
import { useIntegrations } from '@/lib/api/hooks';

const ADMIN_MESSAGE =
  'Hi — could you approve the DevImpact GitHub App for our organization? It needs read-only access to pull requests, reviews and commits so I can track my own engineering impact. You can review the request in the organization settings on GitHub, under GitHub Apps → Pending requests.';

/** SCREENS S3 · Onboarding · Approval pending (`setupAction=request`). */
export function PendingStep() {
  useSaveOnboardingStep('pending');
  const router = useRouter();
  const integrations = useIntegrations();
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const active = integrations.data?.find((i) => i.status === 'active');
  const orgs = active?.installations.filter((i) => i.accountType === 'Organization') ?? [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ADMIN_MESSAGE);
      toast.success('Message copied');
    } catch {
      toast.error('Copy was blocked. Select the text and copy it manually.');
    }
  };

  const checkAgain = async () => {
    setChecking(true);
    const before = new Set(orgs.map((o) => o.installationId));
    try {
      const result = await integrations.refetch();
      if (result.error) throw result.error;
      const list = result.data ?? [];
      const approved = list
        .flatMap((i) => i.installations)
        .find((i) => i.accountType === 'Organization' && !before.has(i.installationId));
      if (approved) {
        toast.success(`${approved.accountLogin} approved DevImpact. Importing its repositories.`);
        router.push('/onboarding/repositories');
      } else {
        toast.info('Still waiting for approval.');
      }
    } catch (error) {
      toast.error(errorMessage(error, 'the approval status'));
    } finally {
      setChecking(false);
    }
  };

  const installPersonal = async () => {
    setInstalling(true);
    try {
      await startGitHubConnect('/onboarding');
    } catch (error) {
      toast.error(errorMessage(error, 'GitHub'));
      setInstalling(false);
    }
  };

  return (
    <>
      <OnboardingStepper current={0} />
      <div className="flex flex-col items-start gap-3 rounded-md border bg-card p-6">
        <span className="flex size-10 items-center justify-center rounded-md bg-surface-2 text-muted-foreground">
          <Hourglass className="size-5" aria-hidden="true" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">
          Waiting for your organization to approve DevImpact
        </h1>
        <p className="max-w-[60ch] text-muted-foreground">
          An organization owner must approve the app on GitHub before DevImpact can read those
          repositories. GitHub has notified the owners.
        </p>
        <div className="flex w-full max-w-[520px] flex-col gap-2 rounded-md bg-surface-2 p-3">
          <span className="text-sm font-medium" id="admin-message-label">
            Message you can send your admin
          </span>
          <p
            className="text-sm text-muted-foreground select-all"
            aria-labelledby="admin-message-label"
          >
            {ADMIN_MESSAGE}
          </p>
          <Button size="sm" variant="secondary" className="self-start" onClick={() => void copy()}>
            <Copy aria-hidden="true" />
            Copy message
          </Button>
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          {integrations.isPending ? null : active ? (
            <Button
              onClick={() => {
                router.push('/onboarding/repositories');
              }}
            >
              Continue with personal repositories
            </Button>
          ) : (
            <Button loading={installing} onClick={() => void installPersonal()}>
              Install on my personal account
            </Button>
          )}
          <Button variant="secondary" loading={checking} onClick={() => void checkAgain()}>
            <RotateCw aria-hidden="true" />
            Check again
          </Button>
        </div>
        <p className="text-caption text-subtle-foreground">
          We&apos;ll email you when the organization approves the app, and import its repositories
          automatically.
        </p>
      </div>
    </>
  );
}
