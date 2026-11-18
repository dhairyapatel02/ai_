import { MeDto } from '@devimpact/shared';
import { redirect } from 'next/navigation';

import { getServerApi } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

/**
 * `/` (IA §2): `/dashboard` when onboarding is done, `/onboarding` (resumes the saved step) when
 * not, `/sign-in` without a session. If the API is unreachable, the dashboard shows the error.
 */
export default async function Home() {
  let completed = true;
  try {
    const api = await getServerApi();
    const me = await api.get('/me', { schema: MeDto });
    completed = me.onboarding.completed;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'UNAUTHENTICATED') redirect('/sign-in');
  }
  redirect(completed ? '/dashboard' : '/onboarding');
}
