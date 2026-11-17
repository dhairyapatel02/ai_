import { Injectable } from '@nestjs/common';
import { AiCallStatus, AiFeature, DocumentStatus, DocumentType, type Plan } from '@prisma/client';

import { AiConfig, estimateCostMicroUsd } from '../ai/ai.config';
import { AppException } from '../common/app-exception';
import { limitsFor } from '../entitlements/entitlements';
import { PrismaService } from '../prisma/prisma.service';

import type { AiCallRecord } from '../ai/structured-generator';
import type { AiFeatureWire, UsageResponse } from '@devimpact/shared';

export type QuotaGroup = 'generations' | 'quick';

export const GENERATION_FEATURES: AiFeature[] = [
  AiFeature.RESUME,
  AiFeature.APPRAISAL,
  AiFeature.PROMOTION,
];
export const QUICK_FEATURES: AiFeature[] = [
  AiFeature.IMPACT_NARRATIVE,
  AiFeature.ACHIEVEMENT_STATEMENT,
  AiFeature.DIGEST_SUMMARY,
];
const GENERATION_TYPES: DocumentType[] = [
  DocumentType.RESUME,
  DocumentType.APPRAISAL,
  DocumentType.PROMOTION,
];

/** `[start, end)` of a UTC calendar month (D-019: quotas reset on UTC months). */
export function utcMonth(
  month?: string,
  now = new Date(),
): { month: string; start: Date; end: Date } {
  const [y, m] = month
    ? month.split('-').map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { month: `${y}-${String(m).padStart(2, '0')}`, start, end };
}

/**
 * AI usage accounting and monthly plan quotas (ADR-0009, PRD §6, SEC-07). One `AiUsage` row per
 * Anthropic call; a generation counts toward the quota only when it succeeded (its primary call
 * row has `countsTowardQuota`). Cache hits, failures, cancellations and repair calls never count.
 * Generations still in flight count too, so parallel requests cannot overrun the quota.
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiConfig,
  ) {}

  async record(
    userId: string,
    documentId: string | null,
    feature: AiFeature,
    calls: AiCallRecord[],
    succeeded: boolean,
  ): Promise<void> {
    if (calls.length === 0) return;
    await this.prisma.aiUsage.createMany({
      data: calls.map((call) => ({
        userId,
        documentId,
        feature,
        promptId: call.promptId,
        promptVersion: call.promptVersion,
        model: call.model,
        inputTokens: call.usage.inputTokens,
        outputTokens: call.usage.outputTokens,
        cacheReadTokens: call.usage.cacheReadTokens,
        cacheWriteTokens: call.usage.cacheWriteTokens,
        costMicroUsd: BigInt(estimateCostMicroUsd(this.ai.prices, call.model, call.usage)),
        latencyMs: call.latencyMs,
        status: AiCallStatus[call.status],
        countsTowardQuota: succeeded && call.primary && call.status === 'SUCCEEDED',
        errorCode: call.errorCode,
      })),
    });
  }

  async used(userId: string, group: QuotaGroup, now = new Date()): Promise<number> {
    const { start, end } = utcMonth(undefined, now);
    const features = group === 'generations' ? GENERATION_FEATURES : QUICK_FEATURES;
    const [counted, inFlight] = await Promise.all([
      this.prisma.aiUsage.count({
        where: {
          userId,
          countsTowardQuota: true,
          feature: { in: features },
          createdAt: { gte: start, lt: end },
        },
      }),
      group === 'generations'
        ? this.prisma.generatedDocument.count({
            where: {
              userId,
              type: { in: GENERATION_TYPES },
              status: { in: [DocumentStatus.PENDING, DocumentStatus.STREAMING] },
            },
          })
        : Promise.resolve(0),
    ]);
    return counted + inFlight;
  }

  /** Throws `402 QUOTA_EXCEEDED { feature, used, limit, resetsAt }` when the month is used up. */
  async assertQuota(userId: string, group: QuotaGroup, now = new Date()): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });
    const plan: Plan = user?.plan ?? 'FREE';
    const limits = limitsFor(plan);
    const limit = group === 'generations' ? limits.aiGenerationsPerMonth : limits.aiQuickPerMonth;
    const used = await this.used(userId, group, now);
    if (used >= limit) {
      const { end } = utcMonth(undefined, now);
      throw new AppException(
        'QUOTA_EXCEEDED',
        group === 'generations'
          ? 'You have used all AI document generations for this month.'
          : 'You have used all quick AI actions for this month.',
        { feature: group, used, limit, resetsAt: end.toISOString() },
      );
    }
  }

  async usage(userId: string, month?: string, now = new Date()): Promise<UsageResponse> {
    const range = utcMonth(month, now);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });
    const limits = limitsFor(user?.plan ?? 'FREE');
    const rows = await this.prisma.aiUsage.groupBy({
      by: ['feature', 'countsTowardQuota'],
      where: { userId, createdAt: { gte: range.start, lt: range.end } },
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        costMicroUsd: true,
      },
    });
    let generations = 0;
    let quick = 0;
    const tokens = { input: 0, output: 0, cacheRead: 0 };
    let cost = 0n;
    const byFeature = new Map<AiFeature, { count: number; tokens: number }>();
    for (const row of rows) {
      const input = row._sum.inputTokens ?? 0;
      const output = row._sum.outputTokens ?? 0;
      const cacheRead = row._sum.cacheReadTokens ?? 0;
      tokens.input += input;
      tokens.output += output;
      tokens.cacheRead += cacheRead;
      cost += row._sum.costMicroUsd ?? 0n;
      const entry = byFeature.get(row.feature) ?? { count: 0, tokens: 0 };
      entry.tokens += input + output + cacheRead + (row._sum.cacheWriteTokens ?? 0);
      if (row.countsTowardQuota) {
        entry.count += row._count._all;
        if (GENERATION_FEATURES.includes(row.feature)) generations += row._count._all;
        else quick += row._count._all;
      }
      byFeature.set(row.feature, entry);
    }
    const isCurrent = range.month === utcMonth(undefined, now).month;
    if (isCurrent) generations = await this.used(userId, 'generations', now);
    return {
      month: range.month,
      generations: {
        used: generations,
        limit: limits.aiGenerationsPerMonth,
        resetsAt: range.end.toISOString(),
      },
      quick: { used: quick, limit: limits.aiQuickPerMonth },
      tokens,
      estimatedCostUsd: Number(cost) / 1_000_000,
      byFeature: [...byFeature.entries()]
        .map(([feature, v]) => ({
          feature: feature.toLowerCase() as AiFeatureWire,
          count: v.count,
          tokens: v.tokens,
        }))
        .sort((a, b) => (a.feature < b.feature ? -1 : 1)),
    };
  }
}
