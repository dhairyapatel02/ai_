/**
 * Number and date formatting (DESIGN_SYSTEM §6 "Number formatting"): English UI, numerals,
 * `Nov 9, 2026`, 24-hour times in the user's time zone, `—` for unknown values (never `0`).
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

/** Local `YYYY-MM-DD` parts of an instant in `timeZone` (defaults to the browser's). */
function zonedParts(date: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/** `Nov 9, 2026`; `Nov 9` when in the current year (pass `now` for tests). */
export function formatDate(
  value: string | Date,
  options: { timeZone?: string; now?: Date; withYear?: boolean } = {},
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const p = zonedParts(date, options.timeZone);
  const nowYear = zonedParts(options.now ?? new Date(), options.timeZone).year;
  const base = `${MONTHS[p.month - 1] ?? ''} ${p.day}`;
  return options.withYear || p.year !== nowYear ? `${base}, ${p.year}` : base;
}

/** 24-hour `16:32` in the user's time zone ("Paused until 16:32"). */
export function formatTime(value: string | Date, timeZone?: string): string {
  const p = zonedParts(typeof value === 'string' ? new Date(value) : value, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** `just now`, `12 min ago`, `3 h ago`, `yesterday`, then the date. */
export function formatRelative(
  value: string | Date,
  options: { now?: Date; timeZone?: string } = {},
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const now = options.now ?? new Date();
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return 'yesterday';
  return formatDate(date, { timeZone: options.timeZone, now });
}
