'use client';

import {
  IMPLEMENTED_METRIC_KEYS,
  METRIC_CATALOGUE,
  metricMeta,
  todayIn,
  type GoalDto,
  type ImplementedMetricKey,
} from '@devimpact/shared';
import { CircleAlert } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';

import { SHEET_ON_MOBILE } from '@/components/career/achievement-dialog';
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
import { fromDisplayValue, toDisplayValue, unitSuffix } from '@/lib/achievements';
import { useSaveGoal } from '@/lib/api/career-hooks';
import { errorMessage } from '@/lib/api/errors';
import { useMe } from '@/lib/api/hooks';

const NO_METRIC = 'none';
/** Metrics a goal can target: scored metrics and every non-count metric (as in the prototype). */
export const GOAL_METRICS = METRIC_CATALOGUE.filter(
  (m) =>
    !m.deferred &&
    (IMPLEMENTED_METRIC_KEYS as readonly string[]).includes(m.key) &&
    (m.unit !== 'count' || m.inScore),
);

const UNIT_ERROR: Record<string, string> = {
  hours: 'Enter a number of hours',
  ratio: 'Enter a percentage between 0 and 100',
};

/** Add / edit goal (S18, FLOWS F8): goal, optional metric + comparator + unit-aware value, date. */
export function GoalDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: GoalDto;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-lg ${SHEET_ON_MOBILE}`} data-testid="goal-dialog">
        {open ? (
          <GoalForm
            key={editing?.id ?? 'new'}
            editing={editing}
            onDone={() => {
              onOpenChange(false);
            }}
          />
        ) : (
          <DialogTitle className="sr-only">Add goal</DialogTitle>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GoalForm({ editing, onDone }: { editing?: GoalDto; onDone: () => void }) {
  const me = useMe();
  const today = todayIn(me.data?.settings.timezone ?? 'UTC');
  const save = useSaveGoal();
  const ids = { title: useId(), metric: useId(), cmp: useId(), value: useId(), date: useId() };
  const titleRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const target = editing?.metricTarget ?? null;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [metric, setMetric] = useState<string>(target?.metricKey ?? NO_METRIC);
  const [cmp, setCmp] = useState<'lte' | 'gte'>(target?.comparator ?? 'lte');
  const [value, setValue] = useState(
    target ? String(toDisplayValue(metricMeta(target.metricKey).unit, target.targetValue)) : '',
  );
  const [targetDate, setTargetDate] = useState(editing?.targetDate ?? `${today.slice(0, 4)}-12-31`);
  const [errors, setErrors] = useState<Partial<Record<'title' | 'value' | 'date', string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const unit = metric === NO_METRIC ? null : metricMeta(metric as ImplementedMetricKey).unit;

  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!title.trim()) next.title = 'Describe the goal in a few words';
    let numeric: number | null = null;
    if (unit) {
      numeric = Number(value.replace(',', '.'));
      if (!value.trim() || !Number.isFinite(numeric) || numeric < 0) {
        next.value = UNIT_ERROR[unit] ?? 'Enter a number';
      } else if (unit === 'ratio' && numeric > 100) {
        next.value = UNIT_ERROR.ratio;
      }
    }
    const startDate = editing?.startDate ?? today;
    if (targetDate && targetDate < startDate) next.date = 'Choose a date after the goal starts';
    setErrors(next);
    if (next.title) titleRef.current?.focus();
    else if (next.value) valueRef.current?.focus();
    if (Object.keys(next).length) return;
    setSaveError(null);
    const body = {
      title: title.trim(),
      ...(editing ? {} : { startDate }),
      targetDate: targetDate || null,
      metricTarget:
        unit && numeric !== null
          ? {
              metricKey: metric as ImplementedMetricKey,
              comparator: cmp,
              targetValue: fromDisplayValue(unit, numeric),
            }
          : null,
    };
    save.mutate(
      { id: editing?.id, body },
      {
        onSuccess: () => {
          toast.success(editing ? 'Goal updated' : 'Goal added');
          onDone();
        },
        onError: (e) => {
          setSaveError(`Couldn't save the goal. ${errorMessage(e, 'the goal')}`);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit goal' : 'Add goal'}</DialogTitle>
        <DialogDescription>
          Progress is checked against your most recent complete month.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.title}>Goal</Label>
        <Input
          id={ids.title}
          ref={titleRef}
          value={title}
          maxLength={200}
          placeholder="e.g. Review teammates' PRs within a day"
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? `${ids.title}-err` : undefined}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        {errors.title ? <Err id={`${ids.title}-err`}>{errors.title}</Err> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.metric}>
          Measure with a metric{' '}
          <span className="font-normal text-subtle-foreground">(optional)</span>
        </Label>
        <Select value={metric} onValueChange={setMetric}>
          <SelectTrigger id={ids.metric} className="w-full" aria-describedby={`${ids.metric}-help`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_METRIC}>No metric — track with achievements</SelectItem>
            {GOAL_METRICS.map((m) => (
              <SelectItem key={m.key} value={m.key}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id={`${ids.metric}-help`} className="text-caption text-subtle-foreground">
          {unit
            ? metricMeta(metric as ImplementedMetricKey).definition
            : 'Link achievements to the goal from its card.'}
        </p>
      </div>
      {unit ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.cmp}>Target</Label>
            <Select
              value={cmp}
              onValueChange={(v) => {
                setCmp(v === 'gte' ? 'gte' : 'lte');
              }}
            >
              <SelectTrigger id={ids.cmp} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lte">At most</SelectItem>
                <SelectItem value="gte">At least</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.value}>
              Value{unitSuffix(unit) ? ` (${unitSuffix(unit) === 'h' ? 'hours' : 'percent'})` : ''}
            </Label>
            <Input
              id={ids.value}
              ref={valueRef}
              inputMode="decimal"
              placeholder={unit === 'hours' ? '8' : unit === 'ratio' ? '75' : '4'}
              value={value}
              aria-invalid={errors.value ? true : undefined}
              aria-describedby={errors.value ? `${ids.value}-err` : undefined}
              onChange={(e) => {
                setValue(e.target.value);
              }}
            />
            {errors.value ? <Err id={`${ids.value}-err`}>{errors.value}</Err> : null}
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.date}>Target date</Label>
        <Input
          id={ids.date}
          type="date"
          value={targetDate}
          aria-invalid={errors.date ? true : undefined}
          aria-describedby={errors.date ? `${ids.date}-err` : undefined}
          onChange={(e) => {
            setTargetDate(e.target.value);
          }}
        />
        {errors.date ? <Err id={`${ids.date}-err`}>{errors.date}</Err> : null}
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
          {editing ? 'Save changes' : 'Add goal'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Err({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="flex items-center gap-1 text-caption text-destructive">
      <CircleAlert className="size-3.5" aria-hidden="true" />
      {children}
    </p>
  );
}
