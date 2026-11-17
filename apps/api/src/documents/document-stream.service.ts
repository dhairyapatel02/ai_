import { Inject, Injectable, Logger } from '@nestjs/common';
import { DocumentStatus, type GeneratedDocument } from '@prisma/client';
import Redis from 'ioredis';

import { DocEventsService, TERMINAL_EVENTS, type StreamEntry } from '../ai/doc-events.service';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

import type { Request, Response } from 'express';

/** `sse` rate class (API_CONTRACT_V2 §1.1): concurrent streams per user. */
export const MAX_STREAMS_PER_USER = 10;
const HEARTBEAT_MS = 15_000;
const BLOCK_MS = 5_000;
/** Hard cap for one connection; clients reconnect with Last-Event-ID. */
const MAX_STREAM_MS = 15 * 60_000;
const STREAM_ID = /^\d{1,20}-\d{1,20}$/;

export interface StreamOptions {
  heartbeatMs?: number;
}

/**
 * Relays a document's Redis Stream as Server-Sent Events (API_CONTRACT_V2 §13.3): replays from
 * `Last-Event-ID` (or the beginning), forwards new events until a terminal one (`done`, `error`,
 * `cancelled`), sends `: heartbeat` comments every 15 s. A document that is already finished
 * gets `status` + its terminal event immediately (also when the stream has expired).
 */
@Injectable()
export class DocumentStreamService {
  private readonly logger = new Logger(DocumentStreamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DocEventsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async stream(
    userId: string,
    id: string,
    lastEventId: string | undefined,
    req: Request,
    res: Response,
    opts: StreamOptions = {},
  ): Promise<void> {
    const doc = await this.prisma.generatedDocument.findFirst({ where: { id, userId } });
    if (!doc) throw AppException.notFound('Document');

    const counter = `sse:${userId}`;
    const open = await this.redis.incr(counter);
    await this.redis.expire(counter, 3600);
    if (open > MAX_STREAMS_PER_USER) {
      await this.redis.decr(counter);
      throw new AppException('RATE_LIMITED', 'Too many open streams', {
        class: 'sse',
        retryAfterSeconds: 5,
      });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    let conn: Redis | null = null;
    const write = (entry: { id?: string; event: string; data: unknown }) => {
      if (closed) return;
      res.write(
        `${entry.id ? `id: ${entry.id}\n` : ''}event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`,
      );
    };
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': heartbeat\n\n');
    }, opts.heartbeatMs ?? HEARTBEAT_MS);
    req.on('close', () => {
      closed = true;
      conn?.disconnect();
    });

    try {
      if (this.terminal(doc)) {
        this.writeFinished(doc, write);
        return;
      }
      conn = this.events.connection();
      let last = lastEventId && STREAM_ID.test(lastEventId) ? lastEventId : '0';
      const deadline = Date.now() + MAX_STREAM_MS;
      while (!closed && Date.now() < deadline) {
        let entries: StreamEntry[];
        try {
          entries = await this.events.read(conn, doc.id, last, BLOCK_MS);
        } catch (error) {
          if (closed) return;
          throw error;
        }
        for (const entry of entries) {
          write(entry);
          last = entry.id;
          if (TERMINAL_EVENTS.has(entry.event)) return;
        }
        if (entries.length === 0) {
          // Stream expired or the worker died: fall back to the database state.
          const fresh = await this.prisma.generatedDocument.findFirst({ where: { id, userId } });
          if (!fresh) {
            write({
              event: 'error',
              data: { code: 'NOT_FOUND', message: 'Document deleted', retryable: false },
            });
            return;
          }
          if (this.terminal(fresh)) {
            this.writeFinished(fresh, write);
            return;
          }
        }
      }
    } catch (error) {
      this.logger.warn({ err: error, documentId: id }, 'Document stream failed');
      write({
        event: 'error',
        data: { code: 'INTERNAL', message: 'The event stream was interrupted.', retryable: true },
      });
    } finally {
      clearInterval(heartbeat);
      conn?.disconnect();
      await this.redis.decr(counter).catch(() => undefined);
      if (!res.writableEnded) res.end();
    }
  }

  private terminal(doc: GeneratedDocument): boolean {
    return (
      doc.status === DocumentStatus.READY ||
      doc.status === DocumentStatus.FAILED ||
      doc.status === DocumentStatus.CANCELLED
    );
  }

  private writeFinished(
    doc: GeneratedDocument,
    write: (entry: { event: string; data: unknown }) => void,
  ) {
    write({ event: 'status', data: { status: 'streaming', version: doc.currentVersion } });
    if (doc.status === DocumentStatus.READY) {
      write({
        event: 'done',
        data: {
          documentId: doc.id,
          version: doc.currentVersion,
          citationCoverage: doc.citationCoverage,
          flags: { uncited: doc.flagsUncited ?? 0, invalid: doc.flagsInvalid ?? 0 },
        },
      });
    } else if (doc.status === DocumentStatus.CANCELLED) {
      write({ event: 'cancelled', data: { documentId: doc.id } });
    } else {
      write({
        event: 'error',
        data: {
          code: doc.errorCode ?? 'GENERATION_FAILED',
          message: "The draft couldn't be finished. Nothing was counted against your quota.",
          retryable: true,
        },
      });
    }
  }
}
