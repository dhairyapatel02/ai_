import { Injectable, Logger } from '@nestjs/common';
import { AiFeature, DocumentStatus, VersionSource } from '@prisma/client';

import { AiConfig } from '../ai/ai.config';
import { AiError } from '../ai/ai.errors';
import { DocEventsService } from '../ai/doc-events.service';
import { PartialJsonSections } from '../ai/partial-json';
import {
  GenerationFailure,
  StructuredGenerator,
  type AiCallRecord,
} from '../ai/structured-generator';
import { NotificationProducer } from '../email/notification-producer';
import { allowedRefs, verifyCitations } from '../evidence/citation-verifier';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { mergeSection, validateContent } from './content';
import { DocumentInputs } from './document-inputs.service';
import { toTypeWire } from './document.mapper';

import type { AiGenerateJobData, AiJobResult } from '../ai/ai.constants';

/** Versions kept per document (DATA_MODEL_V2 §6). */
export const MAX_VERSIONS = 50;
const CANCEL_POLL_MS = 500;
const DELTA_FLUSH_MS = 250;

/**
 * Worker-side generation of one document version (ADR-0009, ARCHITECTURE_V2 §8): rebuilds the
 * deterministic evidence, streams from Anthropic while publishing `status`/`section`/`delta`
 * events to the document's Redis Stream, validates (one repair), verifies citations, merges
 * engine-filled sections, saves the `DocumentVersion` and `AiUsage`, then publishes `done`
 * (or `error` / `cancelled`). Quick actions run the same path without streaming events.
 */
@Injectable()
export class DocumentGenerationService {
  private readonly logger = new Logger(DocumentGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inputs: DocumentInputs,
    private readonly generator: StructuredGenerator,
    private readonly events: DocEventsService,
    private readonly usage: UsageService,
    private readonly ai: AiConfig,
    private readonly notifications: NotificationProducer,
  ) {}

  async run(job: AiGenerateJobData, opts: { stream: boolean }): Promise<AiJobResult> {
    // user-scope: the job carries only the document id our API created; every later query uses doc.userId.
    const doc = await this.prisma.generatedDocument.findUnique({ where: { id: job.documentId } });
    if (doc?.status !== DocumentStatus.PENDING) {
      return {
        ok: false,
        error: {
          kind: 'aborted',
          code: 'CANCELLED',
          message: 'Document is not pending.',
          retryable: false,
        },
      };
    }
    const userId = doc.userId;
    const type = toTypeWire(doc.type);
    const publish = opts.stream
      ? (event: Parameters<DocEventsService['publish']>[1], data: unknown) =>
          this.events.publish(doc.id, event, data as never).catch((error: unknown) => {
            this.logger.warn(
              { err: error, documentId: doc.id },
              'Could not publish document event',
            );
          })
      : () => Promise.resolve();

    const claimed = await this.prisma.generatedDocument.updateMany({
      where: { id: doc.id, userId, status: DocumentStatus.PENDING },
      data: { status: DocumentStatus.STREAMING },
    });
    if (claimed.count === 0) {
      return {
        ok: false,
        error: {
          kind: 'aborted',
          code: 'CANCELLED',
          message: 'Document is not pending.',
          retryable: false,
        },
      };
    }
    await publish('status', { status: 'streaming', version: job.version });

    const controller = new AbortController();
    const poll = setInterval(() => {
      void this.events.isCancelled(doc.id).then(
        (cancelled) => {
          if (cancelled) controller.abort();
        },
        () => undefined,
      );
    }, CANCEL_POLL_MS);
    poll.unref();

    let calls: AiCallRecord[] = [];
    try {
      const prepared = await this.inputs.prepare(userId, type, doc.options, {
        ...(job.section ? { section: job.section } : {}),
      });
      const allowed = allowedRefs(prepared.pack.items);

      // Stream sections/deltas (coalesced so the stream stays well under MAXLEN).
      let pendingDelta: { key: string; text: string } | null = null;
      let lastFlush = 0;
      const flushDelta = () => {
        if (pendingDelta) void publish('delta', pendingDelta);
        pendingDelta = null;
        lastFlush = Date.now();
      };
      const scanner = new PartialJsonSections({
        onSection: (key, index, value) => {
          flushDelta();
          const content = verifyCitations(value, allowed).content;
          void publish('section', { key, index, content });
        },
        onDelta: (key, text) => {
          if (pendingDelta && pendingDelta.key !== key) flushDelta();
          pendingDelta = { key, text: (pendingDelta?.text ?? '') + text };
          if (Date.now() - lastFlush >= DELTA_FLUSH_MS) flushDelta();
        },
      });

      const result = await prepared.run(this.generator, {
        signal: controller.signal,
        ...(opts.stream
          ? {
              onText: (delta: string) => {
                scanner.push(delta);
              },
            }
          : {}),
        timeoutMs: opts.stream ? this.ai.timeoutMs : this.ai.quickTimeoutMs,
      });
      flushDelta();
      calls = result.calls;

      let content: unknown = result.content;
      if (job.section && doc.currentVersion > 0) {
        // user-scope: versions of the document loaded for this job (scoped by doc.userId).
        const previous = await this.prisma.documentVersion.findUnique({
          where: { documentId_version: { documentId: doc.id, version: doc.currentVersion } },
        });
        if (previous) content = mergeSection(type, previous.content, content, job.section);
      }
      const verified = verifyCitations(content, allowed);
      const valid = validateContent(type, verified.content);
      if (!valid.success) {
        throw new GenerationFailure(
          new AiError(
            'output_invalid',
            `Final content invalid: ${valid.error.issues[0]?.message ?? ''}`,
          ),
          calls,
        );
      }

      const saved = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.generatedDocument.updateMany({
          where: { id: doc.id, userId, status: DocumentStatus.STREAMING },
          data: {
            status: DocumentStatus.READY,
            currentVersion: job.version,
            citationCoverage: verified.coverage,
            flagsUncited: verified.uncited,
            flagsInvalid: verified.invalid,
            evidenceRefs: prepared.pack.items.map((i) => i.ref),
            model: result.model,
            promptId: prepared.prompt.id,
            promptVersion: prepared.prompt.version,
            errorCode: null,
          },
        });
        if (updated.count === 0) return false; // cancelled meanwhile
        // user-scope: versions of the document loaded for this job (scoped by doc.userId).
        await tx.documentVersion.create({
          data: {
            documentId: doc.id,
            version: job.version,
            content: valid.data,
            source: VersionSource.AI,
          },
        });
        // user-scope: versions of the document loaded for this job (scoped by doc.userId).
        await tx.documentVersion.deleteMany({
          where: { documentId: doc.id, version: { lte: job.version - MAX_VERSIONS } },
        });
        return true;
      });
      if (!saved) throw new GenerationFailure(new AiError('aborted', 'Cancelled'), calls);

