'use client';

import { todayIn, type AchievementCategoryWire, type AchievementDto } from '@devimpact/shared';
import { CircleAlert, Link2, Plus, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  ACHIEVEMENT_CATEGORIES,
  CATEGORY_LABEL,
  linkedFromEvidence,
  shortRef,
  type AchievementPrefill,
  type LinkedEvidence,
} from '@/lib/achievements';
import { useSaveAchievement } from '@/lib/api/career-hooks';
import { useDebouncedValue } from '@/lib/api/document-hooks';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { useMe } from '@/lib/api/hooks';
import { useActivityFeed } from '@/lib/api/metrics-hooks';

/** Bottom sheet on phones (S17 "M dialog = bottom sheet"), centered dialog from 640 px. */
export const SHEET_ON_MOBILE =
  'max-h-[92dvh] overflow-y-auto max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none';

type FieldErrors = Partial<Record<'title' | 'occurredOn' | 'links', string>>;
interface LinkRow {
  url: string;
  label: string;
}

const isHttpUrl = (value: string) => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

/**
 * Add / edit achievement (S17, FLOWS F7): title (required, 200), category, date (≤ today in the
 * user's time zone), impact (optional, 1,000), links (≤ 10) and linked evidence (your PRs,
 * reviews and commits). Pre-filled when it comes from "Turn into achievement" (S7). Field errors
 * appear on submit and focus the first invalid field; a save error stays above the footer with
 * every value kept.
 */
