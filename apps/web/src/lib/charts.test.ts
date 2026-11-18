import { describe, expect, it } from 'vitest';

import { sparklinePath } from '@/components/sparkline';

import {
  activityAriaSummary,
  activityTotals,
  bucketActivity,
  chooseInterval,
  columnsAriaSummary,
  daysBetween,
  formatAxis,
  formatUnitValue,
  lineAriaSummary,
  niceTicks,
  timeseriesColumns,
} from './charts';
import { plural } from './format';
import { appraisalTarget, pickNextStep, type NextStepInput } from './next-step';
import { longerPeriod } from './period';

const day = (date: string, commits = 0, prsMerged = 0, reviews = 0) => ({
  date,
  commits,
  prsMerged,
  reviews,
});

describe('chart helpers (DESIGN_SYSTEM §5.2 ActivityChart, §6)', () => {
  it('chooses the interval: day ≤ 45 days, week ≤ 200, month above', () => {
    expect(chooseInterval(30)).toBe('day');
    expect(chooseInterval(45)).toBe('day');
    expect(chooseInterval(46)).toBe('week');
    expect(chooseInterval(200)).toBe('week');
    expect(chooseInterval(201)).toBe('month');
    expect(daysBetween('2026-11-01', '2026-11-30')).toBe(30);
  });

  it('buckets days, filling missing days with zero', () => {
    const rows = bucketActivity(
      [day('2026-11-02', 2, 1), day('2026-11-04', 0, 0, 3)],
      '2026-11-01',
      '2026-11-04',
      'day',
      2026,
    );
    expect(rows.map((r) => [r.start, r.commits, r.prsMerged, r.reviews])).toEqual([
      ['2026-11-01', 0, 0, 0],
      ['2026-11-02', 2, 1, 0],
      ['2026-11-03', 0, 0, 0],
      ['2026-11-04', 0, 0, 3],
    ]);
    expect(rows[0]).toMatchObject({ label: 'Sun, Nov 1', short: 'Nov 1' });
  });

  it('ISO weeks are Monday-based and clipped to the range', () => {
    const rows = bucketActivity(
      [day('2026-10-01', 1), day('2026-10-05', 2), day('2026-10-12', 3)],
      '2026-10-01',
      '2026-10-14',
      'week',
      2026,
    );
    expect(rows.map((r) => [r.start, r.end, r.commits])).toEqual([
      ['2026-10-01', '2026-10-04', 1],
      ['2026-10-05', '2026-10-11', 2],
      ['2026-10-12', '2026-10-14', 3],
    ]);
    expect(rows[1].label).toBe('Oct 5 – Oct 11');
  });

  it('months use calendar months', () => {
    const rows = bucketActivity(
      [day('2026-01-31', 1), day('2026-02-01', 2)],
      '2026-01-15',
      '2026-02-10',
      'month',
    );
    expect(rows.map((r) => [r.label, r.short, r.commits])).toEqual([
      ['Jan 2026', 'Jan', 1],
      ['Feb 2026', 'Feb', 2],
    ]);
  });

  it('summarises the chart for screen readers with totals', () => {
    const rows = bucketActivity([day('2026-11-02', 1, 1, 2)], '2026-11-01', '2026-11-03', 'day');
    expect(activityTotals(rows)).toEqual({ commits: 1, prsMerged: 1, reviews: 2 });
    expect(activityAriaSummary(rows, 'day', 'November 2026')).toBe(
      'Stacked columns of commits, PRs merged and reviews per day for November 2026. Totals: 1 commit, 1 PR merged, 2 reviews.',
    );
  });

  it('axis ticks are 0, mid, max on clean numbers; compact above 10,000', () => {
    expect(niceTicks(3)).toEqual([0, 2, 4]);
    expect(niceTicks(7)).toEqual([0, 4, 8]);
    expect(niceTicks(130)).toEqual([0, 100, 200]);
    expect(formatAxis(1284)).toBe('1,284');
    expect(formatAxis(12000)).toBe('12K');
  });

  it('formats metric units (§6 number formatting) and never shows 0 for unknown', () => {
    expect(formatUnitValue(0.834, 'ratio')).toBe('83%');
    expect(formatUnitValue(30, 'hours')).toBe('30.0 h');
    expect(formatUnitValue(1284, 'count')).toBe('1,284');
    expect(formatUnitValue(null, 'count')).toBe('—');
  });

  it('timeseries columns and summaries', () => {
    const cols = timeseriesColumns({
      metric: 'merge_rate',
      interval: 'month',
      unit: 'ratio',
      timezone: 'UTC',
      points: [
        { start: '2026-10-01', end: '2026-10-31', value: 0.8, n: 5 },
        { start: '2026-11-01', end: '2026-11-18', value: null, n: 1 },
      ],
    });
    expect(cols.map((c) => c.short)).toEqual(['Oct', 'Nov']);
    expect(columnsAriaSummary(cols, 'Merge rate', 'ratio')).toBe(
      'Columns of Merge rate per month from Oct 2026 to Nov 2026. Latest: not enough data. 1 of 2 months have enough data.',
    );
    expect(
      lineAriaSummary(
        [
          { label: 'Oct 2026', short: 'Oct', value: null },
          { label: 'Nov 2026', short: 'Nov', value: 77 },
        ],
        'impact score',
      ),
    ).toMatch(
      /Latest 77 \(Nov 2026\); range 77–77. 1 months without enough data are shown as gaps./,
    );
  });

  it('sparkline breaks the path at gaps and needs two values', () => {
    expect(sparklinePath([1])).toBe('');
    expect(sparklinePath([1, null, 2, 3]).match(/M/g)).toHaveLength(2);
  });

  it('BUG-13: plurals', () => {
    expect(plural(1, 'commit')).toBe('1 commit');
    expect(plural(2, 'commit')).toBe('2 commits');
    expect(plural(1, 'repository', 'repositories')).toBe('1 repository');
  });
});

