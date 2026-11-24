/**
 * Achievements as AI evidence (ADR-0009, `ACH-<id>` refs). `ACHIEVEMENT_SOURCE` is bound to
 * `PrismaAchievementSource` in EvidenceModule (P12); `NoAchievementSource` remains for unit tests.
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

/** No achievements (unit tests, eval harness). */
export class NoAchievementSource implements AchievementSource {
  listForPeriod(): Promise<AchievementRecord[]> {
    return Promise.resolve([]);
  }
}
