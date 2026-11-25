import { PeriodError, SCORE_VERSION, parsePeriod } from '@devimpact/shared';
import fc from 'fast-check';

import { GOLDEN_FACTS, OCTOBER } from '../../test/fixtures/metrics/golden';
import {
  band,
  combineDimensions,
  computeImpact,
  renderExplanation,
  roundScore,
  shrunk,
  type ImpactMetricInputs,
} from './impact';
import { computeMetrics } from './metric-definitions';
import { buildImpactInputs } from './score-inputs';

const ok = (value: number, n = value) => ({ value, n, status: 'ok' as const });
const insufficient = (n: number) => ({ value: null, n, status: 'insufficient_data' as const });

/** G-1 inputs (KPI_METHODOLOGY §6.5): user in UTC, month:2026-10 (31 days). */
const G1: ImpactMetricInputs = {
  prs_merged: ok(6),
  pr_cycle_time_median_hours: ok(30, 6),
  active_weeks_ratio: ok(0.8, 5),
  small_pr_ratio: ok(5 / 6, 6),
  revert_rate: ok(0, 6),
  merge_rate: ok(6 / 7, 7),
  prs_reviewed: ok(9),
  review_turnaround_median_hours: ok(6, 8),
  review_balance: ok(9 / 15, 15),
  two_way_repos: ok(2),
  repos_contributed: ok(3),
};

describe('impact@2.0.0 — golden test G-1 (§6.5)', () => {
  const impact = computeImpact(G1, { periodDays: 31 });
  const component = (dim: keyof typeof impact.dimensions, metric: string) =>
    impact.dimensions[dim].components.find((c) => c.metric === metric);

  it('reproduces every component of the worked example', () => {
    expect(component('delivery', 'prs_merged')).toMatchObject({ weight: 0.5 });
    expect(component('delivery', 'prs_merged')?.input).toBeCloseTo(5.4194, 4);
    expect(component('delivery', 'prs_merged')?.band).toBeCloseTo(68.871, 3);
    expect(component('delivery', 'pr_cycle_time_median_hours')?.band).toBeCloseTo(81.875, 4);
    expect(component('delivery', 'pr_cycle_time_median_hours')?.shrunk).toBeCloseTo(71.25, 4);
    expect(component('delivery', 'active_weeks_ratio')?.band).toBeCloseTo(84, 4);
    expect(component('quality', 'small_pr_ratio')?.band).toBeCloseTo(91.6667, 4);
    expect(component('quality', 'small_pr_ratio')?.shrunk).toBeCloseTo(77.7778, 4);
    expect(component('quality', 'revert_rate')?.shrunk).toBeCloseTo(83.3333, 4);
    expect(component('quality', 'merge_rate')?.band).toBeCloseTo(91.4286, 4);
    expect(component('quality', 'merge_rate')?.shrunk).toBeCloseTo(79, 4);
    expect(component('collaboration', 'prs_reviewed')?.band).toBeCloseTo(80.6452, 4);
    expect(component('collaboration', 'review_turnaround_median_hours')?.shrunk).toBeCloseTo(
      79.0909,
      4,
    );
    expect(component('collaboration', 'review_balance')?.shrunk).toBeCloseTo(91.6667, 4);
  });

  it('reproduces the dimensions and the overall score 78', () => {
    expect(impact.status).toBe('ok');
    expect(impact.dimensions.delivery.score).toBeCloseTo(72.6105, 4);
    expect(impact.dimensions.quality.score).toBeCloseTo(80.0278, 4);
    expect(impact.dimensions.collaboration.score).toBeCloseTo(82.3832, 4);
    expect(impact.dimensions.ownership.score).toBeCloseTo(78, 10);
    expect(impact.overall).toBeCloseTo(78.205, 3);
    expect(roundScore(impact.overall!)).toBe(78);
    expect(
      ['delivery', 'quality', 'collaboration', 'ownership'].map((k) =>
        roundScore(impact.dimensions[k as 'delivery'].score!),
      ),
    ).toEqual([73, 80, 82, 78]);
  });

  it('renders the "How is this calculated?" explanation', () => {
    const text = renderExplanation(impact, 'October 2026');
    expect(text).toContain('Your impact score: 78 (Strong)');
    expect(text).toContain('Delivery 73');
    expect(text).toContain('Quality 80');
    expect(text).toContain('Collaboration 82');
    expect(text).toContain('Ownership 78');
    expect(text).toContain('Weights: 30 / 25 / 30 / 15');
    expect(text).toContain(`Version ${SCORE_VERSION}`);
    expect(text).not.toContain("wasn't scored");
  });
});