      await this.usage.record(userId, doc.id, prepared.prompt.feature, calls, true);
      await publish('done', {
        documentId: doc.id,
        version: job.version,
        citationCoverage: verified.coverage,
        flags: { uncited: verified.uncited, invalid: verified.invalid },
      });
      // "Document ready" email for studio documents (opt-in, F-65); quick actions never email.
      if (opts.stream) await this.notifications.documentReady(userId, doc.id, job.version);
      return { ok: true };
    } catch (raw) {
      const crashed = !(raw instanceof GenerationFailure) && !(raw instanceof AiError);
      const failure =
        raw instanceof GenerationFailure
          ? raw
          : new GenerationFailure(
              raw instanceof AiError ? raw : new AiError('unavailable', 'Generation failed'),
              calls,
            );
      if (crashed)
        this.logger.error({ err: raw, documentId: doc.id }, 'Document generation crashed');
      const { error } = failure;
      const errorCode = crashed ? 'GENERATION_FAILED' : error.code;
      const cancelled = error.kind === 'aborted';
      await this.prisma.generatedDocument.updateMany({
        where: {
          id: doc.id,
          userId,
          status: { in: [DocumentStatus.STREAMING, DocumentStatus.PENDING] },
        },
        data: cancelled
          ? { status: DocumentStatus.CANCELLED, errorCode: null }
          : { status: DocumentStatus.FAILED, errorCode },
      });
      await this.usage.record(userId, doc.id, AiFeature[doc.type], failure.calls, false);
      if (cancelled) await publish('cancelled', { documentId: doc.id });
      else {
        this.logger.warn(
          { documentId: doc.id, kind: error.kind, msg: error.message },
          'Generation failed',
        );
        await publish('error', {
          code: errorCode,
          message: error.userMessage,
          retryable: error.retryable,
        });
      }
      return {
        ok: false,
        error: {
          kind: error.kind,
          code: errorCode,
          message: error.userMessage,
          retryable: error.retryable,
        },
      };
    } finally {
      clearInterval(poll);
    }
  }
}
