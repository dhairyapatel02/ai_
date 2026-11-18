import { ActivityService } from './activity.service';

import type { PrismaService } from '../prisma/prisma.service';

/**
 * Range handling shared by every activity list (the deprecated `/activity/summary` that used to
 * exercise it was removed in P10; API_CONTRACT_V2 §20).
 */
type RangeFn = (
  userId: string,
  filter: { period?: string; from?: string; to?: string },
) => Promise<{ gte: Date; lt: Date } | undefined>;

function serviceIn(timezone: string) {
  const prisma = { userSettings: { findUnique: jest.fn().mockResolvedValue({ timezone }) } };
  const service = new ActivityService(prisma as unknown as PrismaService);
  return (service as unknown as { range: RangeFn }).range.bind(service);
}

describe('ActivityService range (Prisma mocked)', () => {
  it('no filter → no range', async () => {
    await expect(serviceIn('UTC')('u1', {})).resolves.toBeUndefined();
  });

  it('applies an instant range with an inclusive `to`', async () => {
    await expect(
      serviceIn('UTC')('u1', { from: '2026-10-01T00:00:00Z', to: '2026-10-31T23:59:59Z' }),
    ).resolves.toEqual({
      gte: new Date('2026-10-01T00:00:00Z'),
      lt: new Date('2026-10-31T23:59:59.001Z'),
    });
  });

  it('BUG-05: a date-only `to` covers the whole local day in the user’s time zone', async () => {
    // New York is UTC-4 on 2026-10-23: the local day is [04:00Z, next day 04:00Z).
    await expect(
      serviceIn('America/New_York')('u1', { from: '2026-10-23', to: '2026-10-23' }),
    ).resolves.toEqual({
      gte: new Date('2026-10-23T04:00:00Z'),
      lt: new Date('2026-10-24T04:00:00Z'),
    });
  });

  it('resolves `period` in the user’s time zone', async () => {
    await expect(serviceIn('Europe/London')('u1', { period: 'month:2026-01' })).resolves.toEqual({
      gte: new Date('2026-01-01T00:00:00Z'),
      lt: new Date('2026-02-01T00:00:00Z'),
    });
  });
});
