'use client';

import { ConnectReturnTo, GitHubCallbackResult } from '@devimpact/shared';
import { LoaderCircle, PlugZap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api/browser';
import { isApiError } from '@/lib/api/errors';
import { CONNECT_RETURN_KEY } from '@/lib/onboarding';

type Outcome = { kind: 'working' } | { kind: 'error'; message: string; back: string };

/** Maps an API error of the callback to the `?error=` key the connect step understands. */
export function callbackErrorKey(error: unknown): string {
  if (!isApiError(error)) return 'failed';
  switch (error.code) {
    case 'OAUTH_DENIED':
      return 'denied';
    case 'OAUTH_STATE_INVALID':
      return 'expired';
    case 'INTEGRATION_ACCOUNT_IN_USE':
      return 'in_use';
    case 'ENTITLEMENT_REQUIRED':
      return 'entitlement';
    case 'UPSTREAM_ERROR':
    case 'UPSTREAM_UNAVAILABLE':
      return 'upstream';
    default:
      return 'failed';
  }
}

/** Builds the API body from GitHub's query string (snake_case → contract names). */
export function callbackBody(params: Record<string, string>) {
  return Object.fromEntries(
    Object.entries({
      code: params.code,
      state: params.state,
      installationId: params.installation_id,
      setupAction: params.setup_action,
      error: params.error,
      errorDescription: params.error_description,
    }).filter(([, v]) => v !== undefined && v !== ''),
  );
}

function rememberedReturn(): ConnectReturnTo {
  try {
    const value = window.sessionStorage.getItem(CONNECT_RETURN_KEY);
    const parsed = ConnectReturnTo.safeParse(value);
    return parsed.success ? parsed.data : '/onboarding';
  } catch {
    return '/onboarding';
  }
}

/**
 * Forwards GitHub's parameters to `POST /integrations/github/callback` (state verified and code
 * exchanged server-side), then routes to onboarding or Settings → Integrations. The code and state
 * are single-use, so the exchange runs at most once (StrictMode double effects, BUG-02).
 */
export function GitHubCallback({ params }: { params: Record<string, string> }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'working' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Remove code/state from the address bar and history.
    window.history.replaceState(null, '', '/integrations/github/callback');
    const fallback = rememberedReturn();
    const errorTarget = (key: string) =>
      fallback === '/settings/integrations'
        ? `/settings/integrations?connectError=${key}`
        : `/onboarding/connect?error=${key}`;

    if (!params.state) {
      setOutcome({
        kind: 'error',
        message: 'This link is incomplete. Start the GitHub connection again.',
        back: fallback === '/settings/integrations' ? fallback : '/onboarding/connect',
      });
      return;
    }

    void (async () => {
      try {
        const result = await apiClient.post('/integrations/github/callback', {
          body: callbackBody(params),
          schema: GitHubCallbackResult,
        });
        const parsedReturn = ConnectReturnTo.safeParse(result.returnTo);
        const returnTo = parsedReturn.success ? parsedReturn.data : fallback;
        try {
          window.sessionStorage.removeItem(CONNECT_RETURN_KEY);
        } catch {
          // ignore
        }
        if ('pendingApproval' in result) {
          if (returnTo === '/onboarding') {
            router.replace('/onboarding/pending');
          } else {
            toast.info('Waiting for your organization to approve DevImpact.');
            router.replace('/settings/integrations');
          }
          return;
        }
        toast.success('GitHub connected');
        router.replace(returnTo === '/onboarding' ? '/onboarding/repositories' : returnTo);
      } catch (error) {
        router.replace(errorTarget(callbackErrorKey(error)));
      }
    })();
  }, [params, router]);

  if (outcome.kind === 'error') {
    return (
      <EmptyState
        icon={PlugZap}
        headingLevel={1}
        title="GitHub couldn't be connected"
        description={outcome.message}
        actions={
          <Button asChild>
            <Link href={outcome.back}>Try again</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <LoaderCircle className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <h1 className="text-lg font-semibold">Connecting your GitHub account…</h1>
      <p className="text-muted-foreground" role="status">
        This takes a few seconds.
      </p>
    </div>
  );
}