export function AchievementDialog({
  open,
  onOpenChange,
  prefill,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: AchievementPrefill;
  editing?: AchievementDto;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-xl ${SHEET_ON_MOBILE}`} data-testid="achievement-dialog">
        {open ? (
          <AchievementForm
            key={editing?.id ?? prefill?.draftedFrom ?? 'new'}
            prefill={prefill}
            editing={editing}
            onDone={() => {
              onOpenChange(false);
            }}
          />
        ) : (
          <DialogTitle className="sr-only">Add achievement</DialogTitle>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AchievementForm({
  prefill,
  editing,
  onDone,
}: {
  prefill?: AchievementPrefill;
  editing?: AchievementDto;
  onDone: () => void;
}) {
  const router = useRouter();
  const me = useMe();
  const today = todayIn(me.data?.settings.timezone ?? 'UTC');
  const save = useSaveAchievement();
  const ids = { title: useId(), category: useId(), date: useId(), impact: useId(), links: useId() };
  const titleRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(editing?.title ?? prefill?.title ?? '');
  const [category, setCategory] = useState<AchievementCategoryWire>(
    editing?.category ?? prefill?.category ?? 'delivery',
  );
  const [occurredOn, setOccurredOn] = useState(editing?.occurredOn ?? prefill?.occurredOn ?? today);
  const [impact, setImpact] = useState(editing?.impact ?? prefill?.impact ?? '');
  const [links, setLinks] = useState<LinkRow[]>(
    (editing?.links ?? []).map((l) => ({ url: l.url, label: l.label ?? '' })),
  );
  const [evidence, setEvidence] = useState<LinkedEvidence[]>(
    editing ? linkedFromEvidence(editing.evidence) : (prefill?.evidence ?? []),
  );
  const [picking, setPicking] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const next: FieldErrors = {};
    if (!title.trim()) next.title = 'Add a short title';
    else if (title.trim().length > 200) next.title = 'Use 200 characters or fewer';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) next.occurredOn = 'Choose a date';
    else if (occurredOn > today) next.occurredOn = "Choose a date that isn't in the future";
    const filled = links.filter((l) => l.url.trim());
    if (filled.some((l) => !isHttpUrl(l.url.trim())))
      next.links = 'Enter links that start with https://';
    setErrors(next);
    if (next.title) titleRef.current?.focus();
    else if (next.occurredOn) dateRef.current?.focus();
    else if (next.links) document.getElementById(`${ids.links}-0`)?.focus();
    if (Object.keys(next).length) return;

    setSaveError(null);
    const body = {
      title: title.trim(),
      category,
      occurredOn,
      impact: impact.trim() || null,
      links: filled.map((l) => ({
        url: l.url.trim(),
        ...(l.label.trim() ? { label: l.label.trim() } : {}),
      })),
      evidence: evidence.map((e) => ({ kind: e.kind, id: e.id })),
      ...(editing ? {} : { source: prefill?.source ?? 'manual' }),
    };
    save.mutate(
      { id: editing?.id, body },
      {
        onSuccess: () => {
          toast.success(editing ? 'Achievement updated' : 'Achievement saved', {
            action: {
              label: 'View',
              onClick: () => {
                router.push('/achievements');
              },
            },
          });
          onDone();
        },
        onError: (e) => {
          setSaveError(
            isApiError(e) && e.code === 'NOT_FOUND'
              ? 'Some linked evidence no longer exists. Remove it and try again.'
              : `Couldn't save the achievement. ${errorMessage(e, 'the achievement')}`,
          );
        },
      },
    );
  };

  const heading = editing
    ? 'Edit achievement'
    : prefill?.draftedFrom
      ? 'Review achievement'
      : 'Add achievement';
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{heading}</DialogTitle>
        {prefill?.draftedFrom && !editing ? (
          <DialogDescription>
            Drafted by AI from <span className="font-mono">{prefill.draftedFrom}</span>. Edit
            anything before saving.
          </DialogDescription>
        ) : (
          <DialogDescription>
            Work GitHub can&apos;t see counts too. Achievements appear in Career and can be cited in
            documents.
          </DialogDescription>
        )}
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.title}>Title</Label>
        <Input
          id={ids.title}
          ref={titleRef}
          value={title}
          maxLength={200}
          placeholder="e.g. Led the checkout incident response"
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? `${ids.title}-err` : undefined}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        {errors.title ? <FieldError id={`${ids.title}-err`}>{errors.title}</FieldError> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.category}>Category</Label>
          <Select
            value={category}
            onValueChange={(v) => {
              setCategory(v as AchievementCategoryWire);
            }}
          >
            <SelectTrigger id={ids.category} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACHIEVEMENT_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.date}>Date</Label>
          <Input
            id={ids.date}
            ref={dateRef}
            type="date"
            value={occurredOn}
            max={today}
            aria-invalid={errors.occurredOn ? true : undefined}
            aria-describedby={errors.occurredOn ? `${ids.date}-err` : undefined}
            onChange={(e) => {
              setOccurredOn(e.target.value);
            }}
          />
          {errors.occurredOn ? (
            <FieldError id={`${ids.date}-err`}>{errors.occurredOn}</FieldError>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.impact}>
          Impact <span className="font-normal text-subtle-foreground">(optional)</span>
        </Label>
        <Textarea
          id={ids.impact}
          value={impact}
          maxLength={1000}
          className="min-h-18"
          placeholder="What changed because of this? Numbers help."
          onChange={(e) => {
            setImpact(e.target.value);
          }}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-base font-medium">
          Links <span className="font-normal text-subtle-foreground">(optional)</span>
        </legend>
        {links.map((link, i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
          >
            <Input
              id={`${ids.links}-${i}`}
              aria-label={`Link ${i + 1} URL`}
              placeholder="https://"
              inputMode="url"
              value={link.url}
              aria-invalid={errors.links && link.url && !isHttpUrl(link.url) ? true : undefined}
              onChange={(e) => {
                setLinks((rows) =>
                  rows.map((r, j) => (j === i ? { ...r, url: e.target.value } : r)),
                );
              }}
            />
            <Input
              aria-label={`Link ${i + 1} label`}
              placeholder="Label"
              maxLength={100}
              className="max-sm:col-start-1 max-sm:row-start-2"
              value={link.label}
              onChange={(e) => {
                setLinks((rows) =>
                  rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)),
                );
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove link ${i + 1}`}
              onClick={() => {
                setLinks((rows) => rows.filter((_, j) => j !== i));
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        ))}
        {errors.links ? <FieldError id={`${ids.links}-err`}>{errors.links}</FieldError> : null}
        {links.length < 10 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => {
              setLinks((rows) => [...rows, { url: '', label: '' }]);
            }}
          >
            <Plus aria-hidden="true" />
            Add a link
          </Button>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-2">
        <span className="text-base font-medium" id={`${ids.links}-evidence`}>
          Linked evidence
        </span>
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-labelledby={`${ids.links}-evidence`}
        >
          {evidence.length === 0 ? (
            <span className="text-sm text-muted-foreground">None yet.</span>
          ) : null}
          {evidence.map((e) => (
            <Badge key={`${e.kind}:${e.id}`} variant="outline" className="gap-1 font-mono">
              {shortRef(e.ref)}
              <button
                type="button"
                className="-mr-1 inline-flex size-5 cursor-pointer items-center justify-center rounded-xs hover:bg-surface-2"
                aria-label={`Unlink ${e.ref}`}
                onClick={() => {
                  setEvidence((list) => list.filter((x) => !(x.kind === e.kind && x.id === e.id)));
                }}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={picking}
            onClick={() => {
              setPicking((v) => !v);
            }}
          >
            <Link2 aria-hidden="true" />
            Link PRs or reviews
          </Button>
        </div>
        {picking ? (
          <EvidencePicker
            selected={evidence}
            onToggle={(item) => {
              setEvidence((list) =>
                list.some((x) => x.kind === item.kind && x.id === item.id)
                  ? list.filter((x) => !(x.kind === item.kind && x.id === item.id))
                  : list.length >= 50
                    ? list
                    : [...list, item],
              );
            }}
          />
        ) : null}
      </div>

      {saveError ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {saveError}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {editing ? 'Save changes' : 'Save achievement'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="flex items-center gap-1 text-caption text-destructive">
      <CircleAlert className="size-3.5" aria-hidden="true" />
      {children}
    </p>
  );
}

/** Search your merged PRs, reviews and commits (`GET /activity/feed?q=&types=`). */
function EvidencePicker({
  selected,
  onToggle,
}: {
  selected: LinkedEvidence[];
  onToggle: (item: LinkedEvidence) => void;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const query = useDebouncedValue(q.trim(), 300);
  const feed = useActivityFeed({
    types: ['pr_merged', 'review', 'commit'],
    q: query || undefined,
    limit: 8,
  });
  const items = (feed.data?.pages[0]?.items ?? []).flatMap((i): LinkedEvidence[] => {
    const recordId = typeof i.meta.recordId === 'string' ? i.meta.recordId : null;
    if (!recordId) return [];
    const kind = i.type === 'review' ? 'review' : i.type === 'commit' ? 'commit' : 'pull_request';
    return [{ kind, id: recordId, ref: i.ref, title: i.title }];
  });
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2" data-testid="evidence-picker">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle-foreground"
          aria-hidden="true"
        />
        <Input
          id={id}
          aria-label="Search your pull requests, reviews and commits"
          placeholder="Search titles or refs"
          className="pl-8"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
          }}
        />
      </div>
      {feed.isPending ? (
        <p className="px-1 text-sm text-muted-foreground">Searching…</p>
      ) : feed.isError ? (
        <p className="px-1 text-sm text-destructive">Couldn&apos;t search your activity.</p>
      ) : items.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">
          No matching pull requests, reviews or commits.
        </p>
      ) : (
        <ul className="flex max-h-48 flex-col overflow-y-auto">
          {items.map((item) => {
            const checked = selected.some((x) => x.kind === item.kind && x.id === item.id);
            return (
              <li key={`${item.kind}:${item.id}`}>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-sm px-1 py-1 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-(--primary)"
                    checked={checked}
                    onChange={() => {
                      onToggle(item);
                    }}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{item.title}</span>
                    <span className="truncate font-mono text-caption text-subtle-foreground">
                      {item.ref}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
