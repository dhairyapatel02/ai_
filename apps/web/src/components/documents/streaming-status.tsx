'use client';

import { LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * StreamingStatus (DESIGN_SYSTEM §5.2): "Writing section 2 of 5 · Key contributions", a note that
 * leaving is safe, and Stop. The visible line is not a live region; `announcement` feeds the one
 * polite region of the viewer (once per section, DESIGN_SYSTEM §10).
 */
export function StreamingStatus({
  step,
  queued,
  onStop,
  stopping,
}: {
  step: { index: number; total: number; label: string } | null;
  queued: boolean;
  onStop: () => void;
  stopping: boolean;
}) {
  const title = queued
    ? 'Queued — starting in a moment'
    : step
      ? `Writing section ${step.index} of ${step.total} · ${step.label}`
      : 'Writing your draft…';
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-info/25 bg-info-soft p-3 sm:flex-row sm:items-center"
      data-testid="streaming-status"
    >
      <LoaderCircle
        className="size-4 shrink-0 animate-spin text-info motion-reduce:animate-none"
        aria-hidden="true"
      />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-base font-medium">{title}</span>
        <span className="text-caption text-muted-foreground">
          You can leave this page — the draft keeps generating and appears in Documents.
        </span>
      </div>
      <Button size="sm" variant="secondary" onClick={onStop} loading={stopping}>
        Stop
      </Button>
    </div>
  );
}

/** The single polite live region of the viewer (announces sections and the result). */
export function LiveAnnouncer({ message }: { message: string }) {
  return (
    <div
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="live-region"
    >
      {message}
    </div>
  );
}
