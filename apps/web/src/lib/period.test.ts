import { describe, expect, it } from 'vitest';

import { customRangeSpec, periodPresets, resolvePeriodState, shortPeriodLabel } from './period';

const NOW = new Date('2026-11-18T12:00:00Z');

describe('period URL state (IA §4)', () => {
  it('defaults to the user default period type containing today in their time zone', () => {
    const state = resolvePeriodState(
      null,
      { timezone: 'Europe/London', defaultPeriodType: 'quarter' },
      NOW,
    );
    expect(state.resolved).toMatchObject({
      spec: 'quarter:2026-Q4',
      label: 'Q4 2026',
      inProgress: true,
    });
    expect(state.apiParam).toBeUndefined();
  });

  it('uses the local date, not UTC', () => {
    const late = new Date('2026-11-30T12:30:00Z'); // already Dec 1 in Auckland (UTC+13)
    expect(
      resolvePeriodState(null, { timezone: 'Pacific/Auckland', defaultPeriodType: 'month' }, late)
        .resolved?.spec,
    ).toBe('month:2026-12');
  });

  it('passes an explicit spec to the API and labels it', () => {
    const state = resolvePeriodState(
      'month:2026-10',
      { timezone: 'UTC', defaultPeriodType: 'month' },
      NOW,
    );
    expect(state.apiParam).toBe('month:2026-10');
    expect(state.resolved).toMatchObject({ label: 'October 2026', inProgress: false });
  });

  it('flags malformed or out-of-range specs (designed INVALID_PERIOD state)', () => {
    expect(
      resolvePeriodState('month:2026-13', { timezone: 'UTC', defaultPeriodType: 'month' }, NOW)
        .invalid,
    ).toBe('Unrecognised period');
    expect(
      resolvePeriodState('year:2030', { timezone: 'UTC', defaultPeriodType: 'month' }, NOW).invalid,
    ).toMatch(/future/);
    expect(
      resolvePeriodState(
        'custom:2026-11-01..2026-11-03',
        { timezone: 'UTC', defaultPeriodType: 'month' },
        NOW,
      ).invalid,
    ).toMatch(/7–366/);
  });

  it('works before settings load (labels pending, explicit spec still sent)', () => {
    expect(resolvePeriodState('year:2026', null)).toMatchObject({
      resolved: null,
      apiParam: 'year:2026',
    });
  });

  it('lists the presets in IA order', () => {
    expect(periodPresets('2026-11-18')).toEqual([
      { label: 'This month', spec: 'month:2026-11' },
      { label: 'Last month', spec: 'month:2026-10' },
      { label: 'This quarter', spec: 'quarter:2026-Q4' },
      { label: 'Last quarter', spec: 'quarter:2026-Q3' },
      { label: 'This half', spec: 'half:2026-H2' },
      { label: 'Last half', spec: 'half:2026-H1' },
      { label: 'This year', spec: 'year:2026' },
      { label: 'Last year', spec: 'year:2025' },
    ]);
  });

  it('validates custom ranges with field-level copy', () => {
    const today = '2026-11-18';
    expect(customRangeSpec('2026-11-01', '2026-11-03', today)).toEqual({
      error: 'Choose at least 7 days.',
    });
    expect(customRangeSpec('2026-11-20', '2026-11-30', today)).toEqual({
      error: "The start date can't be in the future.",
    });
    expect(customRangeSpec('2026-11-10', '2026-11-01', today)).toEqual({
      error: 'The end date must be after the start date.',
    });
    expect(customRangeSpec('2024-01-01', '2026-01-01', today)).toEqual({
      error: 'Choose at most 366 days.',
    });
    expect(customRangeSpec('2026-09-15', '2026-11-08', today)).toEqual({
      spec: 'custom:2026-09-15..2026-11-08',
    });
  });

  it('never uses two-digit years on mobile', () => {
    const state = resolvePeriodState(
      'month:2026-11',
      { timezone: 'UTC', defaultPeriodType: 'month' },
      NOW,
    );
    expect(shortPeriodLabel(state.resolved!)).toBe('Nov 2026');
  });
});
