import { MeDto } from '@devimpact/shared';
import { redirect } from 'next/navigation';

import { getServerApi } from '@/lib/api/server';
import { onboardingPath } from '@/lib/onboarding';

export const dynamic = 'force-dynamic';

/** `/onboarding` → the saved step (FLOWS F2 "Resumable"); finished users go to the dashboard. */
export default async function OnboardingIndex() {
  let target = '/onboarding/connect';
  try {
    const api = await getServerApi();
    const me = await api.get('/me', { schema: MeDto });
    target = me.onboarding.completed
      ? '/dashboard'
      : onboardingPath(me.onboarding.step, me.integrations);
  } catch (error) {
    if ((error as { code?: string }).code === 'UNAUTHENTICATED') redirect('/sign-in');
  }
  redirect(target);
}
