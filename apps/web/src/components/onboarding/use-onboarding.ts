'use client';

import { ConnectGitHubResult, type ConnectReturnTo } from '@devimpact/shared';
import { useEffect, useRef } from 'react';

import { apiClient } from '@/lib/api/browser';
import { useMe, useUpdateSettings } from '@/lib/api/hooks';
import { CONNECT_RETURN_KEY, type OnboardingStep } from '@/lib/onboarding';

/** Persists the current wizard step once per visit (`PATCH /me/settings`, resumable F2). */
export function useSaveOnboardingStep(step: OnboardingStep, extra: { timezone?: string } = {}) {
  const me = useMe();
  const update = useUpdateSettings();
  const saved = useRef(false);
  const currentStep = me.data?.settings.onboardingStep;
  const completed = me.data?.onboarding.completed;
  useEffect(() => {
    if (saved.current || !me.data) return;
    saved.current = true;
    const input: { onboardingStep?: string; timezone?: string } = {};
    if (currentStep !== step && !completed) input.onboardingStep = step;
    // Prefill only the default (UTC) — never overwrite a time zone the user already chose.
    if (extra.timezone && me.data.settings.timezone === 'UTC' && extra.timezone !== 'UTC') {
      input.timezone = extra.timezone;
    }
    if (Object.keys(input).length) update.mutate(input);
    // Runs once when `/me` is available; later changes are the user's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data]);
}

/**
 * Starts the GitHub App install/authorize flow (`POST /integrations/github/connect`) and leaves
 * the app. The return target is remembered so callback errors land on the page that started it.
 */
export async function startGitHubConnect(returnTo: ConnectReturnTo): Promise<void> {
  const { url } = await apiClient.post('/integrations/github/connect', {
    body: { returnTo },
    schema: ConnectGitHubResult,
  });
  try {
    window.sessionStorage.setItem(CONNECT_RETURN_KEY, returnTo);
  } catch {
    // Storage blocked: callback errors fall back to the onboarding page.
  }
  window.location.assign(url);
}

/** Browser time zone, used to prefill the user's time zone on step 1 (FLOWS F2). */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
