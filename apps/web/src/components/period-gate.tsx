'use client';

import { CalendarX } from 'lucide-react';


import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api/errors';
import { usePeriod } from '@/lib/period';

import type { ReactNode } from 'react';

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

/** Renders children only when `?period=` is usable; otherwise the designed invalid-period state. */
export function PeriodGate({
  children,
}: {
  children: (apiPeriod: string | undefined) => ReactNode;
}) {
  const period = usePeriod();
  if (period.invalid) return <InvalidPeriodState message={period.invalid} />;
  return children(period.apiParam);
}
