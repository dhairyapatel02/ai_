import { Award, CalendarCheck, Flag, Maximize2, type LucideIcon } from 'lucide-react';

import { displayRef } from '@/lib/career';

import type { CareerTimelineResponse } from '@devimpact/shared';

type Milestone = CareerTimelineResponse['quarters'][number]['milestones'][number];

const ICON: Record<Milestone['kind'], LucideIcon> = {
  first_merged_pr_in_repo: Flag,
  largest_merged_pr: Maximize2,
  longest_active_week_streak: CalendarCheck,
  achievement: Award,
};

/** Career milestone tile (S10): server-computed first PR in a repo, largest PR, streak, achievement. */
export function CareerMilestone({ milestone }: { milestone: Milestone }) {
  const Icon = ICON[milestone.kind];
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md border bg-surface px-3 py-2 print:border-black">
      <Icon
        className="mt-0.5 size-4 shrink-0 text-muted-foreground print:text-black"
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{milestone.title}</span>
        {milestone.refs.length ? (
          <span className="truncate font-mono text-caption text-subtle-foreground print:text-black">
            {milestone.refs.map(displayRef).join(', ')}
          </span>
        ) : null}
      </span>
    </div>
  );
}