describe('Next step rules (S6, F-24)', () => {
  const base: NextStepInput = {
    today: '2026-11-18',
    timezone: 'Europe/London',
    defaultPeriodType: 'month',
    needsReconnect: false,
    suspendedOrg: null,
    lastSyncFailed: false,
    appraisalPeriods: [],
    newestResumeAt: undefined,
    dismissed: {},
    now: Date.parse('2026-11-18T12:00:00Z'),
  };

  it('first match wins: reconnect → failed sync → appraisal → resume → impact', () => {
    expect(pickNextStep({ ...base, needsReconnect: true, lastSyncFailed: true }).rule).toBe(
      'reconnect',
    );
    expect(pickNextStep({ ...base, lastSyncFailed: true }).rule).toBe('sync_failed');
    expect(pickNextStep(base)).toMatchObject({
      rule: 'appraisal',
      periodSpec: 'half:2026-H2',
      daysLeft: 43,
    });
    expect(
      pickNextStep({
        ...base,
        appraisalPeriods: ['half:2026-H2'],
        newestResumeAt: '2026-06-01T00:00:00Z',
      }).rule,
    ).toBe('resume');
    expect(pickNextStep({ ...base, appraisalPeriods: ['half:2026-H2'] }).rule).toBe('impact');
  });

  it('appraisal rule only applies within 60 days of the end; quarter users get the quarter', () => {
    expect(pickNextStep({ ...base, today: '2026-08-01' }).rule).toBe('impact');
    expect(appraisalTarget('2026-11-18', 'UTC', 'quarter')).toMatchObject({
      spec: 'quarter:2026-Q4',
      daysLeft: 43,
    });
  });

  it('"Not now" hides a rule until it expires', () => {
    const now = base.now;
    expect(pickNextStep({ ...base, dismissed: { appraisal: now + 1000 } }).rule).toBe('impact');
    expect(pickNextStep({ ...base, dismissed: { appraisal: now - 1000 } }).rule).toBe('appraisal');
  });

  it('suggests a longer period for the no-data state', () => {
    const month = {
      spec: 'month:2026-11',
      type: 'month',
      startDate: '2026-11-01',
      endDate: '2026-11-18',
      timezone: 'UTC',
      periodDays: 30,
      inProgress: true,
      label: 'November 2026',
    } as const;
    expect(longerPeriod(month, 'UTC', '2026-11-18')).toEqual({
      spec: 'quarter:2026-Q4',
      label: 'Q4 2026',
    });
    expect(longerPeriod({ ...month, type: 'year' }, 'UTC', '2026-11-18')).toBeNull();
  });
});
