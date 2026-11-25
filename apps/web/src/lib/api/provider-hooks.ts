'use client';

import {
  ConnectProviderResult,
  IdentityDto,
  IntegrationDetail,
  IssueDetail,
  ProviderBreakdownResponse,
  type ConnectReturnTo,
  type OAuthProviderWire,
  type UpdateIntegrationInput,
} from '@devimpact/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { CONNECT_RETURN_KEY } from '@/lib/onboarding';

import { apiClient } from './browser';
import { qk, SYNC_DEPENDENT_KEYS } from './query-keys';

/** `GET /integrations/providers` entry (P13). */
export const ProviderAvailability = z.object({
  provider: z.enum(['github', 'gitlab', 'jira', 'linear']),
  category: z.enum(['code', 'issues']),
  configured: z.boolean(),
  instances: z.array(z.object({ url: z.url(), label: z.string() })),
});
export type ProviderAvailability = z.infer<typeof ProviderAvailability>;

export function useProviders() {
  return useQuery({
    queryKey: qk.integrations.providers(),
    queryFn: ({ signal }) =>
      apiClient.get('/integrations/providers', { schema: z.array(ProviderAvailability), signal }),
    staleTime: 5 * 60_000,
  });
}

/** Starts a GitLab / Jira / Linear OAuth round trip (server-signed state, PKCE where supported). */
export async function startProviderConnect(
  provider: OAuthProviderWire,
  returnTo: ConnectReturnTo,
  baseUrl?: string,
): Promise<void> {
  const { url } = await apiClient.post(`/integrations/${provider}/connect`, {
    body: { returnTo, ...(baseUrl ? { baseUrl } : {}) },
    schema: ConnectProviderResult,
  });
  try {
    window.sessionStorage.setItem(CONNECT_RETURN_KEY, returnTo);
  } catch {
    // Storage blocked: callback errors fall back to Settings → Integrations.
  }
  window.location.assign(url);
}

export function useIdentities(integrationId: string | undefined) {
  return useQuery({
    queryKey: qk.integrations.identities(integrationId ?? 'none'),
    queryFn: ({ signal }) =>
      apiClient.get(`/integrations/${encodeURIComponent(integrationId ?? '')}/identities`, {
        schema: z.array(IdentityDto),
        signal,
      }),
    enabled: integrationId !== undefined,
  });
}

export function useAddIdentity(integrationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      apiClient.post(`/integrations/${encodeURIComponent(integrationId)}/identities`, {
        body: { email },
        schema: IdentityDto,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: qk.integrations.identities(integrationId) }),
  });
}

export function useRemoveIdentity(integrationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (identityId: string) =>
      apiClient.delete(
        `/integrations/${encodeURIComponent(integrationId)}/identities/${encodeURIComponent(identityId)}`,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: qk.integrations.identities(integrationId) }),
  });
}

/** `PATCH /integrations/:id` — Jira story points field (re-reads issues). */
export function useUpdateIntegration(integrationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateIntegrationInput) =>
      apiClient.patch(`/integrations/${encodeURIComponent(integrationId)}`, {
        body,
        schema: IntegrationDetail,
      }),
    onSuccess: () =>
      Promise.all(
        [qk.integrations.all, qk.sync.all, ...SYNC_DEPENDENT_KEYS].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

export function useIssue(id: string | undefined) {
  return useQuery({
    queryKey: qk.activity.issue(id ?? 'none'),
    queryFn: ({ signal }) =>
      apiClient.get(`/activity/issues/${encodeURIComponent(id ?? '')}`, {
        schema: IssueDetail,
        signal,
      }),
    enabled: id !== undefined,
  });
}

export function useProviderBreakdown(period: string | null | undefined) {
  return useQuery({
    queryKey: qk.metrics.providers(period),
    queryFn: ({ signal }) =>
      apiClient.get('/metrics/providers', {
        schema: ProviderBreakdownResponse,
        query: period ? { period } : {},
        signal,
      }),
  });
}
