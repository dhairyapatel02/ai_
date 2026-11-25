import {
  resolvePeriod,
  todayIn,
  type GoalComparatorWire,
  type GoalDetailDto,
  type GoalDto,
  type GoalInputParsed,
  type GoalListQuery,
  type GoalStatusWire,
  type ImplementedMetricKey,
  type PageMeta,
  type ResolvedPeriod,
  type UpdateGoalInput,
} from '@devimpact/shared';
import { Injectable } from '@nestjs/common';
import { GoalComparator, GoalStatus, type Prisma } from '@prisma/client';

import {
  ACHIEVEMENT_INCLUDE,
  localDate,
  toAchievementDto,
} from '../achievements/achievements.service';
import { AppException } from '../common/app-exception';
import { decodeOffsetCursor, encodeOffsetCursor } from '../common/pagination';
import { ImpactScoreService, type PeriodScore } from '../metrics/impact-score.service';
import { PrismaService } from '../prisma/prisma.service';
import { evaluationMonthSpec, progressOf } from './goal-progress';

const GOAL_INCLUDE = {
  achievements: { select: { achievementId: true } },
} as const satisfies Prisma.GoalInclude;
type GoalRow = Prisma.GoalGetPayload<{ include: typeof GOAL_INCLUDE }>;

const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const STATUS_ORDER: GoalStatus[] = [
  GoalStatus.ACTIVE,
  GoalStatus.ACHIEVED,
  GoalStatus.MISSED,
  GoalStatus.ARCHIVED,
];

/**
 * Goals (API_CONTRACT_V2 §16, F-62). Progress of a metric target is computed by the metrics
 * engine (`ImpactScoreService` period cache) — never by the LLM. User-scoped throughout; linked
 * achievements must belong to the user (404 otherwise).
 */
