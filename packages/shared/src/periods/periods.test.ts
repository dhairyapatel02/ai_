import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addDays } from '../time/zoned';
import {
  PeriodError,
  businessHours,
  comparisonPeriod,
  daysInclusive,
  isoWeek,
  isoWeekKey,
  isoWeekday,
  localDateOf,
  localRangeToUtc,
  parsePeriod,
  periodSpecContaining,
  periodSpecsEnding,
  previousPeriod,
  resolvePeriod,
  shiftPeriodSpec,
  startOfIsoWeek,
} from './index';

const at = (iso: string) => new Date(iso);

describe('parsePeriod (API_CONTRACT_V2 §3.4)', () => {
  it.each([
    ['month:2026-10', '2026-10-01', '2026-10-31'],
    ['month:2024-02', '2024-02-01', '2024-02-29'], // leap year
    ['month:2026-02', '2026-02-01', '2026-02-28'],
    ['quarter:2026-Q4', '2026-10-01', '2026-12-31'],
    ['quarter:2026-Q1', '2026-01-01', '2026-03-31'],
    ['half:2026-H1', '2026-01-01', '2026-06-30'],
    ['half:2026-H2', '2026-07-01', '2026-12-31'],
    ['year:2024', '2024-01-01', '2024-12-31'],
    ['custom:2026-10-01..2026-11-15', '2026-10-01', '2026-11-15'],
  ])('%s → %s..%s', (spec, startDate, endDate) => {
    expect(parsePeriod(spec)).toMatchObject({ startDate, endDate });
  });

  it('counts leap-year days', () => {
    const p = parsePeriod('year:2024');
    expect(daysInclusive(p.startDate, p.endDate)).toBe(366);
  });

  it.each([
    ['custom:2026-10-01..2026-10-06', /7–366/], // 6 days → invalid (KPI §10)
    ['custom:2025-01-01..2026-01-02', /7–366/], // 367 days
    ['custom:2026-10-10..2026-10-01', /ends before/],
    ['custom:2026-02-30..2026-03-10', /calendar/],
    ['month:2026-13', /Unrecognised/],
    ['week:2026-W01', /Unrecognised/],
  ])('rejects %s', (spec, message) => {
    expect(() => parsePeriod(spec)).toThrow(PeriodError);
    expect(() => parsePeriod(spec)).toThrow(message);
  });

  it('accepts the 7- and 366-day custom limits', () => {
    expect(() => parsePeriod('custom:2026-10-01..2026-10-07')).not.toThrow();
    expect(() => parsePeriod('custom:2024-01-01..2024-12-31')).not.toThrow();
  });
});

describe('resolvePeriod', () => {
  it('marks the current period in progress: display ends today, periodDays stays full', () => {
    expect(resolvePeriod('month:2026-11', 'UTC', '2026-11-09')).toEqual({
      spec: 'month:2026-11',
      type: 'month',
      startDate: '2026-11-01',
      endDate: '2026-11-09',
      timezone: 'UTC',
      periodDays: 30,
      inProgress: true,
      label: 'November 2026',
    });
  });

  it('resolves past periods to their full range with labels', () => {
    expect(resolvePeriod('quarter:2026-Q3', 'UTC', '2026-11-09')).toMatchObject({
      endDate: '2026-09-30',
      inProgress: false,
      periodDays: 92,
      label: 'Q3 2026',
    });
    expect(resolvePeriod('half:2026-H1', 'UTC', '2026-11-09').label).toBe('H1 2026');
    expect(resolvePeriod('year:2025', 'UTC', '2026-11-09').label).toBe('2025');
    expect(resolvePeriod('custom:2025-12-20..2026-01-10', 'UTC', '2026-11-09').label).toBe(
      'Dec 20, 2025 – Jan 10, 2026',
    );
    expect(resolvePeriod('custom:2026-10-01..2026-11-15', 'UTC', '2026-12-01').label).toBe(
      'Oct 1 – Nov 15, 2026',
    );
  });

  it('rejects periods that start in the future', () => {
    expect(() => resolvePeriod('month:2026-12', 'UTC', '2026-11-09')).toThrow(/future/);
  });

  it('builds the default spec containing a date', () => {
    expect(periodSpecContaining('month', '2026-11-09')).toBe('month:2026-11');
    expect(periodSpecContaining('quarter', '2026-11-09')).toBe('quarter:2026-Q4');
    expect(periodSpecContaining('half', '2026-06-30')).toBe('half:2026-H1');
    expect(periodSpecContaining('year', '2026-01-01')).toBe('year:2026');
  });
});

