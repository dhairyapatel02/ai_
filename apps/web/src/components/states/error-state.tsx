'use client';

import { CloudOff, RotateCw } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils';

import { EmptyState } from './empty-state';

import type { ReactNode } from 'react';

/**
 * Designed error state (DESIGN_SYSTEM §5.2, §9): what failed + likely cause + what to do, a Retry
 * button and the request ID for support. Never shows raw upstream payloads (UX-05).
 */
export function ErrorState({
  error,
  what = 'this',
  title,
  onRetry,
  retrying = false,
  secondary,
  headingLevel = 2,
  className,
}: {
  error: unknown;
  /** Names the thing that failed: "your dashboard". */
  what?: string;
  title?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  secondary?: ReactNode;
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  const requestId = isApiError(error) ? error.requestId : null;
  const rawDigest =
    !isApiError(error) && error && typeof error === 'object' && 'digest' in error
      ? (error as { digest?: unknown }).digest
      : undefined;
  const digest = typeof rawDigest === 'string' ? rawDigest : '';
  return (
    <EmptyState
      icon={CloudOff}
      headingLevel={headingLevel}
      className={cn(className)}
      title={
        title ??
        (isApiError(error) && error.code === 'ENTITLEMENT_REQUIRED'
          ? 'Outside your plan'
          : `Couldn't load ${what}`)
      }
      description={errorMessage(error, what)}
      actions={
        (onRetry || secondary) && !(isApiError(error) && error.code === 'ENTITLEMENT_REQUIRED') ? (
          <>
            {onRetry ? (
              <Button onClick={onRetry} loading={retrying}>
                <RotateCw aria-hidden="true" />
                Try again
              </Button>
            ) : null}
            {secondary}
          </>
        ) : isApiError(error) && error.code === 'ENTITLEMENT_REQUIRED' ? (
          <Button variant="secondary" asChild>
            <Link href="/settings/plan">See Plan &amp; usage</Link>
          </Button>
        ) : null
      }
    >
      {requestId || digest ? (
        <p className="text-caption text-subtle-foreground">
          {requestId ? 'Request ID' : 'Error ID'}{' '}
          <span className="font-mono select-all">{requestId ?? digest}</span>
        </p>
      ) : null}
    </EmptyState>
  );
}
