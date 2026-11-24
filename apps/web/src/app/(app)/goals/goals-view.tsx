'use client';

import {
  metricMeta,
  periodSpecContaining,
  resolvePeriod,
  shiftPeriodSpec,
  todayIn,
  type GoalDto,
} from '@devimpact/shared';
import { CircleCheck, CircleDot, Link2, MoreHorizontal, Plus, Target } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { GoalDialog } from '@/components/career/goal-dialog';
import { useShell } from '@/components/shell/shell-context';
import {
  CardSkeleton,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
} from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useHydrated } from '@/hooks/use-hydrated';
import {
  CATEGORY_LABEL,
  GOAL_STATUS_LABEL,
  formatTarget,
  goalProgressPct,
} from '@/lib/achievements';
import {
  useAchievements,
  useDeleteGoal,
  useGoal,
  useGoals,
  useSaveGoal,
} from '@/lib/api/career-hooks';
import { errorMessage } from '@/lib/api/errors';
import { useMe } from '@/lib/api/hooks';
import { formatLocalDate, plural } from '@/lib/format';
import { useSearchParamsState } from '@/lib/url-state';

const STATUS_VARIANT = {
  met: 'success',
  not_met: 'warning',
  no_data: 'neutral',
  no_metric: 'outline',
} as const;

function StatusBadge({ goal }: { goal: GoalDto }) {
  if (goal.status !== 'active') {
    return (
      <Badge variant={goal.status === 'achieved' ? 'success' : 'neutral'}>
        {goal.status === 'achieved' ? 'Achieved' : goal.status === 'missed' ? 'Missed' : 'Archived'}
      </Badge>
    );
  }
  const s = goal.progress.status;
  return (
    <Badge variant={STATUS_VARIANT[s]}>
      {s === 'met' ? (
        <CircleCheck aria-hidden="true" />
      ) : s === 'not_met' ? (
        <CircleDot aria-hidden="true" />
      ) : null}
      {GOAL_STATUS_LABEL[s]}
    </Badge>
  );
}

function targetText(goal: GoalDto): string {
  const t = goal.metricTarget;
  if (!t) return plural(goal.achievementIds.length, 'linked achievement');
  const meta = metricMeta(t.metricKey);
  return `${meta.label} ${t.comparator === 'lte' ? '≤' : '≥'} ${formatTarget(meta.unit, t.targetValue)}`;
}

/**
 * Goals (S18, F-62): cards with status badge (icon + text), target, current engine value for the
 * evaluated month, progress bar and dates; card menu Edit / Mark achieved / Archive / Delete; a
 * detail sheet (`?goal=`) with linked achievements. Progress comes from the metrics engine.
 */
