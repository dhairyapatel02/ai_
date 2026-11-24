import { Injectable } from '@nestjs/common';
import { PeriodType, type Plan, Prisma, ScoreStatus, SyncStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import type { AuthoredPrFact, CommitFact, Facts, ReviewFact } from './metric-definitions';
import type { DailyCounters } from './rollup';

/**
 * Data access for the metrics engine (ADR-0008): indexed range scans over ONE user's rows,
 * parameterised `$queryRaw` tagged templates for the fact loads (the same SQL is measured with
 * EXPLAIN ANALYZE in PERF_NOTES.md). Every read applies the record-set rules of
 * KPI_METHODOLOGY §2.2: included repositories only, no legacy stubs, authored vs reviewed PRs
 * kept apart, no merge commits.
 */

export interface UserMetricSettings {
  timezone: string;
  defaultPeriodType: PeriodType;
  plan: Plan;
}

const dateOnly = (date: string) => new Date(`${date}T00:00:00.000Z`);
export const toLocalDate = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class MetricsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async settings(userId: string): Promise<UserMetricSettings> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, settings: { select: { timezone: true, defaultPeriodType: true } } },
    });
    return {
      timezone: user?.settings?.timezone ?? 'UTC',
      defaultPeriodType: user?.settings?.defaultPeriodType ?? 'MONTH',
      plan: user?.plan ?? 'FREE',
    };
  }

  /** Facts with any metric timestamp in `[start, endExclusive)` (a superset is fine: the pure
   *  functions filter by window). */
  async loadFacts(userId: string, start: Date, endExclusive: Date): Promise<Facts> {
    const [authored, reviews, commits] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string;
          repository_id: string;
          created_at_remote: Date;
          ready_for_review_at: Date | null;
          merged_at: Date | null;
          closed_at: Date | null;
          additions: number | null;
          deletions: number | null;
          changes_requested_count: number | null;
          first_review_at: Date | null;
          reverted_at: Date | null;
        }[]
      >`
        SELECT p.id, p.repository_id, p.created_at_remote, p.ready_for_review_at,
               p."mergedAt" AS merged_at, p.closed_at, p.additions, p.deletions,
               p.changes_requested_count, p.first_review_at, p.reverted_at
        FROM pull_requests p
        JOIN repositories r ON r.id = p.repository_id AND r.included
        WHERE p."userId" = ${userId} AND p.is_authored_by_user AND NOT p.legacy_stub
          AND (   (p.created_at_remote >= ${start} AND p.created_at_remote < ${endExclusive})
               OR (p."mergedAt" >= ${start} AND p."mergedAt" < ${endExclusive})
               OR (p.closed_at >= ${start} AND p.closed_at < ${endExclusive})
               OR (p.first_review_at >= ${start} AND p.first_review_at < ${endExclusive}))`,
      this.prisma.$queryRaw<
        {
          id: string;
          pull_request_id: string;
          repository_id: string;
          submitted_at: Date;
          review_requested_at: Date | null;
          comments_count: number;
          has_body: boolean;
        }[]
      >`
        SELECT v.id, v.pull_request_id, p.repository_id, v.submitted_at, v.review_requested_at,
               v.comments_count, v.has_body
        FROM pull_request_reviews v
        JOIN pull_requests p ON p.id = v.pull_request_id
          AND NOT p.is_authored_by_user AND NOT p.legacy_stub
        JOIN repositories r ON r.id = p.repository_id AND r.included
        WHERE v.user_id = ${userId} AND v.submitted_at >= ${start} AND v.submitted_at < ${endExclusive}`,
      this.prisma.$queryRaw<{ id: string; repository_id: string; authored_at: Date }[]>`
        SELECT c.id, c.repository_id, c.authored_at
        FROM commits c
        JOIN repositories r ON r.id = c.repository_id AND r.included
        WHERE c."userId" = ${userId} AND c.parents_count <= 1
          AND c.authored_at >= ${start} AND c.authored_at < ${endExclusive}`,
    ]);
    return {
      authored: authored.map((p): AuthoredPrFact => ({
        id: p.id,
        repositoryId: p.repository_id,
        createdAt: p.created_at_remote,
        readyAt: p.ready_for_review_at ?? p.created_at_remote,
        mergedAt: p.merged_at,
        closedAt: p.closed_at,
        changedLines:
          p.additions === null || p.deletions === null ? null : p.additions + p.deletions,
        changesRequestedCount: p.changes_requested_count,
        firstReviewAt: p.first_review_at,
        revertedAt: p.reverted_at,
      })),
      reviews: reviews.map((v): ReviewFact => ({
        id: v.id,
        pullRequestId: v.pull_request_id,
        repositoryId: v.repository_id,
        submittedAt: v.submitted_at,
        reviewRequestedAt: v.review_requested_at,
        commentsCount: v.comments_count,
        hasBody: v.has_body,
      })),
      commits: commits.map((c): CommitFact => ({
        id: c.id,
        repositoryId: c.repository_id,
        authoredAt: c.authored_at,
      })),
    };
  }

  /** Local `occurredOn` dates of the user's achievements in `[fromDate, toDate]` (one per row). */
  async achievementDates(userId: string, fromDate: string, toDate: string): Promise<string[]> {
    const rows = await this.prisma.achievement.findMany({
      where: {
        userId,
        occurredOn: {
          gte: new Date(`${fromDate}T00:00:00Z`),
          lte: new Date(`${toDate}T00:00:00Z`),
        },
      },
      select: { occurredOn: true },
    });
    return rows.map((r) => r.occurredOn.toISOString().slice(0, 10));
  }

  /** Earliest activity timestamp of the user (bounds a full-history recompute). */
  async earliestActivity(userId: string): Promise<Date | null> {
    const rows = await this.prisma.$queryRaw<{ t: Date | null }[]>`
      SELECT LEAST(
        (SELECT MIN(authored_at) FROM commits WHERE "userId" = ${userId}),
        (SELECT MIN(created_at_remote) FROM pull_requests WHERE "userId" = ${userId}),
        (SELECT MIN(submitted_at) FROM pull_request_reviews WHERE user_id = ${userId})
      ) AS t`;
    return rows[0]?.t ?? null;
  }

  // ── Snapshots ──────────────────────────────────────────────────────────────────────────

  async snapshots(userId: string, timezone: string, fromDate: string, toDate: string) {
    return this.prisma.metricSnapshot.findMany({
      where: { userId, timezone, date: { gte: dateOnly(fromDate), lte: dateOnly(toDate) } },
      orderBy: { date: 'asc' },
    });
  }

  /** Idempotent: deletes and rewrites the range in one transaction (§4). */
  async replaceSnapshots(
    userId: string,
    timezone: string,
    fromDate: string,
    toDate: string,
    rows: DailyCounters[],
    metricsVersion: string,
  ): Promise<number> {
    const computedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.metricSnapshot.deleteMany({
        where: { userId, date: { gte: dateOnly(fromDate), lte: dateOnly(toDate) } },
      }),
      this.prisma.metricSnapshot.createMany({
        data: rows.map((row) => ({
          userId,
          timezone,
          metricsVersion,
          computedAt,
          ...row,
          date: dateOnly(row.date),
        })),
      }),
    ]);
    return rows.length;
  }

  /** Snapshot rows written for another time zone (left over before a tz recompute finishes). */
  async deleteSnapshotsNotIn(userId: string, timezone: string): Promise<number> {
    const { count } = await this.prisma.metricSnapshot.deleteMany({
      where: { userId, NOT: { timezone } },
    });
    return count;
  }

  async hasSnapshots(userId: string): Promise<boolean> {
    return (await this.prisma.metricSnapshot.count({ where: { userId }, take: 1 })) > 0;
  }

  // ── Impact score cache ─────────────────────────────────────────────────────────────────

  async findScores(
    userId: string,
    scoreVersion: string,
    timezone: string,
    keys: { periodType: PeriodType; startDate: string; endDate: string }[],
  ) {
    if (keys.length === 0) return [];
    return this.prisma.impactScore.findMany({
      where: {
        userId,
        scoreVersion,
        timezone,
        OR: keys.map((k) => ({
          periodType: k.periodType,
          periodStart: dateOnly(k.startDate),
          periodEnd: dateOnly(k.endDate),
        })),
      },
    });
  }

  async saveScore(data: {
    userId: string;
    periodType: PeriodType;
    startDate: string;
    endDate: string;
    timezone: string;
    scoreVersion: string;
    metricsVersion: string;
    status: ScoreStatus;
    overall: number | null;
    delivery: number | null;
    quality: number | null;
    collaboration: number | null;
    ownership: number | null;
    inputs: Prisma.InputJsonValue;
    explanation: string;
  }) {
    const { startDate, endDate, ...rest } = data;
    const key = {
      userId: data.userId,
      periodType: data.periodType,
      periodStart: dateOnly(startDate),
      periodEnd: dateOnly(endDate),
      scoreVersion: data.scoreVersion,
    };
    const values = { ...rest, periodStart: key.periodStart, periodEnd: key.periodEnd };
    try {
      // user-scope: the compound unique key includes data.userId.
      return await this.prisma.impactScore.upsert({
        where: { userId_periodType_periodStart_periodEnd_scoreVersion: key },
        create: values,
        update: { ...values, computedAt: new Date() },
      });
    } catch (error) {
      // Two requests computed the same period concurrently: same inputs → same row; keep theirs.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { ...values, computedAt: new Date() };
      }
      throw error;
    }
  }

  /** Invalidates cached scores whose period overlaps `[fromDate, toDate]` (ARCHITECTURE_V2 §7). */
  async deleteOverlappingScores(userId: string, fromDate: string, toDate: string): Promise<number> {
    const { count } = await this.prisma.impactScore.deleteMany({
      where: {
        userId,
        periodStart: { lte: dateOnly(toDate) },
        periodEnd: { gte: dateOnly(fromDate) },
      },
    });
    return count;
  }

  async deleteAllScores(userId: string): Promise<number> {
    const { count } = await this.prisma.impactScore.deleteMany({ where: { userId } });
    return count;
  }

  // ── Freshness ──────────────────────────────────────────────────────────────────────────

  async dataFreshness(
    userId: string,
  ): Promise<{ lastSuccessfulSyncAt: Date | null; syncing: boolean }> {
    const [latest, active] = await Promise.all([
      this.prisma.integration.aggregate({
        where: { userId },
        _max: { lastSuccessfulSyncAt: true },
      }),
      this.prisma.syncRun.count({
        where: {
          userId,
          status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING, SyncStatus.WAITING_RATE_LIMIT] },
        },
      }),
    ]);
    return { lastSuccessfulSyncAt: latest._max.lastSuccessfulSyncAt, syncing: active > 0 };
  }
}
