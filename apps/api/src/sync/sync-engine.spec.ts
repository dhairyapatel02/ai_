import { SyncKind } from '@prisma/client';

import { planSlices, progressOf } from './sync-engine.service';

const DAY = 86_400_000;

describe('sync engine planning', () => {
  it('backfill: newest 30 days first, then month by month back to the window start', () => {
    const to = new Date('2026-11-16T00:00:00Z');
    const from = new Date('2025-11-16T00:00:00Z');
    const slices = planSlices(SyncKind.BACKFILL, from, to);
    expect(slices[0]).toEqual({ from: new Date(to.getTime() - 30 * DAY), to, recent: true });
    expect(slices.at(-1)?.from).toEqual(from);
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i]?.to).toEqual(slices[i - 1]?.from); // contiguous, no gaps or overlaps
      expect(slices[i]?.recent).toBe(false);
    }
    expect(slices).toHaveLength(13);
  });

  it('incremental: one slice', () => {
    const from = new Date('2026-11-15T00:00:00Z');
    const to = new Date('2026-11-16T00:00:00Z');
    expect(planSlices(SyncKind.INCREMENTAL, from, to)).toEqual([{ from, to, recent: false }]);
  });

  it('BUG-09: progress comes from planned work units, never decreases, and caps at 99 until done', () => {
    expect(progressOf({ done: 1 }, 0, 1)).toBe(25); // repos + 3 placeholder stages
    // Learning that a stage has 10 pages lowers the ratio but never the reported progress.
    expect(progressOf({ done: 2, plan: { '0:AUTHORED_PRS': 10 } }, 25, 1)).toBe(25);
    expect(progressOf({ done: 13, plan: { '0:AUTHORED_PRS': 10 } }, 25, 1)).toBe(99);
  });
});
