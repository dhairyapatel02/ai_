import { describe, expect, it } from 'vitest';

import { signInNotice } from './sign-in-notice';

describe('signInNotice (SCREENS S1, SEC-16)', () => {
  it('explains account_not_linked without leaking anything else', () => {
    const notice = signInNotice({ error: 'account_not_linked', provider: 'google' });
    expect(notice).toMatchObject({
      tone: 'danger',
      title: 'This sign-in couldn’t be linked to your account',
    });
    expect(notice?.body).toMatch(/Sign in the way you did before/);
  });

  it('treats a cancelled consent as neutral', () => {
    expect(signInNotice({ error: 'access_denied', provider: 'github' })).toEqual({
      tone: 'neutral',
      title: 'Sign-in was cancelled.',
    });
  });

  it('suggests the other provider on provider errors', () => {
    expect(signInNotice({ error: 'state_mismatch', provider: 'github' })).toEqual({
      tone: 'danger',
      title: "We couldn't sign you in with GitHub.",
      body: 'Try again, or continue with Google.',
    });
  });

  it('shows the session-ended notice, or nothing', () => {
    expect(signInNotice({ reason: 'session_expired' })).toEqual({
      tone: 'info',
      title: 'Your session ended. Sign in to continue.',
    });
    expect(signInNotice({})).toBeNull();
  });
});
