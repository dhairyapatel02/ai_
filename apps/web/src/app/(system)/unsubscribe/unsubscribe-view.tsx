'use client';

import { CircleCheck, LoaderCircle, MailX } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useUnsubscribe } from '@/lib/api/career-hooks';
import { isApiError } from '@/lib/api/errors';

const SETTINGS = '/sign-in?callbackUrl=%2Fsettings%2Fnotifications';

/**
 * Unsubscribe (S24, F-63): posts the signed token from the email link once on load
 * (`POST /notifications/unsubscribe`, public). Expired and invalid links share one message.
 */
export function UnsubscribeView({ token }: { token: string | null }) {
  const unsubscribe = useUnsubscribe();
  const sent = useRef(false);
  const { mutate } = unsubscribe;
  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    mutate(token);
  }, [token, mutate]);

  if (!token || unsubscribe.isError) {
    const expired =
      isApiError(unsubscribe.error) &&
      (unsubscribe.error.details as { reason?: string } | undefined)?.reason === 'expired';
    return (
      <EmptyState
        icon={MailX}
        headingLevel={1}
        title={expired ? 'This unsubscribe link has expired' : 'This unsubscribe link is invalid'}
        description={
          isApiError(unsubscribe.error) && unsubscribe.error.code === 'RATE_LIMITED'
            ? 'Too many attempts. Try again in a minute, or sign in to change your email settings.'
            : 'Sign in to change your email settings.'
        }
        actions={
          <Button asChild>
            <Link href={SETTINGS}>Sign in</Link>
          </Button>
        }
      />
    );
  }
  if (unsubscribe.isSuccess) {
    return (
      <EmptyState
        icon={CircleCheck}
        headingLevel={1}
        title={
          unsubscribe.data.list === 'all'
            ? "You're unsubscribed from all DevImpact emails."
            : "You're unsubscribed from the weekly digest."
        }
        description="You won't get these emails any more. You can turn them back on in your settings."
        actions={
          <Button variant="secondary" asChild>
            <Link href={SETTINGS}>Change all email settings</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
      <LoaderCircle className="size-6 animate-spin text-subtle-foreground" aria-hidden="true" />
      <h1 className="text-lg font-semibold">Updating your email preferences…</h1>
    </div>
  );
}