describe('previous and comparison periods (§2.4, §3.7)', () => {
  it.each([
    ['month:2026-01', 'month:2025-12'],
    ['quarter:2026-Q1', 'quarter:2025-Q4'],
    ['half:2026-H1', 'half:2025-H2'],
    ['year:2026', 'year:2025'],
    ['custom:2026-10-01..2026-10-10', 'custom:2026-09-21..2026-09-30'],
  ])('previous of %s is %s', (spec, expected) => {
    expect(previousPeriod(resolvePeriod(spec, 'UTC', '2026-12-31')).spec).toBe(expected);
  });

  it('compares an in-progress period with the same elapsed days of the previous one', () => {
    const { period, comparison } = comparisonPeriod(
      resolvePeriod('month:2026-11', 'UTC', '2026-11-09'),
    );
    expect(comparison).toBe('same_elapsed');
    expect(period).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-09' });
  });

  it('clips the comparison to the shorter previous period', () => {
    const { period } = comparisonPeriod(resolvePeriod('month:2026-03', 'UTC', '2026-03-31'));
    expect(period).toMatchObject({ startDate: '2026-02-01', endDate: '2026-02-28' });
  });

  it('compares a finished period with the full previous one', () => {
    const { period, comparison } = comparisonPeriod(
      resolvePeriod('month:2026-10', 'UTC', '2026-11-09'),
    );
    expect(comparison).toBe('full');
    expect(period).toMatchObject({ startDate: '2026-09-01', endDate: '2026-09-30' });
  });

  it('lists consecutive periods oldest first', () => {
    expect(periodSpecsEnding('month:2026-02', 3)).toEqual([
      'month:2025-12',
      'month:2026-01',
      'month:2026-02',
    ]);
    expect(shiftPeriodSpec('quarter:2026-Q1', -5)).toBe('quarter:2024-Q4');
  });
});

describe('time-zone boundaries (D-019, KPI §10.3)', () => {
  it('maps Pacific/Auckland months to NZ midnight (DST in effect)', () => {
    const { start, endExclusive } = localRangeToUtc('2026-10-01', '2026-10-31', 'Pacific/Auckland');
    expect(start.toISOString()).toBe('2026-09-30T11:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-10-31T11:00:00.000Z');
  });

  it('includes the whole last day in America/Los_Angeles across the DST change', () => {
    const { start, endExclusive } = localRangeToUtc(
      '2026-11-01',
      '2026-11-30',
      'America/Los_Angeles',
    );
    expect(start.toISOString()).toBe('2026-11-01T07:00:00.000Z'); // PDT
    expect(endExclusive.toISOString()).toBe('2026-12-01T08:00:00.000Z'); // PST
    const lastMinute = at('2026-12-01T07:59:00Z'); // Nov 30 23:59 local
    expect(lastMinute < endExclusive).toBe(true);
    expect(localDateOf(lastMinute, 'America/Los_Angeles')).toBe('2026-11-30');
  });

  it('derives local dates of instants', () => {
    expect(localDateOf(at('2026-10-31T11:30:00Z'), 'Pacific/Auckland')).toBe('2026-11-01');
    expect(localDateOf(at('2026-10-31T10:59:59Z'), 'Pacific/Auckland')).toBe('2026-10-31');
    expect(localDateOf(at('2026-01-01T04:00:00Z'), 'America/New_York')).toBe('2025-12-31');
  });
});

describe('ISO weeks', () => {
  it.each([
    ['2026-12-31', '2026-W53'], // 2026 has 53 ISO weeks (Thursday Jan 1)
    ['2027-01-03', '2026-W53'],
    ['2027-01-04', '2027-W01'],
    ['2020-12-31', '2020-W53'],
    ['2021-01-01', '2020-W53'],
    ['2024-12-30', '2025-W01'],
    ['2026-10-01', '2026-W40'],
    ['2026-10-31', '2026-W44'],
  ])('%s is in %s', (date, key) => {
    expect(isoWeekKey(date)).toBe(key);
  });

  it('weekdays are Monday = 1 … Sunday = 7', () => {
    expect(isoWeekday('2026-11-09')).toBe(1);
    expect(isoWeekday('2026-11-15')).toBe(7);
    expect(startOfIsoWeek('2026-11-15')).toBe('2026-11-09');
  });
});

