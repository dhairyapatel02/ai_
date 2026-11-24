import { describe, expect, it } from 'vitest';

import { ApiError } from './api/errors';
import { quotaCopy, generationErrorCopy, readyToastText, resetDate } from './documents';
import {
  defaultPeriod,
  formFromOptions,
  initialForm,
  last12Months,
  periodOptions,
  previewOptions,
  toOptions,
} from './studio';

const TODAY = '2026-11-21';
const TZ = 'Europe/London';

describe('studio periods', () => {
  it('lists appraisal presets with in-progress labels and the last 12 months', () => {
    const options = periodOptions('appraisal', TODAY, TZ);
    expect(options.map((o) => o.spec)).toEqual([
      'month:2026-11',
      'month:2026-10',
      'quarter:2026-Q4',
      'quarter:2026-Q3',
      'half:2026-H2',
      'half:2026-H1',
      'year:2026',
      'year:2025',
      'custom:2025-11-22..2026-11-21',
    ]);
    expect(options[0]?.label).toBe('November 2026 (in progress)');
    expect(options.at(-1)?.label).toBe('Last 12 months');
  });

  it('defaults resume/promotion to 12 months and appraisal to the current half; honours ?period=', () => {
    expect(last12Months(TODAY)).toBe('custom:2025-11-22..2026-11-21');
    expect(defaultPeriod('resume', TODAY, TZ, null)).toBe('custom:2025-11-22..2026-11-21');
    expect(defaultPeriod('appraisal', TODAY, TZ, null)).toBe('half:2026-H2');
    expect(defaultPeriod('appraisal', TODAY, TZ, 'quarter:2026-Q3')).toBe('quarter:2026-Q3');
    expect(defaultPeriod('appraisal', TODAY, TZ, 'nonsense')).toBe('half:2026-H2');
    expect(defaultPeriod('appraisal', TODAY, TZ, 'year:2099')).toBe('half:2026-H2');
    const withExtra = periodOptions('resume', TODAY, TZ, 'custom:2026-01-01..2026-03-31');
    expect(withExtra[0]).toEqual({
      spec: 'custom:2026-01-01..2026-03-31',
      label: 'Jan 1 – Mar 31, 2026',
    });
  });
});

describe('studio options', () => {
  const base = initialForm('half:2026-H2', { current: 'Senior engineer', target: null });

  it('builds DocumentOptions per type and drops empty optional text', () => {
    expect(toOptions('appraisal', { ...base, selfReflection: '  ' })).toEqual({
      type: 'appraisal',
      period: 'half:2026-H2',
    });
    expect(toOptions('resume', { ...base, role: 'devops', jobDescription: ' JD ' })).toEqual({
      type: 'resume',
      period: 'half:2026-H2',
      role: 'devops',
      format: 'bullets',
      length: 'standard',
      jobDescription: 'JD',
    });
    expect(toOptions('promotion', base)).toBeNull();
    expect(toOptions('promotion', { ...base, targetRole: 'Staff', ladderText: 'L' })).toEqual({
      type: 'promotion',
      period: 'half:2026-H2',
      currentRole: 'Senior engineer',
      targetRole: 'Staff',
      ladderText: 'L',
    });
    expect(previewOptions('promotion', base)).toMatchObject({ currentRole: 'Senior engineer' });
  });

  it('pre-fills from stored options (duplicate / change options)', () => {
    const f = formFromOptions(base, {
      type: 'resume',
      period: 'year:2025',
      role: 'manager',
      format: 'narrative',
      length: 'short',
      jobDescription: 'x',
    });
    expect(f).toMatchObject({
      period: 'year:2025',
      role: 'manager',
      format: 'narrative',
      length: 'short',
    });
    expect(formFromOptions(base, { role: 'wizard', period: 'bad' })).toMatchObject({
      role: 'backend',
      period: 'half:2026-H2',
    });
  });
});

describe('document copy', () => {
  it('names the reset date in quota copy (DESIGN_SYSTEM §8)', () => {
    expect(quotaCopy(15, '2026-12-01T00:00:00.000Z')).toBe(
      "You've used all 15 generations for November. They reset on December 1.",
    );
    expect(resetDate('2027-01-01T00:00:00.000Z')).toBe('January 1');
    const err = new ApiError({
      code: 'QUOTA_EXCEEDED',
      status: 402,
      message: 'x',
      details: {
        feature: 'generations',
        used: 15,
        limit: 15,
        resetsAt: '2026-12-01T00:00:00.000Z',
      },
    });
    expect(generationErrorCopy(err)).toContain('They reset on December 1.');
  });

  it('gives the retry time for 429 and the no-evidence reason for 409', () => {
    const at = new Date(Date.now() + 120_000);
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    expect(
      generationErrorCopy(
        new ApiError({ code: 'RATE_LIMITED', status: 429, message: 'x', retryAfterSeconds: 120 }),
      ),
    ).toBe(`Too many generations in a short time. Try again at ${hhmm}.`);
    expect(
      generationErrorCopy(
        new ApiError({
          code: 'CONFLICT',
          status: 409,
          message: 'x',
          details: { reason: 'no_evidence' },
        }),
      ),
    ).toBe("There's no merged or reviewed work in this period. Choose a longer period.");
    expect(readyToastText({ type: 'appraisal', citationCoverage: 0.96 })).toBe(
      'Appraisal ready — 96% of claims cited.',
    );
  });
});
