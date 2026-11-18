import { describe, expect, it } from 'vitest';

import { syncPollInterval, isSyncActive } from './hooks';
import { qk, SYNC_DEPENDENT_KEYS } from './query-keys';

describe('query keys', () => {
  it('start with the domain so a domain can be invalidated at once', () => {
    expect(qk.metrics.overview('month:2026-10').slice(0, 1)).toEqual(qk.metrics.all);
    expect(qk.metrics.overview(undefined)).toEqual(['metrics', 'overview', 'default']);
    expect(qk.documents.detail('cm1')).toEqual(['documents', 'detail', 'cm1', 'current']);
    expect(SYNC_DEPENDENT_KEYS).toContainEqual(qk.metrics.all);
  });
});

describe('sync polling contract (API_CONTRACT_V2 §8)', () => {
  it('polls every 2 s while queued/running, 30 s while rate-limited, otherwise stops', () => {
    expect(syncPollInterval('queued')).toBe(2000);
    expect(syncPollInterval('running')).toBe(2000);
    expect(syncPollInterval('waiting_rate_limit')).toBe(30_000);
    for (const s of ['idle', 'failed', 'needs_reauth', null, undefined] as const)
      expect(syncPollInterval(s)).toBe(false);
  });

  it('treats queued/running/rate-limited as active', () => {
    expect(isSyncActive(null)).toBe(false);
    expect(isSyncActive({ state: 'waiting_rate_limit' } as never)).toBe(true);
    expect(isSyncActive({ state: 'idle' } as never)).toBe(false);
  });
});
