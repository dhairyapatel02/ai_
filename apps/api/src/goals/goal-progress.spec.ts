import { evaluationMonthSpec, progressOf } from './goal-progress';

describe('goal progress (API_CONTRACT_V2 §16)', () => {
  it('evaluates the most recent complete month, or this month for goals started this month', () => {
    expect(evaluationMonthSpec('2026-07-01', '2026-11-24')).toBe('month:2026-10');
    expect(evaluationMonthSpec('2026-11-01', '2026-11-24')).toBe('month:2026-11');
    expect(evaluationMonthSpec('2026-11-20', '2026-11-24')).toBe('month:2026-11');
    expect(evaluationMonthSpec('2026-10-31', '2027-01-03')).toBe('month:2026-12');
  });

  it('met / not met / no data / no metric', () => {
    const period = null;
    const ok = (value: number) => ({ value, n: 5, status: 'ok' as const });
    expect(progressOf({ comparator: 'lte', targetValue: 8 }, ok(8), period).status).toBe('met');
    expect(progressOf({ comparator: 'lte', targetValue: 8 }, ok(8.1), period).status).toBe(
      'not_met',
    );
    expect(progressOf({ comparator: 'gte', targetValue: 3 }, ok(3), period)).toEqual({
      current: 3,
      target: 3,
      status: 'met',
      evaluatedPeriod: null,
    });
    expect(
      progressOf(
        { comparator: 'gte', targetValue: 3 },
        { value: 2, n: 1, status: 'insufficient_data' },
        period,
      ),
    ).toMatchObject({ status: 'no_data', current: null });
    expect(progressOf({ comparator: 'gte', targetValue: 3 }, undefined, period).status).toBe(
      'no_data',
    );
    expect(progressOf(null, ok(1), period)).toEqual({
      current: null,
      target: null,
      status: 'no_metric',
      evaluatedPeriod: null,
    });
  });
});
