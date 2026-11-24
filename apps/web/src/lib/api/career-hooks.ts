'use client';

import {
  AchievementDto,
  DeletedResponse,
  DigestPreviewResponse,
  Entitlements,
  GoalDetailDto,
  GoalDto,
  UnsubscribeResponse,
  type AchievementCategoryWire,
  type AchievementInput,
  type GoalInput,
  type GoalStatusWire,
  type UpdateAchievementInput,
  type UpdateGoalInput,
} from '@devimpact/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';

import { apiClient, publicApiClient } from './browser';
import { saveBlob } from './document-hooks';
import { qk } from './query-keys';

/**
 * Career OS hooks (API_CONTRACT_V2 §5, §15–§17; S17, S18, S20–S24). Saving an achievement refreshes
 * every view that shows it: the journal, goals, the activity feed, career and the dashboard.
 */

export interface AchievementListParams {
  category?: AchievementCategoryWire;
  period?: string;
  q?: string;
}

const PAGE = 30;

export function useAchievements(
  params: AchievementListParams,
  options: { enabled?: boolean } = {},
) {
  const key = { category: params.category, period: params.period, q: params.q || undefined };
  return useInfiniteQuery({
    queryKey: qk.achievements.list(key),
    queryFn: ({ signal, pageParam }) =>
      apiClient.getPage('/achievements', {
        schema: AchievementDto,
        query: { ...key, limit: PAGE, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.meta.hasMore ? (last.meta.nextCursor ?? undefined) : undefined,
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useAchievement(id: string | null) {
  return useQuery({
    queryKey: qk.achievements.detail(id ?? ''),
    queryFn: ({ signal }) =>
      apiClient.get(`/achievements/${encodeURIComponent(id ?? '')}`, {
        schema: AchievementDto,
        signal,
      }),
    enabled: id !== null,
  });
}

function refreshCareer(queryClient: QueryClient) {
  for (const key of [qk.achievements.all, qk.goals.all, qk.activity.all, qk.career.all]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

export function useSaveAchievement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id?: string; body: AchievementInput | UpdateAchievementInput }) =>
      vars.id
        ? apiClient.patch(`/achievements/${encodeURIComponent(vars.id)}`, {
            body: vars.body,
            schema: AchievementDto,
          })
        : apiClient.post('/achievements', { body: vars.body, schema: AchievementDto }),
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.achievements.detail(saved.id), saved);
      refreshCareer(queryClient);
    },
  });
}

export function useDeleteAchievement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/achievements/${encodeURIComponent(id)}`, { schema: DeletedResponse }),
    onSuccess: (_r, id) => {
      queryClient.removeQueries({ queryKey: qk.achievements.detail(id) });
      refreshCareer(queryClient);
    },
  });
}

export function useGoals(
  params: { status?: GoalStatusWire } = {},
  options: { enabled?: boolean } = {},
) {
  const key = { status: params.status };
  return useQuery({
    queryKey: qk.goals.list(key),
    queryFn: ({ signal }) =>
      apiClient.getPage('/goals', { schema: GoalDto, query: { ...key, limit: 100 }, signal }),
    enabled: options.enabled ?? true,
  });
}

export function useGoal(id: string | null) {
  return useQuery({
    queryKey: qk.goals.detail(id ?? ''),
    queryFn: ({ signal }) =>
      apiClient.get(`/goals/${encodeURIComponent(id ?? '')}`, { schema: GoalDetailDto, signal }),
    enabled: id !== null,
  });
}

export function useSaveGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id?: string; body: GoalInput | UpdateGoalInput }) =>
      vars.id
        ? apiClient.patch(`/goals/${encodeURIComponent(vars.id)}`, {
            body: vars.body,
            schema: GoalDto,
          })
        : apiClient.post('/goals', { body: vars.body, schema: GoalDto }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.goals.all });
      void queryClient.invalidateQueries({ queryKey: qk.achievements.all });
    },
  });
}

export function useDeleteGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/goals/${encodeURIComponent(id)}`, { schema: DeletedResponse }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.goals.all });
      void queryClient.invalidateQueries({ queryKey: qk.achievements.all });
    },
  });
}

export function useEntitlements() {
  return useQuery({
    queryKey: qk.entitlements.detail(),
    queryFn: ({ signal }) => apiClient.get('/me/entitlements', { schema: Entitlements, signal }),
    staleTime: 5 * 60_000,
  });
}

export function useDigestPreview() {
  return useMutation({
    mutationFn: () =>
      apiClient.post('/notifications/digest/preview', { body: {}, schema: DigestPreviewResponse }),
  });
}

/** `GET /me/export` → saves `devimpact-export-<date>.json` (F-04). */
export function useExportData() {
  return useMutation({
    mutationFn: async () => {
      const { blob, filename } = await apiClient.download('/me/export');
      const name = filename ?? `devimpact-export-${new Date().toISOString().slice(0, 10)}.json`;
      saveBlob(blob, name);
      return name;
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (confirmEmail: string) =>
      apiClient.delete('/me', {
        body: { confirmEmail },
        schema: z.object({ deleted: z.literal(true) }),
      }),
  });
}

/** Public: unsubscribe from an email link (no session). */
export function useUnsubscribe() {
  return useMutation({
    mutationFn: (token: string) =>
      publicApiClient.post('/notifications/unsubscribe', {
        body: { token },
        schema: UnsubscribeResponse,
      }),
  });
}
