'use client';

import { addDays, periodSpecContaining, todayIn, type AchievementDto } from '@devimpact/shared';
import { Award, ExternalLink, MoreHorizontal, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { AchievementDialog } from '@/components/career/achievement-dialog';
import { EvidenceChip } from '@/components/evidence-chip';
import { ItemDrawer } from '@/components/item-drawer';
import { useShell } from '@/components/shell/shell-context';
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ACHIEVEMENT_CATEGORIES,
  CATEGORY_LABEL,
  groupByMonth,
  parseCategory,
} from '@/lib/achievements';
import { useAchievements, useDeleteAchievement } from '@/lib/api/career-hooks';
import { errorMessage } from '@/lib/api/errors';
import { useMe } from '@/lib/api/hooks';
import { formatLocalDate, plural } from '@/lib/format';
import { useSearchParamsState } from '@/lib/url-state';

const UNDO_MS = 7000;

/** Period filter options (IA §6 `?period=`); "All time" = no param. */
function periodOptions(today: string) {
  return [
    { value: '', label: 'All time' },
    { value: periodSpecContaining('quarter', today), label: 'This quarter' },
    { value: periodSpecContaining('half', today), label: 'This half' },
    { value: periodSpecContaining('year', today), label: 'This year' },
    { value: `custom:${addDays(today, -364)}..${today}`, label: 'Last 12 months' },
  ];
}

/**
 * Achievements journal (S17, F-60/F-61): grouped by month, category chips (`?category=`), period
 * filter (`?period=`), add / edit dialog, delete with a 7 s Undo toast, details in the item
 * drawer (`?item=achievement:<id>`), cursor pages. Works without a GitHub connection.
 */
export function AchievementsView() {
  const url = useSearchParamsState();
  const shell = useShell();
  const me = useMe();
  const today = todayIn(me.data?.settings.timezone ?? 'UTC');
  const category = parseCategory(url.get('category'));
  const period = url.get('period') ?? undefined;
  const list = useAchievements({ category, period });
  const remove = useDeleteAchievement();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, number>());
  const [editing, setEditing] = useState<AchievementDto | null>(null);

  const items = (list.data?.pages.flatMap((p) => p.items) ?? []).filter((a) => !hidden.has(a.id));
  const total = list.data?.pages[0]?.meta.total;
  const filtered = Boolean(category || period);

  const add = (
    <Button
      onClick={() => {
        shell.openAchievement(category ? { category } : undefined);
      }}
    >
      <Plus aria-hidden="true" />
      Add achievement
    </Button>
  );

  const deleteWithUndo = (a: AchievementDto) => {
    setHidden((s) => new Set(s).add(a.id));
    const restore = () => {
      window.clearTimeout(timers.current.get(a.id));
      timers.current.delete(a.id);
      setHidden((s) => {
        const next = new Set(s);
        next.delete(a.id);
        return next;
      });
    };
    timers.current.set(
      a.id,
      window.setTimeout(() => {
        timers.current.delete(a.id);
        remove.mutate(a.id, {
          onError: (e) => {
            restore();
            toast.error(`Couldn't delete “${a.title}”. ${errorMessage(e, 'the achievement')}`);
          },
        });
      }, UNDO_MS),
    );
    toast(`Deleted “${a.title}”`, {
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          restore();
          toast.success('Restored');
        },
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Achievements"
        lede={
          total !== undefined && !filtered && total > 0
            ? `${plural(total, 'achievement')} · cited as evidence in documents and shown in Career`
            : 'Capture wins GitHub can’t see. They appear in Career and can be cited in documents.'
        }
        actions={add}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Category"
          className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          <Chip
            pressed={!category}
            onClick={() => {
              url.set({ category: null }, { replace: true });
            }}
          >
            All
          </Chip>
          {ACHIEVEMENT_CATEGORIES.map((c) => (
            <Chip
              key={c}
              pressed={category === c}
              onClick={() => {
                url.set({ category: c }, { replace: true });
              }}
            >
              {CATEGORY_LABEL[c]}
            </Chip>
          ))}
        </div>
        <Select
          value={period ?? 'all'}
          onValueChange={(v) => {
            url.set({ period: v === 'all' ? null : v }, { replace: true });
          }}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periodOptions(today).map((o) => (
              <SelectItem key={o.label} value={o.value || 'all'}>
                {o.label}
              </SelectItem>
            ))}
            {period && !periodOptions(today).some((o) => o.value === period) ? (
              <SelectItem value={period}>{period}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border bg-card">
        {list.isPending ? (
          <ListSkeleton rows={6} label="Loading your achievements…" />
        ) : list.isError ? (
          <ErrorState
            error={list.error}
            what="your achievements"
            onRetry={() => void list.refetch()}
          />
        ) : items.length === 0 && !filtered ? (
          <EmptyState
            icon={Award}
            title="Capture the work GitHub can't see"
            description="Mentoring, incidents, design docs, talks. Achievements appear in your timeline and can be cited in documents."
            actions={add}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={
              category
                ? `No ${CATEGORY_LABEL[category].toLowerCase()} achievements yet`
                : 'No achievements in this period'
            }
            actions={add}
          />
        ) : (
          <div data-testid="achievement-list">
            {groupByMonth(items).map(([month, group]) => (
              <section key={month} aria-label={month}>
                <h2 className="border-b bg-surface-2/50 px-4 py-2 text-caption font-medium text-subtle-foreground">
                  {month}
                </h2>
                <ul>
                  {group.map((a) => (
                    <AchievementRow
                      key={a.id}
                      achievement={a}
                      onOpen={() => {
                        url.set({ item: `achievement:${a.id}` });
                      }}
                      onEdit={() => {
                        setEditing(a);
                      }}
                      onDelete={() => {
                        deleteWithUndo(a);
                      }}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {list.hasNextPage ? (
              <div className="flex justify-center border-t p-3">
                <Button
                  variant="secondary"
                  loading={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  Show more
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
      <AchievementDialog
        open={editing !== null}
        editing={editing ?? undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <ItemDrawer
        value={url.get('item')}
        timezone={me.data?.settings.timezone}
        onClose={() => {
          url.set({ item: null });
        }}
      />
    </>
  );
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={pressed ? 'default' : 'secondary'}
      aria-pressed={pressed}
      className="h-7 shrink-0 rounded-full px-3"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function AchievementRow({
  achievement: a,
  onOpen,
  onEdit,
  onDelete,
}: {
  achievement: AchievementDto;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      className="flex items-start gap-3 border-b px-4 py-3 last:border-b-0"
      data-testid="achievement-row"
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-subtle-foreground">
        <Award className="size-4" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <button
          type="button"
          className="cursor-pointer text-left font-medium hover:underline"
          onClick={onOpen}
        >
          {a.title}
        </button>
        {a.impact ? <p className="text-sm text-muted-foreground">{a.impact}</p> : null}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{CATEGORY_LABEL[a.category]}</Badge>
          {a.evidence.map((e) => (
            <EvidenceChip key={e.ref} refId={e.ref} evidence={e} />
          ))}
          {a.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-caption text-link underline underline-offset-2"
            >
              {l.label || new URL(l.url).hostname}
              <ExternalLink className="size-3" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ))}
        </div>
      </div>
      <span className="shrink-0 pt-0.5 text-caption text-subtle-foreground tabular-nums">
        {formatLocalDate(a.occurredOn, { currentYear: new Date().getFullYear() })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Options for ${a.title}`}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
