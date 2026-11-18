import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  inclusionChanges,
  isRecentlyActive,
} from '@/app/(onboarding)/onboarding/repositories/repositories-step';
import { syncPhase } from '@/app/(onboarding)/onboarding/sync/sync-step';
import {
  callbackBody,
  callbackErrorKey,
} from '@/app/(system)/integrations/github/callback/github-callback';
import { ApiError } from '@/lib/api/errors';

import { syncRun, syncStatus } from '../../../test/fixtures';
import { OnboardingStepper } from './onboarding-stepper';
import { stageIndex } from './sync-stages';

import type { RepositoryDto } from '@devimpact/shared';

const repo = (id: string, included: boolean, lastActivityAt: string | null = null) =>
  ({ id, included, lastActivityAt }) as RepositoryDto;

describe('onboarding', () => {
  it('stepper marks the current step', () => {
    render(<OnboardingStepper current={1} />);
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveTextContent('(done)');
  });

  it('only sends repositories whose inclusion changed', () => {
    const repos = [repo('a', true), repo('b', false), repo('c', true)];
    expect(inclusionChanges(repos, { a: true, b: true, c: false })).toEqual({
      include: ['b'],
      exclude: ['c'],
    });
    expect(inclusionChanges(repos, {})).toEqual({ include: [], exclude: [] });
  });

  it('recently active = activity in the last 12 months', () => {
    const now = Date.parse('2026-11-18T00:00:00Z');
    expect(isRecentlyActive(repo('a', true, '2026-01-01T00:00:00Z'), now)).toBe(true);
    expect(isRecentlyActive(repo('a', true, '2025-01-01T00:00:00Z'), now)).toBe(false);
    expect(isRecentlyActive(repo('a', true, null), now)).toBe(false);
  });

  it('maps sync status to wizard phases (S5)', () => {
    expect(syncPhase(null).phase).toBe('not_connected');
    expect(
      syncPhase(
        syncStatus({
          state: 'queued',
          currentRun: syncRun({ status: 'queued', stage: 'prepare' }),
        }),
      ).phase,
    ).toBe('preparing');
    expect(syncPhase(syncStatus({ state: 'running', currentRun: syncRun() })).phase).toBe(
      'running',
    );
    expect(
      syncPhase(syncStatus({ state: 'waiting_rate_limit', currentRun: syncRun() })).phase,
    ).toBe('rate_limited');
    expect(
      syncPhase(
        syncStatus({
          lastRun: syncRun({ status: 'succeeded', stage: 'done', counts: { commits: 3 } }),
        }),
      ).phase,
    ).toBe('done');
    expect(
      syncPhase(
        syncStatus({ lastRun: syncRun({ status: 'succeeded', stage: 'done', counts: {} }) }),
      ).phase,
    ).toBe('done_empty');
    expect(syncPhase(syncStatus()).phase).toBe('not_started');
    expect(
      syncPhase(syncStatus({ state: 'failed', lastRun: syncRun({ status: 'failed' }) })).phase,
    ).toBe('failed');
  });

  it('maps engine stages to the five display stages', () => {
    expect(stageIndex('prepare')).toBe(0);
    expect(stageIndex('persist')).toBe(3);
    expect(stageIndex('done')).toBe(5);
  });

  it('forwards GitHub callback params with contract names and maps errors to banners', () => {
    expect(
      callbackBody({
        code: 'c',
        state: 's',
        installation_id: '42',
        setup_action: 'install',
        other: 'x',
      }),
    ).toEqual({
      code: 'c',
      state: 's',
      installationId: '42',
      setupAction: 'install',
    });
    expect(callbackErrorKey(new ApiError({ code: 'OAUTH_DENIED', message: '', status: 400 }))).toBe(
      'denied',
    );
    expect(
      callbackErrorKey(new ApiError({ code: 'OAUTH_STATE_INVALID', message: '', status: 400 })),
    ).toBe('expired');
    expect(
      callbackErrorKey(
        new ApiError({ code: 'INTEGRATION_ACCOUNT_IN_USE', message: '', status: 409 }),
      ),
    ).toBe('in_use');
    expect(callbackErrorKey(new Error('x'))).toBe('failed');
  });
});
