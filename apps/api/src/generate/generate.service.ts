import {
  addDays,
  parsePeriod,
  periodSpecContaining,
  resumeBulletsResultSchema,
  shiftPeriodSpec,
  todayIn,
} from '@devimpact/shared';
import { Injectable } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';

import { ActivityService } from '../activity/activity.service';
import { AIService } from '../ai/ai.service';
import { AppException } from '../common/app-exception';
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
      throw new AppException(
        'UPSTREAM_ERROR',
        'AI response did not contain valid resume bullets. Please try again.',
        { provider: 'anthropic' },
      );
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
    const { from, to } = GenerateService.appraisalRange(period, month, year);
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
    const { from, to } = GenerateService.promotionRange(
      await this.activityService.timezoneOf(userId),
    );

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

  /**
   * Local-date range (inclusive, interpreted in the user's time zone by the activity reads) of an
   * appraisal period — BUG-06: no server-local time is involved.
   */
  static appraisalRange(period: string, month: number, year: number): { from: string; to: string } {
    const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    const type = period === 'quarterly' ? 'quarter' : period === 'yearly' ? 'year' : 'month';
    const { startDate, endDate } = parsePeriod(periodSpecContaining(type, date));
    return { from: startDate, to: endDate };
  }

  /** The six months before today in the user's time zone (inclusive local dates). */
  static promotionRange(timezone: string, now = new Date()): { from: string; to: string } {
    const today = todayIn(timezone, now);
    const sixMonthsBack = parsePeriod(shiftPeriodSpec(periodSpecContaining('month', today), -6));
    const day = Math.min(Number(today.slice(8, 10)), Number(sixMonthsBack.endDate.slice(8, 10)));
    const from = addDays(sixMonthsBack.startDate, day - 1);
    return { from, to: today };
  }
}
