import { CircleGauge } from 'lucide-react';

import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Plan & usage' };

// SCREENS S23 — arrives in P12 (no billing, D-014).
export default function PlanPage() {
  return (
    <ComingSoon
      title="Plan & usage"
      icon={CircleGauge}
      description="Your plan and AI usage meters are being built."
    />
  );
}
