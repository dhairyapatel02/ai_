import {
  REGENERABLE_SECTIONS,
  STUDIO_DOCUMENT_TYPES,
  type CreateDocumentInput,
  type CreateDocumentResponse,
  type DocumentDetail,
  type DocumentListQuery,
  type DocumentOptions,
  type DocumentSummary,
  type PreviewEvidenceResponse,
  type RegenerateDocumentInput,
  type StudioDocumentType,
  type UpdateDocumentInput,
} from '@devimpact/shared';
import { Injectable } from '@nestjs/common';
import { DocumentStatus, Prisma, VersionSource, type GeneratedDocument } from '@prisma/client';

import { AiQueueService } from '../ai/ai-queue.service';
import { DocEventsService } from '../ai/doc-events.service';
import { StructuredGenerator } from '../ai/structured-generator';
import { AppException } from '../common/app-exception';
import {
  afterCursor,
  decodeCursor,
  decodeOffsetCursor,
  encodeOffsetCursor,
  toPage,
} from '../common/pagination';
import { verifyCitations } from '../evidence/citation-verifier';
import { RefResolver } from '../evidence/ref-resolver.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { preserveEngineSections, validateContent } from './content';
import { MAX_VERSIONS } from './document-generation.service';
import { DocumentInputs, type PreparedGeneration } from './document-inputs.service';
import {
  isLegacy,
  streamUrl,
  toSourceWire,
  toSummary,
  toTypeEnum,
  toTypeWire,
} from './document.mapper';

/** Default library listing (S11): studio documents and impact narratives. */
const LIBRARY_TYPES = ['RESUME', 'APPRAISAL', 'PROMOTION', 'IMPACT_NARRATIVE'] as const;
/** User edits within this window update the last edit version instead of adding one. */
const AUTOSAVE_WINDOW_MS = 30_000;
const ACTIVE: DocumentStatus[] = [DocumentStatus.PENDING, DocumentStatus.STREAMING];

export const notConfigured = () =>
  new AppException('UPSTREAM_UNAVAILABLE', 'AI generation is not configured on this server.', {
    provider: 'anthropic',
    reason: 'not_configured',
  });

const dateOnly = (d: string) => new Date(`${d}T00:00:00.000Z`);

/** Columns derived from a prepared generation (period, prompt, hash, evidence). */
export function generationColumns(prepared: PreparedGeneration) {
  return {
    title: prepared.title,
    options: prepared.options as Prisma.InputJsonValue,
    periodStart: prepared.period ? dateOnly(prepared.period.startDate) : null,
    periodEnd: prepared.period ? dateOnly(prepared.period.endDate) : null,
    timezone: prepared.timezone,
    promptId: prepared.prompt.id,
    promptVersion: prepared.prompt.version,
    model: prepared.model,
    inputHash: prepared.inputHash,
    evidenceRefs: prepared.pack.items.map((i) => i.ref),
  };
}

