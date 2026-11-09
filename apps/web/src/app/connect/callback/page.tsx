'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

export default function GitHubCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { apiFetch } = useAuth();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [message, setMessage] = useState('Connecting your GitHub account...');

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setStatus('error');
      setMessage('No authorization code received from GitHub.');
      return;
    }

    async function exchangeCode() {
      const result = await apiFetch<{ id: string; provider: string }>('/integrations/github/callback', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });

      if (result.success) {
        setStatus('success');
        setMessage('GitHub connected successfully! Redirecting...');
        setTimeout(() => router.push('/connect'), 1500);
      } else {
        setStatus('error');
        setMessage(result.error || 'Failed to connect GitHub. Please try again.');
      }
    }

    exchangeCode();
  }, [searchParams, apiFetch, router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">GitHub Connection</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          {status === 'processing' && <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />}
          {status === 'success' && <CheckCircle2 className="h-12 w-12 text-green-500" />}
          {status === 'error' && <XCircle className="h-12 w-12 text-red-500" />}
          <p className="text-center text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
