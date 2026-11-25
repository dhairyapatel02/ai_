export interface SignInNotice {
  tone: 'danger' | 'neutral' | 'info';
  title: string;
  body?: string;
}

const PROVIDER_NAMES: Record<string, string> = { github: 'GitHub', google: 'Google' };

/**
 * Banner for `/sign-in?error=…&provider=…&reason=…` (SCREENS S1 Error, FLOWS F1, SEC-16).
 * Better Auth appends its error code to the `errorCallbackURL`; the provider is ours.
 */
export function signInNotice(params: {
  error?: string;
  provider?: string;
  reason?: string;
}): SignInNotice | null {
  const provider = PROVIDER_NAMES[params.provider ?? ''];
  const other = provider === 'GitHub' ? 'Google' : 'GitHub';
  if (params.error) {
    const code = params.error.toLowerCase();
    if (code === 'access_denied' || code === 'cancelled' || code === 'user_cancelled') {
      return { tone: 'neutral', title: 'Sign-in was cancelled.' };
    }
    if (code === 'account_not_linked') {
      return {
        tone: 'danger',
        title: 'This sign-in couldn’t be linked to your account',
        body: `A DevImpact account already uses this email, but it hasn't been verified, so it isn't linked automatically. Sign in the way you did before, or contact support to link ${provider ?? 'this provider'} to your account.`,
      };
    }
    return {
      tone: 'danger',
      title: provider ? `We couldn't sign you in with ${provider}.` : "We couldn't sign you in.",
      body: provider ? `Try again, or continue with ${other}.` : 'Try again in a moment.',
    };
  }
  if (params.reason === 'account_deleted') {
    return {
      tone: 'neutral',
      title: 'Account deleted',
      body: "We're sorry to see you go. Your account and its data have been removed.",
    };
  }
  if (params.reason === 'session_expired') {
    return { tone: 'info', title: 'Your session ended. Sign in to continue.' };
  }
  return null;
}
