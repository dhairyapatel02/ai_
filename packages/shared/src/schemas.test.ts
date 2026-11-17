import { describe, expect, it } from 'vitest';

import {
  AppraisalContent,
  CreateDocumentInput,
  DocumentListQuery,
  ResumeContent,
  UsageQuery,
} from './api/documents';
import { dateRangeSchema, paginationSchema } from './schemas';

describe('shared schemas', () => {
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
});

describe('document schemas (P08)', () => {
  it('CreateDocumentInput applies per-type defaults and rejects unknown keys (BUG-07)', () => {
    expect(
      CreateDocumentInput.parse({ type: 'resume', period: 'month:2026-10', role: 'backend' }),
    ).toEqual({
      type: 'resume',
      period: 'month:2026-10',
      role: 'backend',
      format: 'bullets',
      length: 'standard',
    });
    expect(CreateDocumentInput.safeParse({ type: 'promotion' }).success).toBe(false);
    expect(
      CreateDocumentInput.safeParse({
        type: 'promotion',
        currentRole: 'IC',
        targetRole: 'Senior',
        injected: true,
      }).success,
    ).toBe(false);
    expect(
      CreateDocumentInput.safeParse({ type: 'appraisal', period: 'month:2026-13' }).success,
    ).toBe(false);
    expect(
      CreateDocumentInput.safeParse({ type: 'resume', period: 'year:2026', role: 'x'.repeat(200) })
        .success,
    ).toBe(false);
  });

  it('content schemas require citations as evidence refs', () => {
    const item = { id: 'b1', text: 'Shipped billing', citations: ['PR-acme/api#12'] };
    expect(
      ResumeContent.safeParse({
        format: 'bullets',
        summary: null,
        bullets: [{ ...item, theme: 'Delivery' }],
      }).success,
    ).toBe(true);
    expect(
      ResumeContent.safeParse({
        format: 'bullets',
        summary: null,
        bullets: [{ ...item, theme: 'x', citations: ['not a ref'] }],
      }).success,
    ).toBe(false);
    expect(
      AppraisalContent.safeParse({
        sections: {
          executiveSummary: item,
          keyContributions: [],
          metrics: [],
          areasOfImpact: [],
          growth: [],
          nextGoals: [{ id: 'g1', text: 'Mentor one new hire' }],
        },
      }).success,
    ).toBe(true);
  });

  it('list and usage queries validate filters', () => {
    expect(DocumentListQuery.parse({})).toMatchObject({ limit: 20, sort: '-createdAt' });
    expect(DocumentListQuery.safeParse({ type: 'kpi' }).success).toBe(false);
    expect(UsageQuery.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(UsageQuery.parse({ month: '2026-11' })).toEqual({ month: '2026-11' });
  });
});