describe('impact@2.0.0 — golden test G-2 (re-weighting)', () => {
  it('combineDimensions renormalises over available dimensions', () => {
    const overall = combineDimensions([
      { weight: 0.3, score: 72.6105, available: true },
      { weight: 0.25, score: null, available: false },
      { weight: 0.3, score: 82.3832, available: true },
      { weight: 0.15, score: 78, available: true },
    ]);
    expect(overall).toBeCloseTo(77.5975, 4);
    expect(roundScore(overall!)).toBe(78);
  });

  it('drops Quality when it has no data and says so in the explanation', () => {
    const impact = computeImpact(
      {
        ...G1,
        small_pr_ratio: insufficient(2),
        revert_rate: insufficient(2),
        merge_rate: insufficient(2),
      },
      { periodDays: 31 },
    );
    expect(impact.dimensions.quality).toMatchObject({ available: false, score: null });
    expect(impact.overall).toBeCloseTo(77.5975, 3);
    expect(renderExplanation(impact, 'October 2026')).toContain(
      "Quality wasn't scored this period because there wasn't enough data; the other dimensions were re-weighted.",
    );
  });

  it('renormalises component weights inside a dimension', () => {
    const impact = computeImpact(
      { ...G1, pr_cycle_time_median_hours: insufficient(2) },
      { periodDays: 31 },
    );
    const d = impact.dimensions.delivery;
    // (0.5 × 68.8710 + 0.2 × 84) / 0.7
    expect(d.score).toBeCloseTo((0.5 * 68.871 + 0.2 * 84) / 0.7, 3);
    expect(d.components.map((c) => c.effectiveWeight)).toEqual([0.5 / 0.7, 0, 0.2 / 0.7]);
  });
});

describe('minimum-data thresholds (§5)', () => {
  it('prs_merged + prs_reviewed = 2 → insufficient_data, no scores', () => {
    const impact = computeImpact(
      { ...G1, prs_merged: ok(1), prs_reviewed: ok(1) },
      { periodDays: 31 },
    );
    expect(impact).toMatchObject({
      status: 'insufficient_data',
      overall: null,
      reason: 'not_enough_activity',
    });
    expect(impact.dimensions.delivery.score).toBeNull();
    expect(impact.dimensions.delivery.components[0]).toMatchObject({
      value: 1,
      band: null,
      shrunk: null,
    });
    expect(renderExplanation(impact, 'October 2026')).toContain(
      'Not enough activity in this period to compute a fair score — try a longer period.',
    );
  });

  it('prs_merged + prs_reviewed = 3 is enough', () => {
    expect(
      computeImpact({ ...G1, prs_merged: ok(1), prs_reviewed: ok(2) }, { periodDays: 31 }).status,
    ).toBe('ok');
  });

  it('periodDays < 7 → insufficient; a 6-day custom period is rejected as an invalid period', () => {
    expect(computeImpact(G1, { periodDays: 6 }).reason).toBe('period_too_short');
    expect(() => parsePeriod('custom:2026-10-01..2026-10-06')).toThrow(PeriodError);
  });

  it('fewer than 2 available dimensions → insufficient', () => {
    const impact = computeImpact({ prs_merged: ok(6) }, { periodDays: 31 });
    expect(impact.reason).toBe('too_few_dimensions');
  });
});

