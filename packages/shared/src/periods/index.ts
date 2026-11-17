import { addDays, startOfLocalDay, timeZoneOffsetMs } from '../time/zoned';

/**
 * Period utilities (KPI_METHODOLOGY §2.4–2.5, API_CONTRACT_V2 §3.4, D-019). Shared by the API
 * (metrics engine) and the web app (URL state). A period is an inclusive range of local calendar
 * dates `[startDate, endDate]` in the user's IANA time zone; it maps to the half-open UTC instant
 * range `[start, endExclusive)` (DST-correct). Pure functions only — no I/O, no `Date.now()`
 * unless a caller passes it in.
 */

export const PERIOD_TYPES = ['month', 'quarter', 'half', 'year', 'custom'] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];

export const PERIOD_SPEC_PATTERN =
  /^(month:\d{4}-(0[1-9]|1[0-2])|quarter:\d{4}-Q[1-4]|half:\d{4}-H[12]|year:\d{4}|custom:\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2})$/;

export const CUSTOM_MIN_DAYS = 7;
export const CUSTOM_MAX_DAYS = 366;

/** A grammatically valid spec whose range is invalid (→ `400 INVALID_PERIOD`). */
export class PeriodError extends Error {
  constructor(
    readonly spec: string,
    message: string,
  ) {
    super(message);
    this.name = 'PeriodError';
  }
}

export interface ParsedPeriod {
  type: PeriodType;
  /** First local date (inclusive). */
  startDate: string;
  /** Last local date of the full calendar period (inclusive). */
  endDate: string;
}

export interface ResolvedPeriod {
  spec: string;
  type: PeriodType;
  startDate: string;
  /** Last local date shown: the full end, or "today" for an in-progress period (§2.4). */
  endDate: string;
  timezone: string;
  /** Calendar days of the FULL period (rates are not inflated early in a period, §2.4). */
  periodDays: number;
  inProgress: boolean;
  label: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const ymd = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

function parts(date: string): [number, number, number] {
  return date.split('-').map(Number) as [number, number, number];
}

/** True for a real calendar date `YYYY-MM-DD`. */
export function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = parts(date);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Inclusive number of calendar days from `a` to `b` (`b ≥ a`). */
export function daysInclusive(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000) + 1;
}

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = parts(date);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** ISO-8601 week of a local date (Monday start; week 1 contains the first Thursday). */
export function isoWeek(date: string): { year: number; week: number } {
  const thursday = addDays(date, 4 - isoWeekday(date));
  const [ty] = parts(thursday);
  const week = Math.floor((daysInclusive(ymd(ty, 1, 1), thursday) - 1) / 7) + 1;
  return { year: ty, week };
}

/** Stable key `YYYY-Www` of the ISO week containing `date`. */
export function isoWeekKey(date: string): string {
  const { year, week } = isoWeek(date);
  return `${pad(year, 4)}-W${pad(week)}`;
}

/** Monday of the ISO week containing `date`. */
export function startOfIsoWeek(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** Parses the period grammar (§3.4) into its full calendar range. Throws `PeriodError`. */
export function parsePeriod(spec: string): ParsedPeriod {
  if (!PERIOD_SPEC_PATTERN.test(spec)) throw new PeriodError(spec, 'Unrecognised period');
  const [type, value] = spec.split(':') as [PeriodType, string];
  switch (type) {
    case 'month': {
      const [y, m] = value.split('-').map(Number) as [number, number];
      return { type, startDate: ymd(y, m, 1), endDate: ymd(y, m, lastDayOfMonth(y, m)) };
    }
    case 'quarter': {
      const y = Number(value.slice(0, 4));
      const q = Number(value.slice(6));
      const m = (q - 1) * 3 + 1;
      return { type, startDate: ymd(y, m, 1), endDate: ymd(y, m + 2, lastDayOfMonth(y, m + 2)) };
    }
    case 'half': {
      const y = Number(value.slice(0, 4));
      const h = Number(value.slice(6));
      return h === 1
        ? { type, startDate: ymd(y, 1, 1), endDate: ymd(y, 6, 30) }
        : { type, startDate: ymd(y, 7, 1), endDate: ymd(y, 12, 31) };
    }
    case 'year': {
      const y = Number(value);
      return { type, startDate: ymd(y, 1, 1), endDate: ymd(y, 12, 31) };
    }
    case 'custom': {
      const [startDate, endDate] = value.split('..') as [string, string];
      if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) {
        throw new PeriodError(spec, 'Custom period dates must be real calendar dates');
      }
      if (endDate < startDate) throw new PeriodError(spec, 'Custom period ends before it starts');
      const days = daysInclusive(startDate, endDate);
      if (days < CUSTOM_MIN_DAYS || days > CUSTOM_MAX_DAYS) {
        throw new PeriodError(
          spec,
          `Custom periods must span ${CUSTOM_MIN_DAYS}–${CUSTOM_MAX_DAYS} days (got ${days})`,
        );
      }
      return { type, startDate, endDate };
    }
  }
}

