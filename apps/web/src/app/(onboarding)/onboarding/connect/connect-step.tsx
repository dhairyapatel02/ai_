'use client';

import { CircleCheck, Eye, FolderGit2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { GitHubIcon } from '@/components/icons/github';
import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import {
  browserTimeZone,
  startGitHubConnect,
  useSaveOnboardingStep,
} from '@/components/onboarding/use-onboarding';
import { Banner, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { useMe } from '@/lib/api/hooks';
import { CONNECT_ERRORS } from '@/lib/onboarding';

function connectErrorKey(error: unknown): keyof typeof CONNECT_ERRORS {
  if (!isApiError(error)) return 'failed';
  if (error.code === 'ENTITLEMENT_REQUIRED') return 'entitlement';
  if (error.code === 'UPSTREAM_ERROR' || error.code === 'UPSTREAM_UNAVAILABLE') return 'upstream';
  return 'failed';
}

const FEATURES = [
  {
    icon: Eye,
    title: 'Read-only access',
    text: 'Pull requests, reviews, commits and repository metadata. DevImpact can never push code, comment or merge.',
  },
  {
    icon: FolderGit2,
    title: 'Only repositories you pick',
    text: 'Choose "All" or "Only select repositories" on GitHub. Private repository names can be redacted from AI output.',
  },
  {
    icon: RefreshCw,
    title: 'Kept up to date',
    text: 'A daily sync plus GitHub webhooks for near-real-time updates.',
  },
];

/** SCREENS S2 · Onboarding · Connect GitHub data. */
export function ConnectStep({ error }: { error?: string }) {
  const me = useMe();
  const timezone = browserTimeZone();
  useSaveOnboardingStep('connect', { timezone });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<{ title: string; body: string } | null>(null);
  const notice = startError ?? (error ? (CONNECT_ERRORS[error] ?? CONNECT_ERRORS.failed) : null);
  const connected = me.data?.integrations.find((i) => i.status === 'active');

  const install = async () => {
    setStarting(true);
    setStartError(null);
    try {
      await startGitHubConnect('/onboarding');
    } catch (caught) {
      const key = connectErrorKey(caught);
      setStartError(
        key === 'failed'
          ? { title: "GitHub couldn't be connected", body: errorMessage(caught, 'GitHub') }
          : (CONNECT_ERRORS[key] ?? null),
      );
      setStarting(false);
    }
  };

  return (
    <>
      <OnboardingStepper current={0} />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
            Connect your GitHub data
          </h1>
          <p className="max-w-[60ch] text-muted-foreground">
            Install the DevImpact GitHub App on your account or organization. You choose the
            repositories on GitHub, and you can change them at any time.
          </p>
        </div>
        {notice ? (
          <Banner tone="danger" role="alert" title={notice.title}>
            {notice.body}
          </Banner>
        ) : null}
        {me.isError ? (
          <div className="rounded-md border bg-card">
            <ErrorState
              error={me.error}
              what="your account"
              onRetry={() => void me.refetch()}
              retrying={me.isFetching}
            />
          </div>
        ) : (
          <div className="rounded-md border bg-card">
            <div className="flex flex-col gap-2 px-4 pt-4">
              <h2 className="text-base font-semibold">What DevImpact can see</h2>
              <ul className="flex flex-col">
                {FEATURES.map((f) => (
                  <li key={f.title} className="flex items-start gap-3 py-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-muted-foreground">
                      <f.icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="flex flex-col">
                      <span className="font-medium">{f.title}</span>
                      <span className="text-sm text-muted-foreground">{f.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t px-4 py-3">
              {me.isPending ? (
                <Skeleton className="h-8 w-40" />
              ) : connected ? (
                <>
                  <span className="inline-flex items-center gap-2 text-success">
                    <CircleCheck className="size-4" aria-hidden="true" />
                    GitHub connected
                    {connected.externalLogin ? ` as @${connected.externalLogin}` : ''}
                  </span>
                  <span className="flex-1" />
                  <Button asChild>
                    <Link href="/onboarding/repositories">Continue</Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button loading={starting} onClick={() => void install()}>
                    <GitHubIcon className="size-4" />
                    {starting ? 'Opening GitHub…' : 'Install GitHub App'}
                  </Button>
                  <span className="flex-1" />
                  <Link
                    href="/onboarding/pending"
                    className="text-sm text-link underline underline-offset-2"
                  >
                    My organization needs to approve apps
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
        {me.data ? (
          <p className="text-caption text-subtle-foreground">
            Signed in as {me.data.user.email} · Times will be shown in {me.data.settings.timezone}
            {me.data.settings.timezone === timezone ? ' (from your browser)' : ''} · You can change
            this in{' '}
            <Link href="/settings/profile" className="text-link underline underline-offset-2">
              Profile
            </Link>
            .
          </p>
        ) : null}
      </div>
    </>
  );
}
