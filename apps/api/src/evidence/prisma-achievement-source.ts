import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import type { AchievementRecord, AchievementSource } from './achievements';

/**
 * Achievements as AI evidence (P12 binding of `ACHIEVEMENT_SOURCE`): the user's achievements whose
 * local `occurredOn` falls in the period. `updatedAt` is the stable evidence version for inputHash.
 */
@Injectable()
export class PrismaAchievementSource implements AchievementSource {
  constructor(private readonly prisma: PrismaService) {}

  async listForPeriod(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<AchievementRecord[]> {
    const rows = await this.prisma.achievement.findMany({
      where: {
        userId,
        occurredOn: {
          gte: new Date(`${startDate}T00:00:00.000Z`),
          lte: new Date(`${endDate}T00:00:00.000Z`),
        },
      },
      select: {
        id: true,
        title: true,
        description: true,
        impact: true,
        category: true,
        occurredOn: true,
        updatedAt: true,
      },
      orderBy: [{ occurredOn: 'desc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      impact: r.impact,
      category: r.category,
      occurredOn: r.occurredOn.toISOString().slice(0, 10),
      updatedAt: r.updatedAt,
    }));
  }
}