/** Spec of the period of `type` containing local date `date` (custom is not a calendar type). */
export function periodSpecContaining(type: Exclude<PeriodType, 'custom'>, date: string): string {
  const [y, m] = parts(date);
  switch (type) {
    case 'month':
      return `month:${pad(y, 4)}-${pad(m)}`;
    case 'quarter':
      return `quarter:${pad(y, 4)}-Q${Math.floor((m - 1) / 3) + 1}`;
    case 'half':
      return `half:${pad(y, 4)}-H${m <= 6 ? 1 : 2}`;
    case 'year':
      return `year:${pad(y, 4)}`;
  }
}

function shortDate(date: string, withYear: boolean): string {
  const [y, m, d] = parts(date);
  const base = `${(MONTHS[m - 1] ?? '').slice(0, 3)} ${d}`;
  return withYear ? `${base}, ${y}` : base;
}

/** Human label: "November 2026", "Q4 2026", "H2 2026", "2026", "Oct 1 – Nov 15, 2026". */
export function periodLabel(type: PeriodType, startDate: string, endDate: string): string {
  const [y, m] = parts(startDate);
  switch (type) {
    case 'month':
      return `${MONTHS[m - 1] ?? ''} ${y}`;
    case 'quarter':
      return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
    case 'half':
      return `H${m <= 6 ? 1 : 2} ${y}`;
    case 'year':
      return String(y);
    case 'custom': {
      const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
      return `${shortDate(startDate, !sameYear)} – ${shortDate(endDate, true)}`;
    }
  }
}

/**
 * Resolves a spec for a user: `today` is the user's local date (see `localDateOf`). A period that
 * starts after today is invalid; one that contains today is in progress and ends at today for
 * display, while `periodDays` keeps the full calendar length (§2.4).
 */
export function resolvePeriod(spec: string, timezone: string, today: string): ResolvedPeriod {
  const parsed = parsePeriod(spec);
  if (parsed.startDate > today) throw new PeriodError(spec, 'The period starts in the future');
  return toResolved(spec, parsed, timezone, today);
}

function toResolved(
  spec: string,
  parsed: ParsedPeriod,
  timezone: string,
  today: string,
): ResolvedPeriod {
  const inProgress = parsed.endDate >= today;
  return {
    spec,
    type: parsed.type,
    startDate: parsed.startDate,
    endDate: inProgress ? today : parsed.endDate,
    timezone,
    periodDays: daysInclusive(parsed.startDate, parsed.endDate),
    inProgress,
    label: periodLabel(parsed.type, parsed.startDate, parsed.endDate),
  };
}

/** Spec of the period `steps` periods away (negative = earlier) of the same type and length. */
export function shiftPeriodSpec(spec: string, steps: number): string {
  const parsed = parsePeriod(spec);
  const [y, m] = parts(parsed.startDate);
  const monthSpan = { month: 1, quarter: 3, half: 6, year: 12 } as const;
  if (parsed.type === 'custom') {
    const days = daysInclusive(parsed.startDate, parsed.endDate);
    const start = addDays(parsed.startDate, steps * days);
    return `custom:${start}..${addDays(start, days - 1)}`;
  }
  const total = y * 12 + (m - 1) + steps * monthSpan[parsed.type];
  const date = ymd(Math.floor(total / 12), (total % 12) + 1, 1);
  return periodSpecContaining(parsed.type, date);
}

/**
 * The immediately preceding period of the same type and length (§2.4), fully elapsed
 * (`custom` of N days → the N days before `startDate`).
 */
