/**
 * Minimal time-zone helpers (D-019) built on `Intl`, no dependencies. The period grammar
 * (`parsePeriod`, `resolvePeriod`, `businessHours`) lives in `packages/shared/src/periods/`.
 */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Offset of `timeZone` from UTC at `instantMs`, in milliseconds (positive east of UTC). */
export function timeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return asUtc - (instantMs - (instantMs % 1000));
}

/** UTC instant at which the local calendar day `date` (`YYYY-MM-DD`) starts in `timeZone`. */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wallClock = Date.UTC(y, m - 1, d);
  let instant = wallClock - timeZoneOffsetMs(wallClock, timeZone);
  // Re-evaluate once in case a DST transition lies between the guess and the result.
  const corrected = wallClock - timeZoneOffsetMs(instant, timeZone);
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}

/** Adds `days` to a `YYYY-MM-DD` date (calendar arithmetic, no time zone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Converts inclusive bounds into a half-open UTC interval `[gte, lt)`. Date-only bounds are local
 * days in `timeZone`; `to` covers its whole day (BUG-05). Timestamps are used as given (`to`
 * inclusive, so `lt = to + 1 ms`).
 */
export function toUtcRange(
  bounds: { from?: string; to?: string },
  timeZone: string,
): { gte?: Date; lt?: Date } {
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const range: { gte?: Date; lt?: Date } = {};
  if (bounds.from !== undefined) {
    range.gte = isDate(bounds.from)
      ? startOfLocalDay(bounds.from, timeZone)
      : new Date(bounds.from);
  }
  if (bounds.to !== undefined) {
    range.lt = isDate(bounds.to)
      ? startOfLocalDay(addDays(bounds.to, 1), timeZone)
      : new Date(new Date(bounds.to).getTime() + 1);
  }
  return range;
}
