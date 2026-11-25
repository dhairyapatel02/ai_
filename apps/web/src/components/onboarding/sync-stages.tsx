import { Check, LoaderCircle } from 'lucide-react';

import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { SyncRunDto, SyncStage } from '@devimpact/shared';

interface StageDef {
  key: 'repositories' | 'authored_prs' | 'reviewed_prs' | 'commits' | 'rollups';
  label: string;
  note?: string;
  count?: (run: SyncRunDto) => number | undefined;
}

export const STAGES: StageDef[] = [
  {
    key: 'repositories',
    label: 'Repositories',
    note: 'Repositories you contribute to',
    count: (r) => r.counts.repos,
  },
  {
    key: 'authored_prs',
    label: 'Your pull requests',
    note: 'Newest 30 days first, then the rest of the year',
    count: (r) => r.counts.prsAuthored,
  },
  { key: 'reviewed_prs', label: 'Pull requests you reviewed', count: (r) => r.counts.prsReviewed },
  {
    key: 'commits',
    label: 'Commits',
    note: 'Default branches only',
    count: (r) => r.counts.commits,
  },
  { key: 'rollups', label: 'KPIs and impact score' },
];

/** Index of the active display stage for an engine stage (prepare → repositories, persist → commits). */
export function stageIndex(stage: SyncStage): number {
  switch (stage) {
    case 'prepare':
    case 'repositories':
      return 0;
    case 'authored_prs':
      return 1;
    case 'reviewed_prs':
      return 2;
    case 'commits':
    case 'issues': // issue trackers (P13) never appear in onboarding; mapped for completeness
    case 'persist':
      return 3;
    case 'rollups':
      return 4;
    case 'done':
      return STAGES.length;
  }
}

/**
 * Stage list (DESIGN_SYSTEM §5.2 SyncStages): done / active / pending icons with counts. The
 * overall progress bar lives in the page; this list is not live (the page announces changes).
 */
export function SyncStages({ run, finished }: { run: SyncRunDto | null; finished: boolean }) {
  const active = finished ? STAGES.length : run ? stageIndex(run.stage) : 0;
  return (
    <ul className="mt-3 flex flex-col">
      {STAGES.map((stage, index) => {
        const state = index < active ? 'done' : index === active ? 'active' : 'pending';
        const count = run && state !== 'pending' ? stage.count?.(run) : undefined;
        return (
          <li
            key={stage.key}
            className="flex min-h-12 items-center gap-3 border-b py-2 last:border-b-0"
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border',
                state === 'done' && 'border-primary bg-primary text-primary-foreground',
                state === 'active' && 'border-primary text-primary',
                state === 'pending' && 'border-border-strong',
              )}
              aria-hidden="true"
            >
              {state === 'done' ? (
                <Check className="size-3.5" />
              ) : state === 'active' ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">
                {stage.label}
                <span className="sr-only">
                  {state === 'done'
                    ? ' — done'
                    : state === 'active'
                      ? ' — in progress'
                      : ' — waiting'}
                </span>
              </span>
              {stage.note ? (
                <span className="text-caption text-subtle-foreground">{stage.note}</span>
              ) : null}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {count !== undefined ? formatCount(count) : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