export function previousPeriod(period: ResolvedPeriod): ResolvedPeriod {
  const spec = shiftPeriodSpec(period.spec, -1);
  return toResolved(spec, parsePeriod(spec), period.timezone, '9999-12-31');
}

/**
 * The period to compare with for deltas (§3.7): the full previous period, or — for an in-progress
 * period — the previous period up to the same elapsed day count ("same point last month").
 */
export function comparisonPeriod(period: ResolvedPeriod): {
  period: ResolvedPeriod;
  comparison: 'full' | 'same_elapsed';
} {
  const previous = previousPeriod(period);
  if (!period.inProgress) return { period: previous, comparison: 'full' };
  const elapsed = daysInclusive(period.startDate, period.endDate);
  const fullEnd = parsePeriod(previous.spec).endDate;
  const clipped = addDays(previous.startDate, elapsed - 1);
  return {
    period: { ...previous, endDate: clipped < fullEnd ? clipped : fullEnd },
    comparison: 'same_elapsed',
  };
}

/** `count` consecutive period specs of the same type, oldest first, ending with `spec`. */
export function periodSpecsEnding(spec: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftPeriodSpec(spec, i - (count - 1)));
}

/** Half-open UTC instants of an inclusive local-date range in `timezone`. */
export function localRangeToUtc(
  startDate: string,
  endDate: string,
  timezone: string,
): { start: Date; endExclusive: Date } {
  return {
    start: startOfLocalDay(startDate, timezone),
    endExclusive: startOfLocalDay(addDays(endDate, 1), timezone),
  };
}

// ── Local dates of instants ────────────────────────────────────────────────────────────────

const QUARTER_HOUR = 15 * 60_000;
const offsetCache = new Map<string, Map<number, number>>();

/**
 * Offset of `timeZone` at `ms`, memoised per 15-minute UTC bucket: every IANA transition happens
 * on a quarter-hour boundary in UTC, so the offset is constant inside a bucket.
 */
function cachedOffset(ms: number, timeZone: string): number {
  let zone = offsetCache.get(timeZone);
  if (!zone) {
    zone = new Map();
    offsetCache.set(timeZone, zone);
  }
  const bucket = Math.floor(ms / QUARTER_HOUR);
  let offset = zone.get(bucket);
  if (offset === undefined) {
    if (zone.size > 100_000) zone.clear();
    offset = timeZoneOffsetMs(bucket * QUARTER_HOUR, timeZone);
    zone.set(bucket, offset);
  }
  return offset;
}

/** Local calendar date (`YYYY-MM-DD`) of an instant in `timeZone`. */
export function localDateOf(instant: Date | number, timeZone: string): string {
  const ms = typeof instant === 'number' ? instant : instant.getTime();
  return new Date(ms + cachedOffset(ms, timeZone)).toISOString().slice(0, 10);
}

/** The user's local "today". */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localDateOf(now, timeZone);
}

// ── Business hours (§2.5) ─────────────────────────────────────────────────────────────────

const dayStartCache = new Map<string, number>();

function dayStartMs(date: string, timeZone: string): number {
  const key = `${timeZone}|${date}`;
  let ms = dayStartCache.get(key);
  if (ms === undefined) {
    if (dayStartCache.size > 100_000) dayStartCache.clear();
    ms = startOfLocalDay(date, timeZone).getTime();
    dayStartCache.set(key, ms);
  }
  return ms;
}

/**
 * Hours in `[a, b)` that do not fall on a Saturday or Sunday in `timeZone`; `0` when `b ≤ a`.
 * Walks local calendar days, so 23- and 25-hour DST days contribute their real length.
 * Holidays are not modelled (v2.0 caveat).
 */
export function businessHours(a: Date, b: Date, timeZone: string): number {
  const from = a.getTime();
  const to = b.getTime();
  if (to <= from) return 0;
  let date = localDateOf(from, timeZone);
  const lastDate = localDateOf(to, timeZone);
  let total = 0;
  for (;;) {
    const next = addDays(date, 1);
    if (isoWeekday(date) <= 5) {
      const dayStart = dayStartMs(date, timeZone);
      const dayEnd = dayStartMs(next, timeZone);
      const overlap = Math.min(to, dayEnd) - Math.max(from, dayStart);
      if (overlap > 0) total += overlap;
    }
    if (date >= lastDate) break;
    date = next;
  }
  return total / 3_600_000;
}