describe('bands and shrinkage', () => {
  it('clamps outside the anchors and interpolates linearly', () => {
    const anchors = [
      [0, 0],
      [2, 40],
      [4, 60],
    ] as const;
    expect(band(-1, anchors)).toBe(0);
    expect(band(1, anchors)).toBe(20);
    expect(band(3, anchors)).toBe(50);
    expect(band(99, anchors)).toBe(60);
  });

  it('pulls small samples toward 50 (k = 3)', () => {
    expect(shrunk(100, 0)).toBe(50);
    expect(shrunk(100, 3)).toBe(75);
    expect(shrunk(81.875, 6)).toBeCloseTo(71.25, 10);
  });

  it('scores stay within 0–100 for any inputs (property)', () => {
    fc.assert(
      fc.property(
        fc.record({
          merged: fc.integer({ min: 0, max: 200 }),
          reviewed: fc.integer({ min: 0, max: 200 }),
          ratio: fc.double({ min: 0, max: 1, noNaN: true }),
          hours: fc.double({ min: 0, max: 2000, noNaN: true }),
          n: fc.integer({ min: 3, max: 100 }),
          days: fc.integer({ min: 7, max: 366 }),
        }),
        ({ merged, reviewed, ratio, hours, n, days }) => {
          const impact = computeImpact(
            {
              prs_merged: ok(merged),
              prs_reviewed: ok(reviewed),
              pr_cycle_time_median_hours: ok(hours, n),
              review_turnaround_median_hours: ok(hours, n),
              active_weeks_ratio: ok(ratio, 5),
              small_pr_ratio: ok(ratio, n),
              revert_rate: ok(ratio, n),
              merge_rate: ok(ratio, n),
              review_balance: ok(ratio, n),
              two_way_repos: ok(Math.min(merged, 9)),
              repos_contributed: ok(Math.min(merged + reviewed, 20)),
            },
            { periodDays: days },
          );
          if (impact.overall !== null) {
            expect(impact.overall).toBeGreaterThanOrEqual(0);
            expect(impact.overall).toBeLessThanOrEqual(100);
          }
        },
      ),
    );
  });
});

describe('stored inputs reproduce the score (§6.6) and determinism (§10.4)', () => {
  const period = {
    type: 'month' as const,
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    timezone: 'UTC',
    periodDays: 31,
  };

  it('golden dataset: overall 64 (Delivery 67, Quality 50, Collaboration 65, Ownership 78)', () => {
    // Hand computation for the golden dataset in metric-definitions.spec.ts:
    // Delivery 0.5×56.1290 (per28 3.6129) + 0.3×73.8571 (band 91.75, n 4) + 0.2×84 = 67.0217
    // Quality 0.4×63.3333 (band 76.6667, n 3) + 0.35×21.4286 (band 0, n 4) + 0.25×68.75 (band 80, n 5) = 50.0208
    // Collaboration 0.5×53.4409 + 0.3×70 (band 90, n 3) + 0.2×86.3636 (band 100, n 8) = 64.9932
    // Ownership 0.6×80 + 0.4×75 = 78 → overall 0.3×67.0217 + 0.25×50.0208 + 0.3×64.9932 + 0.15×78 = 63.8097
    const { inputs, impact } = buildImpactInputs(computeMetrics(GOLDEN_FACTS, OCTOBER), period);
    expect(impact.dimensions.delivery.score).toBeCloseTo(67.021659, 5);
    expect(impact.dimensions.quality.score).toBeCloseTo(50.020833, 5);
    expect(impact.dimensions.collaboration.score).toBeCloseTo(64.993157, 5);
    expect(impact.dimensions.ownership.score).toBeCloseTo(78, 10);
    expect(impact.overall).toBeCloseTo(63.809653, 5);
    expect(roundScore(inputs.overall!)).toBe(64);
    expect(inputs.scoreVersion).toBe('impact@2.0.0');
    expect(inputs.metricsVersion).toBe('metrics@2.1.0');
    expect(inputs.evidence.prs_merged).toEqual(['P3', 'P2', 'P1', 'P4']);
  });

  it('recomputing from the stored JSON reproduces overall and every dimension exactly', () => {
    const { inputs } = buildImpactInputs(computeMetrics(GOLDEN_FACTS, OCTOBER), period);
    const stored = JSON.parse(JSON.stringify(inputs)) as typeof inputs;
    const again = computeImpact(stored.metrics, stored.period);
    expect(again.overall).toBe(inputs.overall);
    for (const key of ['delivery', 'quality', 'collaboration', 'ownership'] as const) {
      expect(again.dimensions[key].score).toBe(inputs.dimensions[key].score);
    }
  });

  it('two runs with the same inputs are byte-identical', () => {
    const a = buildImpactInputs(computeMetrics(GOLDEN_FACTS, OCTOBER), period).inputs;
    const b = buildImpactInputs(computeMetrics(GOLDEN_FACTS, OCTOBER), period).inputs;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
