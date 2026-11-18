'use client';

import { CloudOff, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils';

import { EmptyState } from './empty-state';

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
  const digest =
    !isApiError(error) && error && typeof error === 'object' && 'digest' in error
      ? String((error as { digest?: unknown }).digest ?? '')
      : '';
  return (
    <EmptyState
      icon={CloudOff}
      headingLevel={headingLevel}
      className={cn(className)}
      title={title ?? `Couldn't load ${what}`}
      description={errorMessage(error, what)}
      actions={
        onRetry || secondary ? (
          <>
            {onRetry ? (
              <Button onClick={onRetry} loading={retrying}>
                <RotateCw aria-hidden="true" />
                Try again
              </Button>
            ) : null}
            {secondary}
          </>
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
