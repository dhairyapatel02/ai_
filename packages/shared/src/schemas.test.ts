import { describe, expect, it } from 'vitest';

import {
  dateRangeSchema,
  generateAppraisalSchema,
  paginationSchema,
  resumeBulletsResultSchema,
} from './schemas';

describe('shared schemas', () => {
  it('resumeBulletsResultSchema accepts model output and defaults optional fields', () => {
    const parsed = resumeBulletsResultSchema.parse({ bullets: [{ text: 'Shipped billing' }] });
    expect(parsed.bullets).toEqual([{ text: 'Shipped billing', category: '', impact: '' }]);
  });

  it('resumeBulletsResultSchema rejects the nested shape that caused BUG-14', () => {
    expect(resumeBulletsResultSchema.safeParse({ bullets: { bullets: [] } }).success).toBe(false);
  });

  it('dateRangeSchema accepts ISO dates and datetimes', () => {
    expect(
      dateRangeSchema.safeParse({ from: '2026-01-01', to: '2026-01-31T23:59:59Z' }).success,
    ).toBe(true);
    expect(dateRangeSchema.safeParse({ from: 'garbage', to: '2026-01-31' }).success).toBe(false);
  });

  it('paginationSchema coerces strings and caps limit at 100', () => {
    expect(paginationSchema.parse({ page: '2', limit: '50' })).toEqual({ page: 2, limit: 50 });
    expect(paginationSchema.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('generateAppraisalSchema validates the period and month', () => {
    expect(
      generateAppraisalSchema.safeParse({ period: 'weird', month: 13, year: 1900 }).success,
    ).toBe(false);
  });
});
