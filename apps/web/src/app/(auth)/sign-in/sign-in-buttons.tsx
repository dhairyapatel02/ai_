'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

interface Props {
  callbackUrl: string;
  github: boolean;
  google: boolean;
  devLogin: boolean;
}

export function SignInButtons({ callbackUrl, github, google, devLogin }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const social = async (provider: 'github' | 'google') => {
    setBusy(provider);
    setError(null);
    const { error: err } = await authClient.signIn.social({
      provider,
      callbackURL: callbackUrl,
      errorCallbackURL: '/sign-in?error=oauth',
    });
    if (err) {
      setError(err.message ?? 'Sign-in failed');
      setBusy(null);
    }
  };

  const demo = async () => {
    setBusy('demo');
    setError(null);
    const res = await fetch('/api/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (res.ok) {
      // Full navigation so the session (cookie just set) is re-read everywhere.
      window.location.assign(callbackUrl);
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    setError(body.error?.message ?? 'Demo sign-in failed');
    setBusy(null);
  };

  return (
    <div className="space-y-3">
      {github ? (
        <Button className="w-full" onClick={() => void social('github')} disabled={busy !== null}>
          {busy === 'github' ? 'Redirecting…' : 'Continue with GitHub'}
        </Button>
      ) : null}
      {google ? (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => void social('google')}
          disabled={busy !== null}
        >
          {busy === 'google' ? 'Redirecting…' : 'Continue with Google'}
        </Button>
      ) : null}
      {!github && !google && !devLogin ? (
        <p className="text-sm text-muted-foreground">
          No sign-in provider is configured. Set GITHUB_SIGNIN_* or GOOGLE_* (see README).
        </p>
      ) : null}
      {devLogin ? (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => void demo()}
          disabled={busy !== null}
        >
          {busy === 'demo' ? 'Signing in…' : 'Sign in as demo user (dev only)'}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
