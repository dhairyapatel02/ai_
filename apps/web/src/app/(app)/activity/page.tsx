import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Activity' };

// SCREENS S7 — designed activity explorer arrives in P10.
export default function ActivityPage() {
  return (
    <ComingSoon
      title="Activity"
      lede="Every pull request, review and commit DevImpact counts, in one feed."
      description="The activity explorer is being built. Your dashboard and KPIs already use the same data."
    />
  );
}
