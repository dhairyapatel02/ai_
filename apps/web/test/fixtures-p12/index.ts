/**
 * P12 API responses captured from the seeded demo user on 2026-11-24 (Europe/London, PRO plan):
 * six achievements (one per category group, some with linked PRs / reviews / commits), three goals
 * (metric target met, metric target not met, tracked by achievements), entitlements, usage, the
 * career timeline with "Beyond code", the achievement feed and a digest preview. Refresh: run
 * `npm run db:seed`, then capture with a signed token (see PROGRESS P12 → View tests).
 */
import achievements from './achievements.json';
import career from './career.json';
import digestPreview from './digest-preview.json';
import entitlements from './entitlements.json';
import feed from './feed.json';
import goalDetail from './goal-detail.json';
import goals from './goals.json';
import me from './me.json';
import usage from './usage.json';

import type {
  AchievementDto,
  CareerTimelineResponse,
  DigestPreviewResponse,
  Entitlements,
  FeedItem,
  GoalDetailDto,
  GoalDto,
  MeDto,
  PageMeta,
  UsageResponse,
} from '@devimpact/shared';

export const NOW = new Date('2026-11-24T12:00:00Z');

interface One<T> {
  data: T;
}
interface Page<T> {
  data: T[];
  meta: PageMeta;
}
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON fixture cast
const as = <T>(value: unknown) => value as T;

export const fx12 = {
  me: as<One<MeDto>>(me),
  achievements: as<Page<AchievementDto>>(achievements),
  goals: as<Page<GoalDto>>(goals),
  goalDetail: as<One<GoalDetailDto>>(goalDetail),
  entitlements: as<One<Entitlements>>(entitlements),
  usage: as<One<UsageResponse>>(usage),
  career: as<One<CareerTimelineResponse>>(career),
  feed: as<Page<FeedItem>>(feed),
  digestPreview: as<One<DigestPreviewResponse>>(digestPreview),
};

export const clone = <T>(value: T): T => structuredClone(value);

/** A saved achievement linked to one PR (for POST /achievements responses in view tests). */
export function achievementFixture(prRef: string, prId: string): AchievementDto {
  return {
    id: 'cmachievementfixture00001',
    ref: 'ACH-cmachievementfixture00001',
    title: 'Shipped refunds',
    description: null,
    impact: 'Delivered partial refunds.',
    category: 'delivery',
    occurredOn: '2026-11-10',
    links: [],
    source: 'from_activity',
    evidence: [
      {
        ref: prRef,
        kind: 'pull_request',
        id: prId,
        title: 'Shipped refunds',
        repo: 'acme/api',
        url: null,
        occurredAt: '2026-11-10T12:00:00.000Z',
      },
    ],
    goalIds: [],
    createdAt: '2026-11-24T12:00:00.000Z',
    updatedAt: '2026-11-24T12:00:00.000Z',
  };
}
