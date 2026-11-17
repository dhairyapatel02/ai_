import { GenerateService } from './generate.service';

/**
 * BUG-06: appraisal and promotion ranges are local calendar dates; the activity reads interpret
 * them in the user's time zone (inclusive end day), so no server-local time is involved.
 * (TZ is pinned to UTC in test/setup-unit.ts; these functions don't depend on it.)
 */
describe('GenerateService date ranges', () => {
  it('monthly: whole calendar month as local dates (leap year)', () => {
    expect(GenerateService.appraisalRange('monthly', 2, 2024)).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
  });

  it('quarterly: expands any month to its calendar quarter', () => {
    expect(GenerateService.appraisalRange('quarterly', 5, 2026)).toEqual({
      from: '2026-04-01',
      to: '2026-06-30',
    });
    expect(GenerateService.appraisalRange('quarterly', 12, 2026)).toEqual({
      from: '2026-10-01',
      to: '2026-12-31',
    });
  });

  it('yearly: whole calendar year regardless of month', () => {
    expect(GenerateService.appraisalRange('yearly', 7, 2025)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('BUG-06: the promotion window ends on the user’s local today, not the server’s', () => {
    // 2026-11-17T03:00Z is still Nov 16 in Los Angeles and already Nov 17 in Tokyo.
    const now = new Date('2026-11-17T03:00:00Z');
    expect(GenerateService.promotionRange('America/Los_Angeles', now)).toEqual({
      from: '2026-05-16',
      to: '2026-11-16',
    });
    expect(GenerateService.promotionRange('Asia/Tokyo', now)).toEqual({
      from: '2026-05-17',
      to: '2026-11-17',
    });
  });

  it('clamps the promotion start to the end of a shorter month', () => {
    expect(GenerateService.promotionRange('UTC', new Date('2026-08-31T12:00:00Z'))).toEqual({
      from: '2026-02-28',
      to: '2026-08-31',
    });
  });
});
