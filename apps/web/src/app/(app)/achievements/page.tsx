import { Award } from 'lucide-react';

import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Achievements' };

// SCREENS S17 — achievements journal arrives in P12.
export default function AchievementsPage() {
  return (
    <ComingSoon
      title="Achievements"
      icon={Award}
      lede="Capture wins GitHub can't see: incidents handled, mentoring, talks."
      description="The achievements journal is being built."
    />
  );
}
