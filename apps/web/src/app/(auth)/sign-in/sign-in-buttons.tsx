'use client';

import { Mail } from 'lucide-react';
import { useState } from 'react';

import { GitHubIcon } from '@/components/icons/github';
import { Banner } from '@/components/states';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { devLogin } from '@/lib/dev-login';

import type { SignInNotice } from './sign-in-notice';

interface Props {
  callbackUrl: string;
  github: boolean;
  google: boolean;
  devLogin: boolean;
  notice: SignInNotice | null;
}

type Busy = 'github' | 'google' | 'demo' | null;

export function SignInButtons({
  callbackUrl,
  github,
  google,
  devLogin: devLoginEnabled,
  notice,
}: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<SignInNotice | null>(null);
  const shown = error ?? notice;

  const social = async (provider: 'github' | 'google') => {
    setBusy(provider);
    setError(null);
    const name = provider === 'github' ? 'GitHub' : 'Google';
    try {
      const { error: err } = await authClient.signIn.social({
        provider,
        callbackURL: callbackUrl,
        errorCallbackURL: `/sign-in?provider=${provider}`,
      });
      if (err) throw new Error(err.message);
    } catch {
      setError({
        tone: 'danger',
        title: `We couldn't sign you in with ${name}.`,
        body: `Try again, or continue with ${provider === 'github' ? 'Google' : 'GitHub'}.`,
      });
      setBusy(null);
    }
  };

  const demo = async () => {
    setBusy('demo');
    setError(null);
    const result = await devLogin();
    if (result.ok) {
      // Full navigation so the session cookie that was just set is read everywhere.
      window.location.assign(callbackUrl);
      return;
    }
    setError({ tone: 'danger', title: 'Demo sign-in failed.', body: result.message });
    setBusy(null);
  };

  return (
    <div className="flex flex-col gap-6">
      {shown ? (
        <Banner
          tone={shown.tone === 'neutral' ? 'neutral' : shown.tone}
          role={shown.tone === 'danger' ? 'alert' : 'status'}
          title={shown.title}
        >
          {shown.body}
        </Banner>
      ) : null}
      <div className="flex flex-col gap-2">
        {github ? (
          <Button
            size="lg"
            className="w-full"
            loading={busy === 'github'}
            disabled={busy !== null && busy !== 'github'}
            onClick={() => void social('github')}
          >
            <GitHubIcon className="size-4" />
            {busy === 'github' ? 'Opening GitHub…' : 'Continue with GitHub'}
          </Button>
        ) : null}
        {google ? (
          <Button
            size="lg"
            variant="secondary"
            className="w-full"
            loading={busy === 'google'}
            disabled={busy !== null && busy !== 'google'}
            onClick={() => void social('google')}
          >
            <Mail aria-hidden="true" />
            {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
          </Button>
        ) : null}
        {!github && !google ? (
          <p className="text-muted-foreground">
            No sign-in provider is configured. Set{' '}
            <span className="font-mono">GITHUB_SIGNIN_*</span> or{' '}
            <span className="font-mono">GOOGLE_*</span> (see README).
          </p>
        ) : null}
      </div>
      <p className="text-caption text-subtle-foreground">
        Signing in only reads your name and email. Connecting repository data is a separate,
        read-only step you control.
      </p>
      {devLoginEnabled ? (
        <div className="flex flex-col gap-1 rounded-md bg-surface-2 p-3">
          <span className="text-sm font-medium">Development only</span>
          <span className="text-caption text-subtle-foreground">
            Shown when <span className="font-mono">ENABLE_DEV_LOGIN=true</span> outside production.
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="mt-1.5 self-start"
            loading={busy === 'demo'}
            disabled={busy !== null && busy !== 'demo'}
            onClick={() => void demo()}
          >
            Sign in as demo@devimpact.dev
          </Button>
        </div>
      ) : null}
    </div>
  );
}
