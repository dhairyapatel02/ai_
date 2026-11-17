import { Injectable } from '@nestjs/common';
import { DocumentStatus, DocumentType, type Prisma } from '@prisma/client';

import { StructuredGenerator } from '../ai/structured-generator';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { DocumentGenerationService } from './document-generation.service';
import { DocumentInputs } from './document-inputs.service';

import type { DigestSummaryContent } from '@devimpact/shared';

/**
 * Optional AI summary for the weekly digest (F-64, fast model, cached per inputHash). Worker-only:
 * P12's digest job calls `summarize(userId, weekStart)` directly. Returns `null` (digest is sent
 * without a summary) when there is no evidence, the quick-action quota is used up, AI is not
 * configured or the generation fails — a digest never fails because of the AI.
 */
@Injectable()
export class DigestSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inputs: DocumentInputs,
    private readonly generation: DocumentGenerationService,
    private readonly usage: UsageService,
    private readonly generator: StructuredGenerator,
  ) {}

  async summarize(
    userId: string,
    weekStart: string,
  ): Promise<{ documentId: string; content: DigestSummaryContent; cached: boolean } | null> {
    const prepared = await this.inputs.prepareDigest(userId, weekStart);
    if (prepared.pack.items.length === 0) return null;

    const cached = await this.prisma.generatedDocument.findFirst({
      where: { userId, inputHash: prepared.inputHash, status: DocumentStatus.READY },
      orderBy: { createdAt: 'desc' },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (cached?.versions[0]) {
      return {
        documentId: cached.id,
        content: cached.versions[0].content as unknown as DigestSummaryContent,
        cached: true,
      };
    }
    if (!(await this.ready(userId))) return null;

    const doc = await this.prisma.generatedDocument.create({
      data: {
        userId,
        type: DocumentType.DIGEST_SUMMARY,
        title: prepared.title,
        options: prepared.options as Prisma.InputJsonValue,
        periodStart: prepared.period ? new Date(`${prepared.period.startDate}T00:00:00Z`) : null,
        periodEnd: prepared.period ? new Date(`${prepared.period.endDate}T00:00:00Z`) : null,
        timezone: prepared.timezone,
        promptId: prepared.prompt.id,
        promptVersion: prepared.prompt.version,
        model: prepared.model,
        inputHash: prepared.inputHash,
        evidenceRefs: prepared.pack.items.map((i) => i.ref),
      },
    });
    const result = await this.generation.run({ documentId: doc.id, version: 1 }, { stream: false });
    if (!result.ok) return null;
    // user-scope: document created for this user just above.
    const version = await this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId: doc.id, version: 1 } },
    });
    return version
      ? { documentId: doc.id, content: version.content as unknown as DigestSummaryContent, cached: false }
      : null;
  }

  private async ready(userId: string): Promise<boolean> {
    if (!this.generator.configured) return false;
    try {
      await this.usage.assertQuota(userId, 'quick');
      return true;
    } catch {
      return false;
    }
  }
}
