'use client';

import {
  IntegrationDto,
  MeDto,
  RepoBulkResult,
  RepositoryDto,
  SettingsDto,
  SyncAccepted,
  SyncStatusDto,
  type RepoBulkPatch,
  type SyncStateWire,
  type UpdateSettingsInput,
} from '@devimpact/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { z } from 'zod';

import { apiClient } from './browser';
import { isApiError } from './errors';
import { qk, SYNC_DEPENDENT_KEYS } from './query-keys';

// ── Me & settings (API_CONTRACT_V2 §5) ───────────────────────────────────────────────────────

export function useMe() {
  return useQuery({
    queryKey: qk.me.detail(),
    queryFn: ({ signal }) => apiClient.get('/me', { schema: MeDto, signal }),
    staleTime: 60_000,
  });
}

/** `PATCH /me/settings` — updates the cached `/me` in place (no refetch round trip). */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) =>
      apiClient.patch('/me/settings', { body: input, schema: SettingsDto }),
    onSuccess: (settings) => {
      queryClient.setQueryData<MeDto>(qk.me.detail(), (me) =>
        me
          ? {
              ...me,
              settings,
              onboarding: {
                step: settings.onboardingStep,
                completed: settings.onboardingCompletedAt !== null,
              },
            }
          : me,
      );
    },
  });
}

// ── Integrations (§6) ─────────────────────────────────────────────────────────────────────────

export function useIntegrations(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.integrations.list(),
    queryFn: ({ signal }) =>
      apiClient.get('/integrations', { schema: z.array(IntegrationDto), signal }),
    enabled: options.enabled ?? true,
  });
}

// ── Sync (§8): polling contract, GAP-11 (no /sync/stream) ────────────────────────────────────

const ACTIVE_STATES = new Set<SyncStateWire>(['queued', 'running']);

/** Poll interval for a sync state (API_CONTRACT_V2 §8): 2 s active, 30 s rate-limited, else off. */
export function syncPollInterval(state: SyncStateWire | null | undefined): number | false {
  if (!state) return false;
  if (ACTIVE_STATES.has(state)) return 2_000;
  if (state === 'waiting_rate_limit') return 30_000;
  return false;
}

export function isSyncActive(status: SyncStatusDto | null | undefined): boolean {
  return !!status && (ACTIVE_STATES.has(status.state) || status.state === 'waiting_rate_limit');
}

/**
 * `GET /sync/status` with state-driven polling. `data === null` means "not connected" (the API
 * answers 404 when the user has no GitHub integration). When a run stops being active, metrics,
 * impact, career, activity, repos and `/me` are invalidated so pages refresh in place (FLOWS F4).
 */
export function useSyncStatus(options: { enabled?: boolean; integrationId?: string } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.sync.status(options.integrationId),
    queryFn: async ({ signal }) => {
      try {
        return await apiClient.get('/sync/status', {
          schema: SyncStatusDto,
          query: { integrationId: options.integrationId },
          signal,
        });
      } catch (error) {
        if (isApiError(error) && error.code === 'NOT_FOUND') return null;
        throw error;
      }
    },
    enabled: options.enabled ?? true,
    refetchInterval: (q) => syncPollInterval(q.state.data?.state),
    staleTime: 10_000,
  });

  const previous = useRef<SyncStateWire | null | undefined>(undefined);
  const state = query.data?.state ?? null;
  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    if (before && ACTIVE_STATES.has(before) && (!state || !ACTIVE_STATES.has(state))) {
      for (const key of SYNC_DEPENDENT_KEYS) void queryClient.invalidateQueries({ queryKey: key });
    }
  }, [state, queryClient]);

  return query;
}

/**
 * `POST /sync`. A 409 `SYNC_IN_PROGRESS` is not an error for the user ("show the current run",
 * FLOWS F4): the status query is refetched and the mutation resolves with `alreadyRunning`.
 */
export function useStartSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (integrationId?: string) => {
      try {
        const accepted = await apiClient.post('/sync', {
          body: integrationId ? { integrationId } : {},
          schema: SyncAccepted,
        });
        return { alreadyRunning: false, syncRun: accepted.syncRun };
      } catch (error) {
        if (isApiError(error) && error.code === 'SYNC_IN_PROGRESS') {
          return { alreadyRunning: true, syncRun: null };
        }
        throw error;
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.sync.all }),
  });
}

// ── Repositories (§7) ─────────────────────────────────────────────────────────────────────────

export interface RepoListParams {
  integrationId?: string;
  sort?: 'fullName' | '-lastActivityAt';
  limit?: number;
  q?: string;
  [key: string]: string | number | boolean | undefined;
}

export function useRepos(params: RepoListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.repos.list(params),
    queryFn: ({ signal }) =>
      apiClient.getPage('/repos', { schema: RepositoryDto, query: params, signal }),
    enabled: options.enabled ?? true,
  });
}

export function useUpdateRepos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RepoBulkPatch) =>
      apiClient.patch('/repos', { body: input, schema: RepoBulkResult }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.repos.all }),
  });
}
