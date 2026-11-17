import {
  type AchievementStatementContent,
  type AchievementStatementInput,
  type AchievementStatementResponse,
  type HighlightsInput,
  type HighlightsResponse,
  type ImpactNarrativeContent,
} from '@devimpact/shared';
import { Injectable } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';

import { AiQueueService } from '../ai/ai-queue.service';
import { AiConfig } from '../ai/ai.config';
import { DocEventsService } from '../ai/doc-events.service';
import { StructuredGenerator } from '../ai/structured-generator';
import { AppException } from '../common/app-exception';
import { RefResolver } from '../evidence/ref-resolver.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { DocumentInputs, type PreparedGeneration } from './document-inputs.service';
import { toSummary, toTypeEnum } from './document.mapper';
import { collectCitations, generationColumns, notConfigured } from './documents.service';

import type { AiJobResult } from '../ai/ai.constants';

/** Maps a failed quick job to the HTTP error of API_CONTRACT_V2 §10/§14. */
function quickError(result: Extract<AiJobResult, { ok: false }> | null): AppException {
  if (result === null) {
    return new AppException(
      'UPSTREAM_UNAVAILABLE',
      'The AI service is busy. Try again in a minute.',
      {
        provider: 'anthropic',
        retryAfterSeconds: 30,
      },
    );
  }
  const { kind, message } = result.error;
  if (kind === 'not_configured') return notConfigured();
  if (kind === 'rate_limited' || kind === 'overloaded' || kind === 'unavailable') {
    return new AppException('UPSTREAM_UNAVAILABLE', message, { provider: 'anthropic' });
  }
  return new AppException('UPSTREAM_ERROR', message, { provider: 'anthropic', reason: kind });
}

/**
 * Quick AI actions (fast model, awaited ≤ 20 s through `ai.quick`): impact highlights (F-29,
 * cached per score inputs) and achievement statements (F-51, replaces `enhanceCommitMessage`).
 * Same inputHash cache and quota rules as documents, against the quick-action quota.
 */
@Injectable()
export class QuickActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inputs: DocumentInputs,
    private readonly generator: StructuredGenerator,
    private readonly queue: AiQueueService,
    private readonly events: DocEventsService,
    private readonly usage: UsageService,
    private readonly refs: RefResolver,
    private readonly ai: AiConfig,
  ) {}

  private async cachedVersion(userId: string, inputHash: string) {
    const doc = await this.prisma.generatedDocument.findFirst({
      where: { userId, inputHash, status: DocumentStatus.READY },
      orderBy: { createdAt: 'desc' },
    });
    if (!doc) return null;
    // user-scope: `doc` was loaded by { userId, inputHash } just above.
    const version = await this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId: doc.id, version: doc.currentVersion } },
    });
    return version ? { doc, content: version.content } : null;
  }

  /** Creates the document, runs the quick job and returns the saved version. */
  private async generate(userId: string, prepared: PreparedGeneration) {
    if (!this.generator.configured) throw notConfigured();
    await this.usage.assertQuota(userId, 'quick');
    const doc = await this.prisma.generatedDocument.create({
      data: {
        userId,
        type: toTypeEnum(prepared.type),
        status: DocumentStatus.PENDING,
        ...generationColumns(prepared),
      },
    });
    const result = await this.queue.runQuick(
      { documentId: doc.id, version: 1 },
      this.ai.quickTimeoutMs + 2_000,
    );
    if (!result?.ok) {
      if (!result) {
        await this.events.requestCancel(doc.id);
        await this.prisma.generatedDocument.updateMany({
          where: {
            id: doc.id,
            userId,
            status: { in: [DocumentStatus.PENDING, DocumentStatus.STREAMING] },
          },
          data: { status: DocumentStatus.FAILED, errorCode: 'UPSTREAM_UNAVAILABLE' },
        });
      }
      throw quickError(result);
    }
    const saved = await this.cachedVersion(userId, prepared.inputHash);
    if (!saved) throw new AppException('INTERNAL', 'The generated result could not be loaded.');
    return saved;
  }

  async highlights(
    userId: string,
    input: HighlightsInput,
  ): Promise<HighlightsResponse & { status: 200 | 201 }> {
    const prepared = await this.inputs.prepareNarrative(userId, input.period);
    if (prepared.inputs.status === 'insufficient_data') {
      throw new AppException(
        'CONFLICT',
        'There is not enough data in this period for highlights.',
        {
          reason: 'insufficient_data',
        },
      );
    }
    let cached = input.regenerate ? null : await this.cachedVersion(userId, prepared.inputHash);
    const status = cached ? 200 : 201;
    cached ??= await this.generate(userId, prepared);
    const content = cached.content as unknown as ImpactNarrativeContent;
    return {
      status,
      document: toSummary(cached.doc),
      content,
      evidence: await this.refs.resolve(userId, collectCitations(content)),
      cached: status === 200,
    };
  }

  async achievementStatement(
    userId: string,
    input: AchievementStatementInput,
  ): Promise<AchievementStatementResponse> {
    const prepared = await this.inputs.prepareAchievement(userId, input.source);
    let cached = input.regenerate ? null : await this.cachedVersion(userId, prepared.inputHash);
    const hit = cached !== null;
    cached ??= await this.generate(userId, prepared);
    const content = cached.content as unknown as AchievementStatementContent;
    return { ...content, cached: hit };
  }
}