describe('businessHours (§2.5)', () => {
  it('counts a same-day span', () => {
    expect(businessHours(at('2026-11-09T09:00:00Z'), at('2026-11-09T17:00:00Z'), 'UTC')).toBe(8);
  });

  it('skips the weekend: Friday 17:00 → Monday 09:00 is 16 h', () => {
    expect(businessHours(at('2026-11-06T17:00:00Z'), at('2026-11-09T09:00:00Z'), 'UTC')).toBe(16);
  });

  it('returns 0 when b ≤ a', () => {
    const t = at('2026-11-09T09:00:00Z');
    expect(businessHours(t, t, 'UTC')).toBe(0);
    expect(businessHours(t, at('2026-11-08T09:00:00Z'), 'UTC')).toBe(0);
  });

  it('uses local weekdays (Saturday in Tokyo is Friday in UTC)', () => {
    // Sat 2026-11-07 00:00–09:00 JST = Fri 15:00–24:00 UTC.
    expect(
      businessHours(at('2026-11-06T15:00:00Z'), at('2026-11-07T00:00:00Z'), 'Asia/Tokyo'),
    ).toBe(0);
    expect(businessHours(at('2026-11-06T15:00:00Z'), at('2026-11-07T00:00:00Z'), 'UTC')).toBe(9);
  });

  it('spans the Europe/Berlin spring-forward weekend', () => {
    // Fri 2026-03-27 00:00 CET → Tue 2026-03-31 00:00 CEST: Friday 24 h + Monday 24 h.
    expect(
      businessHours(at('2026-03-26T23:00:00Z'), at('2026-03-30T22:00:00Z'), 'Europe/Berlin'),
    ).toBe(48);
    // Saturday → Monday 12:00 local across the change: only Monday morning counts.
    expect(
      businessHours(at('2026-03-28T11:00:00Z'), at('2026-03-30T10:00:00Z'), 'Europe/Berlin'),
    ).toBe(12);
  });

  it('spans the America/New_York fall-back weekend', () => {
    // Fri 2026-10-30 12:00 EDT → Mon 2026-11-02 12:00 EST: 12 h + 12 h (Sunday is 25 h, excluded).
    expect(
      businessHours(at('2026-10-30T16:00:00Z'), at('2026-11-02T17:00:00Z'), 'America/New_York'),
    ).toBe(24);
  });

  it('counts the real length of a 23-hour weekday (Asia/Jerusalem, Friday DST start)', () => {
    // Israel switches on Friday 2026-03-27 at 02:00; that local Friday lasts 23 h.
    const { start, endExclusive } = localRangeToUtc('2026-03-27', '2026-03-27', 'Asia/Jerusalem');
    expect(businessHours(start, endExclusive, 'Asia/Jerusalem')).toBe(23);
  });
});

describe('property tests (fast-check)', () => {
  const zones = fc.constantFrom(
    'UTC',
    'Europe/Berlin',
    'America/New_York',
    'America/Los_Angeles',
    'Pacific/Auckland',
    'Asia/Kolkata',
    'Australia/Lord_Howe',
  );
  const dates = fc.integer({ min: 0, max: 365 * 12 }).map((n) => addDays('2018-01-01', n));
  const specs = fc.oneof(
    dates.map((d) => periodSpecContaining('month', d)),
    dates.map((d) => periodSpecContaining('quarter', d)),
    dates.map((d) => periodSpecContaining('half', d)),
    dates.map((d) => periodSpecContaining('year', d)),
    fc
      .tuple(dates, fc.integer({ min: 7, max: 366 }))
      .map(([d, len]) => `custom:${d}..${addDays(d, len - 1)}`),
  );

  it('UTC ranges start and end exactly at local midnight', () => {
    fc.assert(
      fc.property(specs, zones, (spec, tz) => {
        const p = parsePeriod(spec);
        const { start, endExclusive } = localRangeToUtc(p.startDate, p.endDate, tz);
        expect(localDateOf(start, tz)).toBe(p.startDate);
        expect(localDateOf(new Date(start.getTime() - 1), tz)).toBe(addDays(p.startDate, -1));
        expect(localDateOf(new Date(endExclusive.getTime() - 1), tz)).toBe(p.endDate);
        expect(localDateOf(endExclusive, tz)).toBe(addDays(p.endDate, 1));
      }),
      { numRuns: 300 },
    );
  });

  it('previous periods tile time without gaps or overlaps', () => {
    fc.assert(
      fc.property(specs, (spec) => {
        const current = resolvePeriod(spec, 'UTC', '9999-12-31');
        const previous = previousPeriod(current);
        expect(addDays(previous.endDate, 1)).toBe(current.startDate);
        expect(previous.type).toBe(current.type);
        if (current.type === 'custom') expect(previous.periodDays).toBe(current.periodDays);
        expect(shiftPeriodSpec(previous.spec, 1)).toBe(spec);
      }),
      { numRuns: 300 },
    );
  });

  it('business hours are additive and never exceed elapsed hours', () => {
    const instant = fc.integer({
      min: Date.UTC(2024, 0, 1),
      max: Date.UTC(2027, 0, 1),
    });
    fc.assert(
      fc.property(fc.array(instant, { minLength: 3, maxLength: 3 }), zones, (raw, tz) => {
        const [a, b, c] = [...raw].sort((x, y) => x - y).map((ms) => new Date(ms)) as [
          Date,
          Date,
          Date,
        ];
        const whole = businessHours(a, c, tz);
        expect(whole).toBeCloseTo(businessHours(a, b, tz) + businessHours(b, c, tz), 9);
        expect(whole).toBeLessThanOrEqual((c.getTime() - a.getTime()) / 3_600_000 + 1e-9);
        expect(whole).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });

  it('ISO weeks are 1–53 and start on Monday', () => {
    fc.assert(
      fc.property(dates, (date) => {
        const { week } = isoWeek(date);
        expect(week).toBeGreaterThanOrEqual(1);
        expect(week).toBeLessThanOrEqual(53);
        expect(isoWeekday(startOfIsoWeek(date))).toBe(1);
        expect(isoWeekKey(startOfIsoWeek(date))).toBe(isoWeekKey(date));
      }),
    );
  });
});
