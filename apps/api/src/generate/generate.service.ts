import { resumeBulletsResultSchema } from '@devimpact/shared';
import { Injectable } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';

import { ActivityService } from '../activity/activity.service';
import { AIService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GenerateService {
  constructor(
    private prisma: PrismaService,
    private aiService: AIService,
    private activityService: ActivityService,
  ) {}

  async generateResume(userId: string, dateRange: { from: string; to: string }, role: string) {
    const activityData = await this.activityService.getActivityDataForAI(
      userId,
      dateRange.from,
      dateRange.to,
    );
    const result = await this.aiService.generateResumeBullets(activityData, dateRange, role);

    // BUG-14: the model returns `{ bullets: [...] }`; validate it and return the array itself so
    // the client never receives a nested object it can't render.
    const parsed = resumeBulletsResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new Error('AI response did not contain valid resume bullets. Please try again.');
    }

    const doc = await this.prisma.generatedDocument.create({
      data: {
        userId,
        type: DocumentType.RESUME,
        content: result,
        dateRange: dateRange,
      },
    });

    return { document: doc, bullets: parsed.data.bullets };
  }

  async generateAppraisal(userId: string, period: string, month: number, year: number) {
    const { from, to } = this.getDateRangeForPeriod(period, month, year);
    const activityData = await this.activityService.getActivityDataForAI(userId, from, to);
    const result = await this.aiService.generateAppraisalReport(activityData, period, month, year);

    const doc = await this.prisma.generatedDocument.create({
      data: {
        userId,
        type: DocumentType.APPRAISAL,
        content: result as Prisma.InputJsonValue,
        dateRange: { from, to },
      },
    });

    return { document: doc, report: result };
  }

  async generatePromotion(userId: string, currentRole: string, targetRole: string) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const from = sixMonthsAgo.toISOString();
    const to = new Date().toISOString();

    const activityData = await this.activityService.getActivityDataForAI(userId, from, to);
    const result = await this.aiService.generatePromotionPacket(
      currentRole,
      targetRole,
      activityData,
    );

    const doc = await this.prisma.generatedDocument.create({
      data: {
        userId,
        type: DocumentType.PROMOTION,
        content: result as Prisma.InputJsonValue,
        dateRange: { from, to },
      },
    });

    return { document: doc, packet: result };
  }

  async getImpactScore(userId: string, month: number, year: number, force = false) {
    if (!force) {
      const existing = await this.prisma.impactScore.findUnique({
        where: { userId_month_year: { userId, month, year } },
      });

      if (existing) return existing;
    }

    // Generate new score
    const { from, to } = this.getDateRangeForPeriod('monthly', month, year);
    const activityData = await this.activityService.getActivityDataForAI(userId, from, to);
    const result = await this.aiService.calculateImpactScore(activityData, month, year);

    const score = await this.prisma.impactScore.upsert({
      where: { userId_month_year: { userId, month, year } },
      update: {
        overall: result.overall,
        featureDelivery: result.featureDelivery,
        codeQuality: result.codeQuality,
        collaboration: result.collaboration,
        leadership: result.leadership,
        highlights: result.highlights ?? [],
      },
      create: {
        userId,
        month,
        year,
        overall: result.overall,
        featureDelivery: result.featureDelivery,
        codeQuality: result.codeQuality,
        collaboration: result.collaboration,
        leadership: result.leadership,
        highlights: result.highlights ?? [],
      },
    });

    return score;
  }

  private getDateRangeForPeriod(period: string, month: number, year: number) {
    let from: Date;
    let to: Date;

    switch (period) {
      case 'monthly':
        from = new Date(year, month - 1, 1);
        to = new Date(year, month, 0, 23, 59, 59);
        break;
      case 'quarterly': {
        const quarterStart = Math.floor((month - 1) / 3) * 3;
        from = new Date(year, quarterStart, 1);
        to = new Date(year, quarterStart + 3, 0, 23, 59, 59);
        break;
      }
      case 'yearly':
        from = new Date(year, 0, 1);
        to = new Date(year, 11, 31, 23, 59, 59);
        break;
      default:
        from = new Date(year, month - 1, 1);
        to = new Date(year, month, 0, 23, 59, 59);
    }

    return { from: from.toISOString(), to: to.toISOString() };
  }
}