/**
 * Documents API (API_CONTRACT_V2 §13): library, versions, edits, creation with inputHash cache,
 * regenerate, cancel. Generation itself runs in the worker (`ai.generate`).
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inputs: DocumentInputs,
    private readonly generator: StructuredGenerator,
    private readonly queue: AiQueueService,
    private readonly events: DocEventsService,
    private readonly usage: UsageService,
    private readonly refs: RefResolver,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────────────────────

  async list(userId: string, query: DocumentListQuery) {
    const where: Prisma.GeneratedDocumentWhereInput = {
      userId,
      type: query.type ? toTypeEnum(query.type) : { in: [...LIBRARY_TYPES] },
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    // user-scope: `where` / the document was scoped by userId above.
    const total = await this.prisma.generatedDocument.count({ where });
    if (query.sort === '-createdAt') {
      // user-scope: `where` / the document was scoped by userId above.
      const rows = await this.prisma.generatedDocument.findMany({
        where: { ...where, ...afterCursor('createdAt', decodeCursor(query.cursor)) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = toPage(rows, query.limit, (row) => row.createdAt, total);
      return { items: page.items.map(toSummary), meta: page.meta };
    }
    const offset = decodeOffsetCursor(query.cursor);
    // user-scope: `where` / the document was scoped by userId above.
    const rows = await this.prisma.generatedDocument.findMany({
      where,
      orderBy:
        query.sort === 'title'
          ? [{ title: 'asc' }, { id: 'asc' }]
          : [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    return {
      items: rows.slice(0, query.limit).map(toSummary),
      meta: {
        nextCursor: hasMore ? encodeOffsetCursor(offset + query.limit) : null,
        hasMore,
        total,
      },
    };
  }

  private async owned(userId: string, id: string): Promise<GeneratedDocument> {
    const doc = await this.prisma.generatedDocument.findFirst({ where: { id, userId } });
    if (!doc) throw AppException.notFound('Document');
    return doc;
  }

  async get(userId: string, id: string, versionNumber?: number): Promise<DocumentDetail> {
    const doc = await this.owned(userId, id);
    const number = versionNumber ?? doc.currentVersion;
    // user-scope: `doc` was loaded by { id, userId } just above.
    const version =
      number > 0
        ? // user-scope: `where` / the document was scoped by userId above.
          await this.prisma.documentVersion.findUnique({
            where: { documentId_version: { documentId: doc.id, version: number } },
          })
        : null;
    if (versionNumber !== undefined && !version) throw AppException.notFound('Version');
    const citedRefs = version ? collectCitations(version.content) : [];
    return {
      document: {
        ...toSummary(doc),
        options: doc.options,
        evidenceRefs: doc.evidenceRefs,
        evidence: await this.refs.resolve(userId, citedRefs),
      },
      version: version
        ? {
            number: version.version,
            source: toSourceWire(version.source),
            createdAt: version.createdAt.toISOString(),
            content: version.content,
          }
        : null,
    };
  }

  async versions(userId: string, id: string, query: { cursor?: string; limit: number }) {
    const doc = await this.owned(userId, id);
    const offset = decodeOffsetCursor(query.cursor);
    // user-scope: `doc` was loaded by { id, userId } just above.
    const [rows, total] = await Promise.all([
      this.prisma.documentVersion.findMany({
        where: { documentId: doc.id },
        orderBy: { version: 'desc' },
        skip: offset,
        take: query.limit + 1,
        select: { version: true, source: true, createdAt: true },
      }),
      // user-scope: `where` / the document was scoped by userId above.
      this.prisma.documentVersion.count({ where: { documentId: doc.id } }),
    ]);
    const hasMore = rows.length > query.limit;
    return {
      items: rows.slice(0, query.limit).map((v) => ({
        number: v.version,
        source: toSourceWire(v.source),
        createdAt: v.createdAt.toISOString(),
      })),
      meta: {
        nextCursor: hasMore ? encodeOffsetCursor(offset + query.limit) : null,
        hasMore,
        total,
      },
    };
  }

  // ── Generation ─────────────────────────────────────────────────────────────────────────

  async previewEvidence(
    userId: string,
    options: DocumentOptions,
  ): Promise<PreviewEvidenceResponse> {
    const prepared = await this.inputs.prepareStudio(userId, options);
    const { period } = prepared;
    if (!period) throw new AppException('INTERNAL', 'The period could not be resolved.');
    const top = prepared.pack.items.slice(0, 25);
    return {
      period,
      counts: prepared.pack.counts,
      topEvidence: top.map((item) => ({
        ref: item.ref,
        kind: item.kind,
        id: item.id,
        title: item.title,
        repo: item.repo,
        url: item.url,
        occurredAt: item.occurredAt,
      })),
      metrics: prepared.pack.metricValues,
      estimatedQuotaCost: 1,
    };
  }

  async create(
    userId: string,
    input: CreateDocumentInput,
  ): Promise<CreateDocumentResponse & { status: 200 | 201 }> {
    const { regenerate, ...options } = input;
    const prepared = await this.inputs.prepareStudio(userId, options);
    if (prepared.pack.items.length === 0) {
      throw new AppException('CONFLICT', 'There is no activity in this period to write about.', {
        reason: 'no_evidence',
      });
    }
    if (!regenerate) {
      const cached = await this.prisma.generatedDocument.findFirst({
        where: {
          userId,
          inputHash: prepared.inputHash,
          status: { in: [DocumentStatus.READY, ...ACTIVE] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (cached) {
        return {
          status: 200,
          document: toSummary(cached),
          cached: true,
          streamUrl: cached.status === DocumentStatus.READY ? null : streamUrl(cached.id),
        };
      }
    }
    if (!this.generator.configured) throw notConfigured();
    await this.usage.assertQuota(userId, 'generations');

    const doc = await this.prisma.generatedDocument.create({
      data: {
        userId,
        type: toTypeEnum(prepared.type),
        status: DocumentStatus.PENDING,
        ...generationColumns(prepared),
      },
    });
    await this.events.publish(doc.id, 'status', { status: 'pending', version: 1 });
    await this.queue.enqueueGenerate({ documentId: doc.id, version: 1 });
    return { status: 201, document: toSummary(doc), cached: false, streamUrl: streamUrl(doc.id) };
  }

  async regenerate(userId: string, id: string, input: RegenerateDocumentInput) {
    const doc = await this.owned(userId, id);
    const type = toTypeWire(doc.type);
    if (!(STUDIO_DOCUMENT_TYPES as readonly string[]).includes(type) || isLegacy(doc)) {
      throw new AppException('CONFLICT', 'This document cannot be regenerated.', {
        reason: isLegacy(doc) ? 'legacy_document' : 'not_regenerable',
      });
    }
    if (ACTIVE.includes(doc.status)) {
      throw new AppException('GENERATION_IN_PROGRESS', 'The document is being generated.', {
        documentId: doc.id,
      });
    }
    if (input.section) {
      const allowed = REGENERABLE_SECTIONS[type as StudioDocumentType];
      if (!allowed.includes(input.section) || doc.currentVersion === 0) {
        throw new AppException('VALIDATION_FAILED', 'The request is invalid', {
          issues: [
            {
              path: 'body.section',
              message: `Expected one of ${allowed.join(', ')}`,
              code: 'custom',
            },
          ],
        });
      }
    }
    const merged = { ...(doc.options as Record<string, unknown>), ...(input.options ?? {}), type };
    const prepared = await this.inputs.prepareStudio(userId, merged, input.section);
    if (!this.generator.configured) throw notConfigured();
    await this.usage.assertQuota(userId, 'generations');

    const version = doc.currentVersion + 1;
    const updated = await this.prisma.generatedDocument.updateMany({
      where: { id: doc.id, userId, status: { notIn: ACTIVE } },
      data: {
        status: DocumentStatus.PENDING,
        errorCode: null,
        ...generationColumns(prepared),
      },
    });
    if (updated.count === 0) {
      throw new AppException('GENERATION_IN_PROGRESS', 'The document is being generated.', {
        documentId: doc.id,
      });
    }
    await this.events.clear(doc.id);
    await this.events.publish(doc.id, 'status', { status: 'pending', version });
    await this.queue.enqueueGenerate({
      documentId: doc.id,
      version,
      ...(input.section ? { section: input.section } : {}),
    });
    const fresh = await this.owned(userId, id);
    return { document: toSummary(fresh), streamUrl: streamUrl(doc.id) };
  }

  async cancel(userId: string, id: string): Promise<{ document: DocumentSummary }> {
    const doc = await this.owned(userId, id);
    if (!ACTIVE.includes(doc.status)) {
      throw new AppException('CONFLICT', 'The document is not being generated.', {
        reason: 'not_in_progress',
      });
    }
    await this.events.requestCancel(doc.id);
    const updated = await this.prisma.generatedDocument.updateMany({
      where: { id: doc.id, userId, status: { in: ACTIVE } },
      data: { status: DocumentStatus.CANCELLED },
    });
    if (updated.count > 0) await this.events.publish(doc.id, 'cancelled', { documentId: doc.id });
    return { document: toSummary(await this.owned(userId, id)) };
  }

  // ── Edits & versions ───────────────────────────────────────────────────────────────────

  private assertEditable(doc: GeneratedDocument) {
    if (ACTIVE.includes(doc.status)) {
      throw new AppException('GENERATION_IN_PROGRESS', 'The document is being generated.', {
        documentId: doc.id,
      });
    }
  }

  async update(userId: string, id: string, input: UpdateDocumentInput) {
    const doc = await this.owned(userId, id);
    this.assertEditable(doc);
    if (input.baseVersion !== doc.currentVersion) {
      throw new AppException('VERSION_CONFLICT', 'A newer version of this document exists.', {
        currentVersion: doc.currentVersion,
      });
    }
    if (input.content === undefined) {
      if (input.title) {
        await this.prisma.generatedDocument.updateMany({
          where: { id: doc.id, userId },
          data: { title: input.title },
        });
      }
      return this.get(userId, id);
    }
    if (isLegacy(doc) || doc.currentVersion === 0) {
      throw new AppException('CONFLICT', 'Imported documents are read-only.', {
        reason: 'legacy_document',
      });
    }
    const type = toTypeWire(doc.type);
    // user-scope: `doc` was loaded by { id, userId } above.
    const base = await this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId: doc.id, version: doc.currentVersion } },
    });
    const edited = preserveEngineSections(type, base?.content, input.content);
    const allowed = new Map(doc.evidenceRefs.map((r) => [r, r]));
    const verified = verifyCitations(edited, allowed);
    const valid = validateContent(type, verified.content);
    if (!valid.success) {
      throw new AppException('VALIDATION_FAILED', 'The request is invalid', {
        issues: valid.error.issues.map((i) => ({
          path: ['body', 'content', ...i.path.map(String)].join('.'),
          message: i.message,
          code: i.code,
        })),
      });
    }
    const content = valid.data as Prisma.InputJsonValue;
    const reuse =
      base !== null &&
      base.source === VersionSource.USER_EDIT &&
      Date.now() - base.createdAt.getTime() < AUTOSAVE_WINDOW_MS;
    await this.prisma.$transaction(async (tx) => {
      const next = reuse ? doc.currentVersion : doc.currentVersion + 1;
      if (reuse) {
        // user-scope: version of the document loaded by { id, userId }.
        await tx.documentVersion.update({
          where: { documentId_version: { documentId: doc.id, version: next } },
          data: { content },
        });
      } else {
        // user-scope: `where` / the document was scoped by userId above.
        await tx.documentVersion.create({
          data: { documentId: doc.id, version: next, content, source: VersionSource.USER_EDIT },
        });
      }
      const moved = await tx.generatedDocument.updateMany({
        where: {
          id: doc.id,
          userId,
          currentVersion: doc.currentVersion,
          status: { notIn: ACTIVE },
        },
        data: {
          currentVersion: next,
          ...(input.title ? { title: input.title } : {}),
          citationCoverage: verified.coverage,
          flagsUncited: verified.uncited,
          flagsInvalid: verified.invalid,
        },
      });
      if (moved.count === 0) {
        throw new AppException('VERSION_CONFLICT', 'A newer version of this document exists.', {
          currentVersion: doc.currentVersion,
        });
      }
      // user-scope: `where` / the document was scoped by userId above.
      await tx.documentVersion.deleteMany({
        where: { documentId: doc.id, version: { lte: next - MAX_VERSIONS } },
      });
    });
    return this.get(userId, id);
  }

  async restore(userId: string, id: string, number: number) {
    const doc = await this.owned(userId, id);
    this.assertEditable(doc);
    // user-scope: `doc` was loaded by { id, userId } above.
    const source = await this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId: doc.id, version: number } },
    });
    if (!source) throw AppException.notFound('Version');
    const next = doc.currentVersion + 1;
    const verified = isLegacy(doc)
      ? null
      : verifyCitations(source.content, new Map(doc.evidenceRefs.map((r) => [r, r])));
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.generatedDocument.updateMany({
        where: {
          id: doc.id,
          userId,
          currentVersion: doc.currentVersion,
          status: { notIn: ACTIVE },
        },
        data: {
          currentVersion: next,
          status: DocumentStatus.READY,
          errorCode: null,
          ...(verified
            ? {
                citationCoverage: verified.coverage,
                flagsUncited: verified.uncited,
                flagsInvalid: verified.invalid,
              }
            : {}),
        },
      });
      if (moved.count === 0) {
        throw new AppException('VERSION_CONFLICT', 'A newer version of this document exists.', {
          currentVersion: doc.currentVersion,
        });
      }
      // user-scope: `where` / the document was scoped by userId above.
      await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          version: next,
          content: (verified?.content ?? source.content) as Prisma.InputJsonValue,
          source: VersionSource.RESTORE,
        },
      });
      // user-scope: `where` / the document was scoped by userId above.
      await tx.documentVersion.deleteMany({
        where: { documentId: doc.id, version: { lte: next - MAX_VERSIONS } },
      });
    });
    return this.get(userId, id);
  }

  async delete(userId: string, id: string): Promise<{ deleted: true }> {
    const doc = await this.owned(userId, id);
    if (ACTIVE.includes(doc.status)) await this.events.requestCancel(doc.id);
    const { count } = await this.prisma.generatedDocument.deleteMany({ where: { id, userId } });
    if (count === 0) throw AppException.notFound('Document');
    return { deleted: true };
  }
}

/** Refs cited anywhere in a content tree (deduplicated, in order). */
export function collectCitations(content: unknown): string[] {
  const out = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (Array.isArray(obj.citations)) {
        for (const c of obj.citations) if (typeof c === 'string') out.add(c);
      }
      Object.values(obj).forEach(visit);
    }
  };
  visit(content);
  return [...out];
}