@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scores: ImpactScoreService,
  ) {}

  private async timezone(userId: string): Promise<string> {
    const s = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    return s?.timezone ?? 'UTC';
  }

  /** Engine values for every month the given goals are evaluated on (one cached score each). */
  private async toDtos(userId: string, rows: GoalRow[], now = new Date()): Promise<GoalDto[]> {
    const timezone = await this.timezone(userId);
    const today = todayIn(timezone, now);
    const specs = new Map<string, ResolvedPeriod>();
    for (const g of rows) {
      if (!g.metricKey) continue;
      const spec = evaluationMonthSpec(localDate(g.startDate), today);
      if (!specs.has(spec)) specs.set(spec, resolvePeriod(spec, timezone, today));
    }
    const scored: PeriodScore[] = await this.scores.scoresFor(userId, [...specs.values()]);
    const bySpec = new Map(scored.map((s) => [s.period.spec, s]));
    return rows.map((g) => {
      const target =
        g.metricKey && g.comparator && g.targetValue !== null
          ? {
              metricKey: g.metricKey as ImplementedMetricKey,
              comparator: g.comparator.toLowerCase() as GoalComparatorWire,
              targetValue: g.targetValue,
            }
          : null;
      const score = target
        ? bySpec.get(evaluationMonthSpec(localDate(g.startDate), today))
        : undefined;
      return {
        id: g.id,
        title: g.title,
        description: g.description,
        status: g.status.toLowerCase() as GoalStatusWire,
        startDate: localDate(g.startDate),
        targetDate: g.targetDate ? localDate(g.targetDate) : null,
        metricTarget: target,
        achievementIds: g.achievements.map((a) => a.achievementId),
        progress: progressOf(
          target,
          target ? score?.inputs.metrics[target.metricKey] : undefined,
          score ? score.period : null,
        ),
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      };
    });
  }

  async list(userId: string, query: GoalListQuery): Promise<{ items: GoalDto[]; meta: PageMeta }> {
    const where: Prisma.GoalWhereInput = {
      userId,
      ...(query.status ? { status: query.status.toUpperCase() as GoalStatus } : {}),
    };
    const offset = decodeOffsetCursor(query.cursor);
    // user-scope: `where` starts with { userId } above (both queries).
    const [rows, total] = await Promise.all([
      this.prisma.goal.findMany({ where, include: GOAL_INCLUDE }),
      // user-scope: same `where`.
      this.prisma.goal.count({ where }),
    ]);
    // Active first, then achieved / missed / archived; newest first within a status.
    rows.sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        (a.id < b.id ? 1 : -1),
    );
    const page = rows.slice(offset, offset + query.limit);
    const hasMore = offset + query.limit < rows.length;
    return {
      items: await this.toDtos(userId, page),
      meta: {
        nextCursor: hasMore ? encodeOffsetCursor(offset + query.limit) : null,
        hasMore,
        total,
      },
    };
  }

  async get(userId: string, id: string): Promise<GoalDetailDto> {
    const row = await this.prisma.goal.findFirst({ where: { id, userId }, include: GOAL_INCLUDE });
    if (!row) throw AppException.notFound('Goal');
    const [dto] = await this.toDtos(userId, [row]);
    const achievements = await this.prisma.achievement.findMany({
      where: { userId, goals: { some: { goalId: row.id } } },
      include: ACHIEVEMENT_INCLUDE,
      orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
    });
    return { ...dto, achievements: achievements.map(toAchievementDto) };
  }

  private async assertAchievements(userId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const found = await this.prisma.achievement.count({ where: { userId, id: { in: unique } } });
    if (found !== unique.length) throw AppException.notFound('Achievement');
    return unique;
  }

  private targetData(target: GoalInputParsed['metricTarget']) {
    return target
      ? {
          metricKey: target.metricKey,
          comparator: target.comparator.toUpperCase() as GoalComparator,
          targetValue: target.targetValue,
        }
      : { metricKey: null, comparator: null, targetValue: null };
  }

  async create(userId: string, input: GoalInputParsed): Promise<GoalDto> {
    const achievementIds = await this.assertAchievements(userId, input.achievementIds);
    const row = await this.prisma.goal.create({
      data: {
        user: { connect: { id: userId } },
        title: input.title,
        description: input.description || null,
        status: input.status.toUpperCase() as GoalStatus,
        startDate: toDbDate(input.startDate),
        targetDate: input.targetDate ? toDbDate(input.targetDate) : null,
        ...this.targetData(input.metricTarget),
        achievements: { create: achievementIds.map((achievementId) => ({ achievementId })) },
      },
      include: GOAL_INCLUDE,
    });
    const [dto] = await this.toDtos(userId, [row]);
    return dto;
  }

  async update(userId: string, id: string, input: UpdateGoalInput): Promise<GoalDto> {
    const existing = await this.prisma.goal.findFirst({
      where: { id, userId },
      select: { id: true, startDate: true, targetDate: true },
    });
    if (!existing) throw AppException.notFound('Goal');
    const start = input.startDate ?? localDate(existing.startDate);
    const end =
      input.targetDate === undefined
        ? existing.targetDate && localDate(existing.targetDate)
        : input.targetDate;
    if (end && end < start) {
      throw new AppException('VALIDATION_FAILED', 'The request is invalid', {
        issues: [
          {
            path: 'body.targetDate',
            message: 'The target date must not be before the start date',
            code: 'custom',
          },
        ],
      });
    }
    const achievementIds = input.achievementIds
      ? await this.assertAchievements(userId, input.achievementIds)
      : null;
    const data: Prisma.GoalUpdateInput = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.status ? { status: input.status.toUpperCase() as GoalStatus } : {}),
      ...(input.startDate ? { startDate: toDbDate(input.startDate) } : {}),
      ...(input.targetDate !== undefined
        ? { targetDate: input.targetDate ? toDbDate(input.targetDate) : null }
        : {}),
      ...(input.metricTarget !== undefined ? this.targetData(input.metricTarget) : {}),
      ...(achievementIds
        ? {
            achievements: {
              deleteMany: {},
              create: achievementIds.map((achievementId) => ({ achievementId })),
            },
          }
        : {}),
    };
    // user-scope: `existing` was loaded by { id, userId } just above.
    const row = await this.prisma.goal.update({
      where: { id: existing.id },
      data,
      include: GOAL_INCLUDE,
    });
    const [dto] = await this.toDtos(userId, [row]);
    return dto;
  }

  async remove(userId: string, id: string): Promise<{ deleted: true }> {
    const { count } = await this.prisma.goal.deleteMany({ where: { id, userId } });
    if (count === 0) throw AppException.notFound('Goal');
    return { deleted: true };
  }
}
