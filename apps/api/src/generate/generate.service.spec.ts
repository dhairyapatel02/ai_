import { GenerateService } from './generate.service';

import type { ActivityService } from '../activity/activity.service';
import type { AIService } from '../ai/ai.service';
import type { PrismaService } from '../prisma/prisma.service';

// TZ is pinned to UTC in test/setup-unit.ts; period math uses server-local time (BUG-06).
function createService() {
  return new GenerateService({} as PrismaService, {} as AIService, {} as ActivityService);
}

type RangeFn = (period: string, month: number, year: number) => { from: string; to: string };

function rangeFor(period: string, month: number, year: number) {
  const service = createService() as unknown as { getDateRangeForPeriod: RangeFn };
  return service.getDateRangeForPeriod(period, month, year);
}

describe('GenerateService.getDateRangeForPeriod (characterization)', () => {
  it('monthly: first day 00:00 to last day 23:59:59', () => {
    expect(rangeFor('monthly', 2, 2024)).toEqual({
      from: '2024-02-01T00:00:00.000Z',
      to: '2024-02-29T23:59:59.000Z',
    });
  });

  it('quarterly: expands any month to its calendar quarter', () => {
    expect(rangeFor('quarterly', 5, 2026)).toEqual({
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-06-30T23:59:59.000Z',
    });
    expect(rangeFor('quarterly', 12, 2026)).toEqual({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-12-31T23:59:59.000Z',
    });
  });

  it('yearly: whole calendar year regardless of month', () => {
    expect(rangeFor('yearly', 7, 2025)).toEqual({
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-12-31T23:59:59.000Z',
    });
  });

  it('unknown periods fall back to monthly', () => {
    expect(rangeFor('weird', 1, 2026)).toEqual(rangeFor('monthly', 1, 2026));
  });

  it.todo('BUG-06: period boundaries use the user’s timezone, not server-local time (P07)');
});
