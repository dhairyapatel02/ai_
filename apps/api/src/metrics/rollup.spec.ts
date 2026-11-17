import { addDays } from '@devimpact/shared';
import fc from 'fast-check';

import { GOLDEN_FACTS, windowOf } from '../../test/fixtures/metrics/golden';
import { computeMetrics, type Facts } from './metric-definitions';
import { rollupDays } from './rollup';

/** Property tests: rollups are idempotent, additive over sub-ranges and agree with the metrics. */
const BASE = Date.UTC(2026, 0, 1);
const instant = fc.integer({ min: 0, max: 120 * 86_400_000 }).map((ms) => new Date(BASE + ms));
const repo = fc.constantFrom('R1', 'R2', 'R3');
const factsArb: fc.Arbitrary<Facts> = fc.record({
  commits: fc.array(fc.record({ id: fc.uuid(), repositoryId: repo, authoredAt: instant }), {
    maxLength: 40,
  }),
  authored: fc.array(
    fc
      .record({
        id: fc.uuid(),
        repositoryId: repo,
        createdAt: instant,
        merged: fc.boolean(),
        gapMs: fc.integer({ min: 0, max: 10 * 86_400_000 }),
      })
      .map(({ id, repositoryId, createdAt, merged, gapMs }) => {
        const end = new Date(createdAt.getTime() + gapMs);
        return {
          id,
          repositoryId,
          createdAt,
          readyAt: createdAt,
          mergedAt: merged ? end : null,
          closedAt: end,
          changedLines: 10,
          changesRequestedCount: 0,
          firstReviewAt: null,
          revertedAt: null,
        };
      }),
    { maxLength: 20 },
  ),
  reviews: fc.array(
    fc
      .record({
        id: fc.uuid(),
        pullRequestId: fc.constantFrom('Q1', 'Q2', 'Q3', 'Q4'),
        repositoryId: repo,
        submittedAt: instant,
        commentsCount: fc.integer({ min: 0, max: 5 }),
        hasBody: fc.boolean(),
      })
      .map((r) => ({ ...r, reviewRequestedAt: null })),
    { maxLength: 30 },
  ),
});
const zone = fc.constantFrom('UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Pacific/Auckland');

describe('rollupDays (property tests)', () => {
  it('is idempotent and independent of input order', () => {
    fc.assert(
      fc.property(factsArb, zone, (facts, tz) => {
        const a = rollupDays(facts, '2026-01-01', '2026-05-31', tz);
        const b = rollupDays(facts, '2026-01-01', '2026-05-31', tz);
        const reversed = rollupDays(
          {
            commits: [...facts.commits].reverse(),
            authored: [...facts.authored].reverse(),
            reviews: [...facts.reviews].reverse(),
          },
          '2026-01-01',
          '2026-05-31',
          tz,
        );
        expect(b).toEqual(a);
        expect(reversed).toEqual(a);
      }),
    );
  });

  it('recomputing a sub-range rewrites exactly the rows of that sub-range', () => {
    fc.assert(
      fc.property(factsArb, zone, fc.integer({ min: 0, max: 100 }), (facts, tz, split) => {
        const mid = addDays('2026-01-01', split);
        const whole = rollupDays(facts, '2026-01-01', '2026-05-31', tz);
        const parts = [
          ...rollupDays(facts, '2026-01-01', mid, tz),
          ...rollupDays(facts, addDays(mid, 1), '2026-05-31', tz),
        ];
        expect(parts).toEqual(whole);
      }),
    );
  });

  it('daily counters sum to the period counts of the metrics engine', () => {
    fc.assert(
      fc.property(factsArb, zone, (facts, tz) => {
        const rows = rollupDays(facts, '2026-02-01', '2026-02-28', tz);
        const metrics = computeMetrics(facts, windowOf('2026-02-01', '2026-02-28', tz));
        expect(rows.reduce((s, r) => s + r.commits, 0)).toBe(metrics.commits.value);
        expect(rows.reduce((s, r) => s + r.prsMerged, 0)).toBe(metrics.prs_merged.value);
        expect(rows.reduce((s, r) => s + r.prsOpened, 0)).toBe(metrics.prs_opened.value);
        expect(rows.filter((r) => r.active)).toHaveLength(metrics.active_days.value!);
      }),
    );
  });

  it('agrees with the golden dataset', () => {
    const rows = rollupDays(GOLDEN_FACTS, '2026-10-01', '2026-10-31', 'UTC');
    expect(rows.filter((r) => r.active)).toHaveLength(13);
  });
});
