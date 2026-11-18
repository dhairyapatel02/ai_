'use client';

import { useId, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { customRangeSpec } from '@/lib/period';
import { cn } from '@/lib/utils';

export interface DateRange {
  from: string;
  to: string;
}

/**
 * Custom date range (missing in v1; DESIGN_SYSTEM §5.1 "native date inputs acceptable"): two
 * labelled date inputs, 7–366 days, start not in the future, inline error linked by
 * `aria-describedby`, applied with a button — never on change (IA §4).
 */
export function DateRangePicker({
  value,
  today,
  onApply,
  applyLabel = 'Apply range',
  className,
}: {
  value?: DateRange | null;
  /** The user's local today (`YYYY-MM-DD`). */
  today: string;
  onApply: (range: DateRange, spec: string) => void;
  applyLabel?: string;
  className?: string;
}) {
  const fromId = useId();
  const toId = useId();
  const errorId = useId();
  const [from, setFrom] = useState(value?.from ?? '');
  const [to, setTo] = useState(value?.to ?? today);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = customRangeSpec(from, to, today);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError(null);
    onApply({ from, to }, result.spec);
  };

  const invalid = error ? { 'aria-invalid': true, 'aria-describedby': errorId } : {};
  return (
    <form className={cn('flex flex-col gap-2', className)} onSubmit={submit} noValidate>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={fromId} className="text-caption text-subtle-foreground">
            From
          </Label>
          <Input
            id={fromId}
            type="date"
            value={from}
            max={today}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
            {...invalid}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={toId} className="text-caption text-subtle-foreground">
            To
          </Label>
          <Input
            id={toId}
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
            {...invalid}
          />
        </div>
      </div>
      {error ? (
        <p id={errorId} className="text-caption text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="sm" variant="secondary" className="self-start">
        {applyLabel}
      </Button>
    </form>
  );
}
