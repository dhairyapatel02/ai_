import { describe, expect, it } from 'vitest';

import { ApiError, errorMessage, quotaDetails } from './errors';

describe('errorMessage', () => {
  it('turns codes into calm, actionable copy (no raw payloads, UX-05)', () => {
    expect(
      errorMessage(
        new ApiError({ code: 'NETWORK_ERROR', message: 'x', status: 0 }),
        'your dashboard',
      ),
    ).toMatch(/Couldn't load your dashboard. The DevImpact API didn't respond/);
    expect(
      errorMessage(new ApiError({ code: 'INTERNAL', message: 'stack trace…', status: 500 })),
    ).not.toContain('stack');
    expect(
      errorMessage(new ApiError({ code: 'INVALID_PERIOD', message: 'x', status: 400 })),
    ).toMatch(/7–366 days/);
    expect(errorMessage(new Error('boom'), 'KPIs')).toBe(
      "Couldn't load KPIs. Try again in a moment.",
    );
  });

  it('names the quota reset date', () => {
    const error = new ApiError({
      code: 'QUOTA_EXCEEDED',
      message: 'x',
      status: 402,
      details: {
        feature: 'generations',
        used: 15,
        limit: 15,
        resetsAt: '2026-12-01T00:00:00.000Z',
      },
    });
    expect(quotaDetails(error)).toEqual({
      feature: 'generations',
      used: 15,
      limit: 15,
      resetsAt: '2026-12-01T00:00:00.000Z',
    });
    expect(errorMessage(error)).toBe(
      "You've used all 15 generations this month. They reset on Dec 1.",
    );
  });

  it('gives the retry time for rate limits', () => {
    const error = new ApiError({
      code: 'RATE_LIMITED',
      message: 'x',
      status: 429,
      retryAfterSeconds: 60,
    });
    expect(errorMessage(error)).toMatch(/You can try again at \d{2}:\d{2}\./);
  });
});
