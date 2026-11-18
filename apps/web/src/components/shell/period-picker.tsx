'use client';

import { Calendar, Check, ChevronDown } from 'lucide-react';
import { DateRangePicker } from '@/components/date-range-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useMediaQuery } from '@/hooks/use-media-query';
import { periodPresets, shortPeriodLabel, usePeriod } from '@/lib/period';
import { cn } from '@/lib/utils';

import { useShell } from './shell-context';

/**
 * Global period picker (IA §4, SCREENS O2): presets with a check for the current one, a custom
 * range (7–366 days, applied with a button) and the shareable URL form. Popover on ≥ 768 px,
 * bottom sheet with 48 px rows on phones.
 */
export function PeriodPicker() {
  const period = usePeriod();
  const { periodOpen, setPeriodOpen } = useShell();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (!period.resolved && !period.invalid) {
    return <Skeleton className="h-7 w-28" aria-label="Loading period" />;
  }

  const label = period.resolved?.label ?? 'Choose period';
  const trigger = (
    <Button
      variant="secondary"
      size="sm"
      aria-haspopup="dialog"
      aria-expanded={periodOpen}
      data-testid="period-picker"
      onClick={() => {
        setPeriodOpen(!periodOpen);
      }}
    >
      <Calendar aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">
        {period.resolved ? shortPeriodLabel(period.resolved) : 'Period'}
      </span>
      {period.resolved?.inProgress ? (
        <Badge variant="neutral" className="hidden h-[18px] sm:inline-flex">
          In progress
        </Badge>
      ) : null}
      <ChevronDown aria-hidden="true" />
    </Button>
  );

  const body = (
    <PeriodOptions
      current={period.resolved?.spec ?? null}
      today={period.today}
      onSelect={(spec) => {
        period.setPeriod(spec);
        setPeriodOpen(false);
      }}
    />
  );

  if (isDesktop) {
    return (
      <Popover open={periodOpen} onOpenChange={setPeriodOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-1" aria-label="Choose period">
          {body}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <>
      {trigger}
      <Sheet open={periodOpen} onOpenChange={setPeriodOpen}>
        <SheetContent side="bottom" className="pb-safe max-h-[85dvh] overflow-y-auto rounded-t-lg">
          <SheetHeader className="pb-0">
            <SheetTitle>Choose period</SheetTitle>
            <SheetDescription>Applies to Dashboard, Activity and KPIs.</SheetDescription>
          </SheetHeader>
          <div className="px-2 pb-4">{body}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function PeriodOptions({
  current,
  today,
  onSelect,
}: {
  current: string | null;
  today: string | null;
  onSelect: (spec: string) => void;
}) {
  const presets = today ? periodPresets(today) : [];
  const custom = current?.startsWith('custom:') ? current.slice(7).split('..') : null;

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {presets.map((preset) => {
          const selected = preset.spec === current;
          return (
            <li key={preset.spec}>
              <button
                type="button"
                aria-pressed={selected}
                className={cn(
                  'flex h-12 w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 text-left text-base hover:bg-surface-2 md:h-8',
                  selected && 'font-medium',
                )}
                onClick={() => {
                  onSelect(preset.spec);
                }}
              >
                <span className="flex-1">{preset.label}</span>
                <span className="text-caption text-subtle-foreground">
                  {labelFor(preset.spec, today)}
                </span>
                <Check
                  className={cn('size-4 text-primary', selected ? 'visible' : 'invisible')}
                  aria-hidden="true"
                />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="my-1 h-px bg-border" role="separator" />
      <div className="flex flex-col gap-2 px-2.5 py-2">
        <p className="text-caption font-medium text-muted-foreground">Custom range (7–366 days)</p>
        {today ? (
          <DateRangePicker
            today={today}
            value={custom ? { from: custom[0] ?? '', to: custom[1] ?? today } : null}
            onApply={(_range, spec) => {
              onSelect(spec);
            }}
          />
        ) : null}
      </div>
      <div className="my-1 h-px bg-border" role="separator" />
      <p className="px-2.5 py-1.5 text-caption text-subtle-foreground">
        Shareable URL: <span className="font-mono break-all">?period={current ?? 'default'}</span>
      </p>
    </div>
  );
}

function labelFor(spec: string, today: string | null): string {
  if (!today) return '';
  const [type, value] = spec.split(':');
  if (type === 'month' && value) {
    const [y, m] = value.split('-');
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${months[Number(m) - 1] ?? ''} ${y ?? ''}`;
  }
  if (type === 'quarter' || type === 'half')
    return value?.replace(/^(\d{4})-(\w+)$/, '$2 $1') ?? '';
  return value ?? '';
}
