import { Target } from 'lucide-react';

import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Goals' };

// SCREENS S18 — goals arrive in P12.
export default function GoalsPage() {
  return <ComingSoon title="Goals" icon={Target} description="Goals are being built." />;
}
