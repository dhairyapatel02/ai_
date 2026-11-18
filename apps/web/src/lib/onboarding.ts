import type { IntegrationSummary } from '@devimpact/shared';

/** Saved `UserSettings.onboardingStep` values (one per wizard route). */
export const ONBOARDING_STEP_PATHS = {
  connect: '/onboarding/connect',
  pending: '/onboarding/pending',
  repositories: '/onboarding/repositories',
  sync: '/onboarding/sync',
} as const;
export type OnboardingStep = keyof typeof ONBOARDING_STEP_PATHS;

/** Where `/onboarding` resumes: the saved step, else repositories when GitHub is already connected. */
export function onboardingPath(
  step: string | null,
  integrations: Pick<IntegrationSummary, 'status'>[] = [],
): string {
  if (step && step in ONBOARDING_STEP_PATHS) {
    return ONBOARDING_STEP_PATHS[step as OnboardingStep];
  }
  const connected = integrations.some((i) => i.status === 'active');
  return connected ? ONBOARDING_STEP_PATHS.repositories : ONBOARDING_STEP_PATHS.connect;
}

/** Remembered across the GitHub round trip so callback errors land on the right page. */
export const CONNECT_RETURN_KEY = 'devimpact:connect-return';

/** Callback outcomes forwarded as `?error=` (SCREENS S2 Error). */
export const CONNECT_ERRORS: Record<string, { title: string; body: string }> = {
  denied: {
    title: 'GitHub authorization was cancelled',
    body: "Nothing was connected. Install the app again when you're ready.",
  },
  expired: { title: 'That link expired', body: 'Install the app again.' },
  in_use: {
    title: 'This GitHub account is already connected to another DevImpact account',
    body: 'Sign in with that account, or use a different GitHub account.',
  },
  entitlement: {
    title: 'Your plan includes 1 GitHub connection',
    body: 'Disconnect the existing connection in Settings → Integrations to connect another.',
  },
  upstream: { title: "GitHub didn't respond", body: 'Try again in a minute.' },
  failed: { title: "GitHub couldn't be connected", body: 'Try again in a minute.' },
};
