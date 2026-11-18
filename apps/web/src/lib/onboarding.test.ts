import { describe, expect, it } from 'vitest';

import { onboardingPath } from './onboarding';

describe('onboarding resume (FLOWS F2)', () => {
  it('resumes at the saved step', () => {
    expect(onboardingPath('sync')).toBe('/onboarding/sync');
    expect(onboardingPath('pending')).toBe('/onboarding/pending');
  });

  it('starts at connect, or at repositories when GitHub is already connected', () => {
    expect(onboardingPath(null)).toBe('/onboarding/connect');
    expect(onboardingPath(null, [{ status: 'active' }])).toBe('/onboarding/repositories');
    expect(onboardingPath('unknown', [{ status: 'needs_reauth' }])).toBe('/onboarding/connect');
  });
});
