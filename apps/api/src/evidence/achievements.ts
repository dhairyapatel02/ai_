/**
 * Achievements as AI evidence (ADR-0009, `ACH-<id>` refs). The journal is built in P12; P08 only
 * defines the interface. P12 binds `ACHIEVEMENT_SOURCE` to a Prisma-backed implementation.
 */
export interface AchievementRecord {
  id: string;
  title: string;
  description: string | null;
  impact: string | null;
  category: string;
  /** Local date (YYYY-MM-DD). */
  occurredOn: string;
  updatedAt: Date;
}

export interface AchievementSource {
  /** The user's achievements with `occurredOn` within the inclusive local-date range. */
  listForPeriod(userId: string, startDate: string, endDate: string): Promise<AchievementRecord[]>;
}

export const ACHIEVEMENT_SOURCE = Symbol('ACHIEVEMENT_SOURCE');

/** Default until P12: no achievements. */
export class NoAchievementSource implements AchievementSource {
  listForPeriod(): Promise<AchievementRecord[]> {
    return Promise.resolve([]);
  }
}
