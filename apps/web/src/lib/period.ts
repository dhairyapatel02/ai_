'use client';

import {
  CUSTOM_MAX_DAYS,
  CUSTOM_MIN_DAYS,
  PeriodError,
  periodSpecContaining,
  resolvePeriod,
  shiftPeriodSpec,
  todayIn,
  type PeriodTypeWire,
  type ResolvedPeriod,
} from '@devimpact/shared';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import { useMe } from '@/lib/api/hooks';

export interface PeriodState {
  /** Explicit `?period=` spec, or null when the URL has none (API default = user's default). */
  urlSpec: string | null;
  /** The spec to send to the API (`undefined` = omit the param). */
  apiParam: string | undefined;
  /** Resolved period for labels (null until settings load, or when the URL spec is invalid). */
  resolved: ResolvedPeriod | null;
  /** Message when `?period=` is malformed or out of range (designed INVALID_PERIOD state). */
  invalid: string | null;
  timezone: string | null;
  today: string | null;
  setPeriod: (spec: string | null) => void;
}

/** Presets of the period picker (IA §4), relative to `today` in the user's time zone. */
export function periodPresets(today: string): { label: string; spec: string }[] {
  const types: [PeriodTypeWire, string][] = [
    ['month', 'month'],
    ['quarter', 'quarter'],
    ['half', 'half'],
    ['year', 'year'],
  ];
  return types.flatMap(([type, word]) => {
    const current = periodSpecContaining(type, today);
    return [
      { label: `This ${word}`, spec: current },
      { label: `Last ${word}`, spec: shiftPeriodSpec(current, -1) },
    ];
  });
}

/** Validates a custom range for the picker form; returns the spec or a field error. */
export function customRangeSpec(
  from: string,
  to: string,
  today: string,
): { spec: string } | { error: string } {
  if (!from || !to) return { error: 'Choose a start and an end date.' };
  if (from > today) return { error: "The start date can't be in the future." };
  if (to < from) return { error: 'The end date must be after the start date.' };
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  if (days < CUSTOM_MIN_DAYS) return { error: `Choose at least ${CUSTOM_MIN_DAYS} days.` };
  if (days > CUSTOM_MAX_DAYS) return { error: `Choose at most ${CUSTOM_MAX_DAYS} days.` };
  return { spec: `custom:${from}..${to}` };
}

/** Pure resolver behind `usePeriod` (unit-tested). */
export function resolvePeriodState(
  urlSpec: string | null,
  settings: { timezone: string; defaultPeriodType: PeriodTypeWire } | null,
  now: Date = new Date(),
): Omit<PeriodState, 'setPeriod'> {
  if (!settings) {
    return {
      urlSpec,
      apiParam: urlSpec ?? undefined,
      resolved: null,
      invalid: null,
      timezone: null,
      today: null,
    };
  }
  const today = todayIn(settings.timezone, now);
  const spec = urlSpec ?? periodSpecContaining(settings.defaultPeriodType, today);
  try {
    return {
      urlSpec,
      apiParam: urlSpec ?? undefined,
      resolved: resolvePeriod(spec, settings.timezone, today),
      invalid: null,
      timezone: settings.timezone,
      today,
    };
  } catch (error) {
    const message = error instanceof PeriodError ? error.message : 'Unrecognised period';
    return {
      urlSpec,
      apiParam: undefined,
      resolved: null,
      invalid: message,
      timezone: settings.timezone,
      today,
    };
  }
}

/**
 * Global period (IA §4, ADR-0010): `?period=` in the URL, parsed with the shared period utils;
 * no param = the user's `defaultPeriodType` containing today in their time zone (the URL is not
 * rewritten, so links stay evergreen).
 */
export function usePeriod(): PeriodState {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const urlSpec = searchParams.get('period');
  const settings = me.data?.settings ?? null;

  const state = useMemo(
    () =>
      resolvePeriodState(
        urlSpec,
        settings
          ? { timezone: settings.timezone, defaultPeriodType: settings.defaultPeriodType }
          : null,
      ),
    [urlSpec, settings],
  );

  const setPeriod = useCallback(
    (spec: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (spec) params.set('period', spec);
      else params.delete('period');
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return { ...state, setPeriod };
}

/** Short label for narrow screens: "Nov 2026" for months (never two-digit years, IA §4). */
export function shortPeriodLabel(period: ResolvedPeriod): string {
  if (period.type !== 'month') return period.label;
  const [month, year] = period.label.split(' ');
  return `${(month ?? '').slice(0, 3)} ${year ?? ''}`;
}
