import type { ActivityType } from '@devimpact/shared';

/**
 * Recent activity on the dashboard (S6 data): merged/closed PRs, reviews, achievements. Shared by
 * the server prefetch (`dashboard/page.tsx`) and the client feed so both use the same query key.
 */
export const DASHBOARD_FEED: { types: ActivityType[]; limit: number } = {
  types: ['pr_merged', 'pr_closed', 'review', 'achievement'],
  limit: 7,
};
