import { getServerEnv } from '@/env';

import { ProfileView } from './profile-view';

export const metadata = { title: 'Profile' };

// SCREENS S20 — profile, roles, time zone, default period, sign-in methods, sessions (F-01, F-05).
export default function ProfilePage() {
  const env = getServerEnv();
  return <ProfileView providers={{ github: Boolean(env.github), google: Boolean(env.google) }} />;
}
