'use client';

import { CalendarX } from 'lucide-react';

import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api/errors';
import { usePeriod } from '@/lib/period';

/** Designed INVALID_PERIOD state (malformed `?period=` or `400 INVALID_PERIOD` from the API). */
export function InvalidPeriodState({ message }: { message?: string | null }) {
  const period = usePeriod();
  return (
    <div className="rounded-md border bg-card">
      <EmptyState
        icon={CalendarX}
        title="That period isn't valid"
        description={`${message ? `${message}. ` : ''}Choose 7–366 days that don't start in the future.`}
        actions={
          <Button
            onClick={() => {
              period.setPeriod(null);
            }}
          >
            Show the default period
          </Button>
        }
      />
    </div>
  );
}

export function isInvalidPeriodError(error: unknown): boolean {
  return isApiError(error) && error.code === 'INVALID_PERIOD';
}
