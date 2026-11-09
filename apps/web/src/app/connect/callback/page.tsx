'use client';

import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth-context';

function CallbackCard({
  status,
  message,
}: {
  status: 'processing' | 'success' | 'error';
  message: string;
}) {
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
          {status === 'success' && <CheckCircle2 className="h-12 w-12 text-green-500" />}
          {status === 'error' && <XCircle className="h-12 w-12 text-red-500" />}
          <p className="text-center text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function GitHubCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { apiFetch, loading } = useAuth();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [message, setMessage] = useState('Connecting your GitHub account...');
  // BUG-02: the OAuth code is single-use. Exchange it at most once even if the effect re-runs
  // (apiFetch identity changes after auth loads; React StrictMode double-invokes effects).
  const exchangeStarted = useRef(false);

  useEffect(() => {
    // Wait for the auth context so the request carries the user's identity.
    if (loading || exchangeStarted.current) return;
    exchangeStarted.current = true;

    const code = searchParams.get('code');
    if (!code) {
      setStatus('error');
      setMessage('No authorization code received from GitHub.');
      return;
    }

    async function exchangeCode(authCode: string) {
      const result = await apiFetch<{ id: string; provider: string }>(
        '/integrations/github/callback',
        {
          method: 'POST',
          body: JSON.stringify({ code: authCode }),
        },
      );

      if (result.success) {
        setStatus('success');
        setMessage('GitHub connected successfully! Redirecting...');
        setTimeout(() => {
          router.push('/connect');
        }, 1500);
      } else {
        setStatus('error');
        setMessage(result.error || 'Failed to connect GitHub. Please try again.');
      }
    }

    void exchangeCode(code);
  }, [searchParams, apiFetch, router, loading]);

  return <CallbackCard status={status} message={message} />;
}

export default function GitHubCallbackPage() {
  // BUG-01: useSearchParams() must be inside a Suspense boundary for `next build`.
  return (
    <Suspense
      fallback={<CallbackCard status="processing" message="Connecting your GitHub account..." />}
    >
      <GitHubCallback />
    </Suspense>
  );
}
