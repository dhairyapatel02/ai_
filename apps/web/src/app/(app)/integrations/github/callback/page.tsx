'use client';

import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth-context';

type Status = 'processing' | 'success' | 'pending' | 'error';

/** Only the destinations the API accepts as `returnTo` (no open redirect). */
const RETURN_TO = new Set(['/onboarding', '/settings/integrations', '/connect']);

function CallbackCard({ status, message }: { status: Status; message: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">GitHub Connection</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          {status === 'processing' && (
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
          )}
          {(status === 'success' || status === 'pending') && (
            <CheckCircle2 className="h-12 w-12 text-green-500" />
          )}
          {status === 'error' && <XCircle className="h-12 w-12 text-red-500" />}
          <p role="status" className="text-center text-muted-foreground">
            {message}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * GitHub App setup/authorize callback (IA `/integrations/github/callback`). Forwards GitHub's query
 * parameters to the API, which verifies the signed `state` and exchanges the code server-side.
 */
function GitHubCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { apiFetch, loading } = useAuth();
  const [status, setStatus] = useState<Status>('processing');
  const [message, setMessage] = useState('Connecting your GitHub account…');
  // The code and state are single-use: exchange at most once (BUG-02, StrictMode double effects).
  const exchangeStarted = useRef(false);

  useEffect(() => {
    if (loading || exchangeStarted.current) return;
    exchangeStarted.current = true;

    const param = (name: string) => searchParams.get(name) ?? undefined;
    const body = Object.fromEntries(
      Object.entries({
        code: param('code'),
        state: param('state'),
        installationId: param('installation_id'),
        setupAction: param('setup_action'),
        error: param('error'),
        errorDescription: param('error_description'),
      }).filter(([, v]) => v !== undefined),
    );

    void (async () => {
      const result = await apiFetch<{ pendingApproval?: boolean; returnTo?: string | null }>(
        '/integrations/github/callback',
        { method: 'POST', body: JSON.stringify(body) },
      );
      const returnTo =
        result.data?.returnTo && RETURN_TO.has(result.data.returnTo)
          ? result.data.returnTo
          : '/connect';
      // Remove code/state from the address bar and history.
      window.history.replaceState(null, '', '/integrations/github/callback');

      if (result.success && result.data?.pendingApproval) {
        setStatus('pending');
        setMessage(
          'Waiting for an organization owner to approve the GitHub App. We will sync once it is approved.',
        );
        setTimeout(() => {
          router.replace(returnTo);
        }, 2500);
      } else if (result.success) {
        setStatus('success');
        setMessage('GitHub connected. Your first sync has started. Redirecting…');
        setTimeout(() => {
          router.replace(returnTo);
        }, 1500);
      } else {
        setStatus('error');
        setMessage(result.error ?? 'Failed to connect GitHub. Please try again.');
      }
    })();
  }, [searchParams, apiFetch, router, loading]);

  return <CallbackCard status={status} message={message} />;
}

export default function GitHubCallbackPage() {
  // useSearchParams() must be inside a Suspense boundary for `next build` (BUG-01).
  return (
    <Suspense
      fallback={<CallbackCard status="processing" message="Connecting your GitHub account…" />}
    >
      <GitHubCallback />
    </Suspense>
  );
}