export function GoalsView() {
  const shell = useShell();
  const url = useSearchParamsState();
  const me = useMe();
  const goals = useGoals();
  const save = useSaveGoal();
  const remove = useDeleteGoal();
  const [editing, setEditing] = useState<GoalDto | null>(null);
  const [deleting, setDeleting] = useState<GoalDto | null>(null);
  const tz = me.data?.settings.timezone ?? 'UTC';
  const today = todayIn(tz);
  const evaluated = resolvePeriod(
    shiftPeriodSpec(periodSpecContaining('month', today), -1),
    tz,
    today,
  );
  const items = goals.data?.items ?? [];
  const add = (
    <Button
      onClick={() => {
        shell.setGoalDialogOpen(true);
      }}
    >
      <Plus aria-hidden="true" />
      Add goal
    </Button>
  );
  const setStatus = (g: GoalDto, status: GoalDto['status'], done: string) => {
    save.mutate(
      { id: g.id, body: { status } },
      {
        onSuccess: () => toast.success(done),
        onError: (e) => toast.error(errorMessage(e, 'the goal')),
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Goals"
        lede={`Progress is measured on ${evaluated.label}, your most recent complete month.`}
        actions={add}
      />
      {goals.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : goals.isError ? (
        <div className="rounded-md border bg-card">
          <ErrorState error={goals.error} what="your goals" onRetry={() => void goals.refetch()} />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border bg-card">
          <EmptyState
            icon={Target}
            title="Set a goal you can measure"
            description="For example, review teammates' PRs within a day. Goals without a metric are tracked with achievements."
            actions={add}
          />
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="goal-list">
          {items.map((g) => (
            <li
              key={g.id}
              className="flex flex-col gap-3 rounded-md border bg-card p-4"
              data-testid="goal-card"
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer text-left font-semibold hover:underline"
                  onClick={() => {
                    url.set({ goal: g.id });
                  }}
                >
                  {g.title}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Options for ${g.title}`}>
                      <MoreHorizontal aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        setEditing(g);
                      }}
                    >
                      Edit
                    </DropdownMenuItem>
                    {g.status !== 'achieved' ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          setStatus(g, 'achieved', 'Marked as achieved');
                        }}
                      >
                        Mark achieved
                      </DropdownMenuItem>
                    ) : null}
                    {g.status !== 'archived' ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          setStatus(g, 'archived', 'Goal archived');
                        }}
                      >
                        Archive
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onSelect={() => {
                          setStatus(g, 'active', 'Goal restored');
                        }}
                      >
                        Restore
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        setDeleting(g);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="self-start">
                <StatusBadge goal={g} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-muted-foreground">{targetText(g)}</span>
                {g.metricTarget ? (
                  <span className="text-lg font-semibold tabular-nums">
                    {g.progress.current === null
                      ? '—'
                      : formatTarget(
                          metricMeta(g.metricTarget.metricKey).unit,
                          g.progress.current,
                        )}{' '}
                    <span className="text-caption font-normal text-subtle-foreground">
                      {g.progress.status === 'no_data' && g.progress.evaluatedPeriod
                        ? `Not enough data in ${g.progress.evaluatedPeriod.label}`
                        : g.progress.evaluatedPeriod?.inProgress
                          ? 'so far this month'
                          : 'now'}
                    </span>
                  </span>
                ) : null}
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-surface-2"
                role="progressbar"
                aria-label={`Progress towards ${g.title}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={goalProgressPct(g)}
              >
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${goalProgressPct(g)}%` }}
                />
              </div>
              <span className="text-caption text-subtle-foreground">
                {formatLocalDate(g.startDate, { withYear: false })}
                {g.targetDate
                  ? ` – ${formatLocalDate(g.targetDate, { withYear: true })}`
                  : ' · no target date'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <GoalDialog
        open={editing !== null}
        editing={editing ?? undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete “${deleting?.title ?? ''}”?`}
        description="The goal is deleted. Linked achievements are kept. This can't be undone."
        confirmLabel="Delete goal"
        destructive
        onConfirm={() => {
          const g = deleting;
          if (!g) return;
          remove.mutate(g.id, {
            onSuccess: () => {
              toast.success(`Deleted “${g.title}”`);
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e, 'the goal')),
          });
        }}
      />
      <GoalSheet
        id={url.get('goal')}
        onClose={() => {
          url.set({ goal: null });
        }}
      />
    </>
  );
}

/** Goal detail (S18): progress, target and linked achievements (link / unlink). */
function GoalSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const hydrated = useHydrated();
  const goal = useGoal(id);
  const save = useSaveGoal();
  const [linking, setLinking] = useState(false);
  const all = useAchievements({}, { enabled: linking });
  const g = goal.data;
  const linkedIds = new Set(g?.achievementIds ?? []);
  const setLinks = (ids: string[]) => {
    if (!g) return;
    save.mutate(
      { id: g.id, body: { achievementIds: ids } },
      {
        onSuccess: () => void goal.refetch(),
        onError: (e) => toast.error(errorMessage(e, 'the goal')),
      },
    );
  };
  return (
    <Sheet
      open={hydrated && id !== null}
      onOpenChange={(open) => {
        if (!open) {
          setLinking(false);
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md" data-testid="goal-sheet">
        {goal.isPending ? (
          <>
            <SheetHeader>
              <SheetTitle>Goal</SheetTitle>
              <SheetDescription className="sr-only">Loading</SheetDescription>
            </SheetHeader>
            <div className="p-4">
              <Skeleton className="h-24 w-full" />
            </div>
          </>
        ) : goal.isError || !g ? (
          <>
            <SheetHeader>
              <SheetTitle>Goal</SheetTitle>
              <SheetDescription className="sr-only">Error</SheetDescription>
            </SheetHeader>
            <ErrorState error={goal.error} what="this goal" onRetry={() => void goal.refetch()} />
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetDescription>Goal · {targetText(g)}</SheetDescription>
              <SheetTitle className="pr-8 text-lg">{g.title}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className="self-start">
                <StatusBadge goal={g} />
              </div>
              {g.description ? <p className="text-muted-foreground">{g.description}</p> : null}
              {g.progress.evaluatedPeriod ? (
                <p className="text-sm text-muted-foreground">
                  Evaluated on {g.progress.evaluatedPeriod.label}
                  {g.progress.current !== null && g.metricTarget
                    ? `: ${formatTarget(metricMeta(g.metricTarget.metricKey).unit, g.progress.current)}`
                    : ''}
                  . Numbers come from the metrics engine.
                </p>
              ) : null}
              <section className="flex flex-col gap-2" aria-labelledby="goal-ach-title">
                <h3 id="goal-ach-title" className="font-medium">
                  Linked achievements
                </h3>
                {g.achievements.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None linked yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {g.achievements.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{a.title}</span>
                        <Badge variant="outline">{CATEGORY_LABEL[a.category]}</Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Unlink ${a.title}`}
                          onClick={() => {
                            setLinks(g.achievementIds.filter((x) => x !== a.id));
                          }}
                        >
                          Unlink
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  className="self-start"
                  aria-expanded={linking}
                  onClick={() => {
                    setLinking((v) => !v);
                  }}
                >
                  <Link2 aria-hidden="true" />
                  Link achievements
                </Button>
                {linking ? (
                  all.isPending ? (
                    <Skeleton className="h-16 w-full" />
                  ) : (
                    <ul className="flex max-h-60 flex-col overflow-y-auto rounded-md border p-1">
                      {(all.data?.pages.flatMap((p) => p.items) ?? []).map((a) => (
                        <li key={a.id}>
                          <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-sm px-2 hover:bg-surface-2">
                            <input
                              type="checkbox"
                              className="size-4 accent-(--primary)"
                              checked={linkedIds.has(a.id)}
                              onChange={() => {
                                setLinks(
                                  linkedIds.has(a.id)
                                    ? g.achievementIds.filter((x) => x !== a.id)
                                    : [...g.achievementIds, a.id],
                                );
                              }}
                            />
                            <span className="min-w-0 flex-1 truncate text-sm">{a.title}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
