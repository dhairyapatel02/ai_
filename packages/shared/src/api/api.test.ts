import { describe, expect, it } from 'vitest';

import { addDays, startOfLocalDay, toUtcRange } from '../time/zoned';
import { ActivityListQuery } from './activity';
import { ERROR_CODES, ERROR_STATUS, Id, PageQuery, QueryBoolean } from './common';
import { GitHubCallbackInput } from './integrations';
import { TimeZone, UpdateSettingsInput } from './me';

describe('API primitives', () => {
  it('every error code has an HTTP status', () => {
    for (const code of ERROR_CODES) expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
  });

  it('PageQuery coerces and caps limit at 100, rejects unknown keys', () => {
    expect(PageQuery.parse({ limit: '50' })).toEqual({ limit: 50 });
    expect(PageQuery.parse({})).toEqual({ limit: 20 });
    expect(PageQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: '-5' }).success).toBe(false);
    expect(PageQuery.safeParse({ page: '1' }).success).toBe(false);
  });

  it('Id accepts Prisma cuids only', () => {
    expect(Id.safeParse('cmwiz5gbs00007djehecr9v61').success).toBe(true);
    expect(Id.safeParse('nope').success).toBe(false);
    expect(Id.safeParse("c' OR 1=1 --").success).toBe(false);
  });

  it('QueryBoolean only accepts "true"/"false"', () => {
    expect(QueryBoolean.parse('false')).toBe(false);
    expect(QueryBoolean.parse('true')).toBe(true);
    expect(QueryBoolean.safeParse('1').success).toBe(false);
  });
});

describe('ActivityListQuery', () => {
  it('accepts local dates and ISO timestamps, rejects garbage and inverted ranges', () => {
    expect(
      ActivityListQuery.safeParse({ from: '2026-10-01', to: '2026-10-31T23:59:59Z' }).success,
    ).toBe(true);
    expect(ActivityListQuery.safeParse({ from: 'garbage' }).success).toBe(false);
    expect(ActivityListQuery.safeParse({ from: '2026-10-10', to: '2026-10-01' }).success).toBe(
      false,
    );
  });
});

describe('GitHubCallbackInput', () => {
  it('requires a code unless the user cancelled or approval is pending', () => {
    expect(GitHubCallbackInput.safeParse({ state: 's' }).success).toBe(false);
    expect(GitHubCallbackInput.safeParse({ state: 's', code: 'c' }).success).toBe(true);
    expect(GitHubCallbackInput.safeParse({ state: 's', error: 'access_denied' }).success).toBe(
      true,
    );
    expect(GitHubCallbackInput.safeParse({ state: 's', setupAction: 'request' }).success).toBe(
      true,
    );
    expect(
      GitHubCallbackInput.safeParse({ state: 's', code: 'c', installationId: '12x' }).success,
    ).toBe(false);
  });
});

describe('settings', () => {
  it('validates IANA time zones', () => {
    expect(TimeZone.safeParse('Europe/Berlin').success).toBe(true);
    expect(TimeZone.safeParse('UTC').success).toBe(true);
    expect(TimeZone.safeParse('Mars/Olympus').success).toBe(false);
  });

  it('never lets a client set plan or other unknown fields', () => {
    expect(UpdateSettingsInput.safeParse({ plan: 'pro' }).success).toBe(false);
  });
});

describe('time zone helpers (D-019, BUG-05)', () => {
  it('finds the UTC start of a local day, across DST changes', () => {
    expect(startOfLocalDay('2026-10-23', 'UTC').toISOString()).toBe('2026-10-23T00:00:00.000Z');
    expect(startOfLocalDay('2026-10-23', 'America/New_York').toISOString()).toBe(
      '2026-10-23T04:00:00.000Z',
    );
    expect(startOfLocalDay('2026-11-02', 'America/New_York').toISOString()).toBe(
      '2026-11-02T05:00:00.000Z',
    );
    expect(startOfLocalDay('2026-03-29', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    );
    expect(startOfLocalDay('2026-01-01', 'Asia/Kolkata').toISOString()).toBe(
      '2025-12-31T18:30:00.000Z',
    );
  });

  it('adds calendar days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('turns inclusive date bounds into a half-open UTC range', () => {
    expect(toUtcRange({ from: '2026-10-23', to: '2026-10-23' }, 'UTC')).toEqual({
      gte: new Date('2026-10-23T00:00:00Z'),
      lt: new Date('2026-10-24T00:00:00Z'),
    });
    expect(toUtcRange({ to: '2026-10-23T12:00:00Z' }, 'UTC')).toEqual({
      lt: new Date('2026-10-23T12:00:00.001Z'),
    });
  });
});
