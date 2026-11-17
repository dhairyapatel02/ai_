import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { redisOptionsFromUrl } from '../config/redis';
import { AiConfig } from './ai.config';

import type { Env } from '../config/env';
import type { DocumentStreamEvent, DocumentStreamEventName } from '@devimpact/shared';

/** Max entries per document stream (ARCHITECTURE_V2 §8: `MAXLEN ~ 2000`). */
const STREAM_MAXLEN = 2000;

export interface StreamEntry {
  id: string;
  event: DocumentStreamEventName;
  data: unknown;
}

export const TERMINAL_EVENTS: ReadonlySet<string> = new Set(['done', 'error', 'cancelled']);

/**
 * Generation events in Redis Streams (ADR-0009): the worker XADDs `status`/`section`/`delta`/
 * terminal events to `devimpact:doc-events:<QUEUE_PREFIX>:<documentId>` (TTL = AI_STREAM_TTL_SECONDS),
 * the API relays them over SSE with `Last-Event-ID` resume. Cancellation is a Redis flag the
 * worker polls. Uses its own connections without ioredis `keyPrefix` (stream commands + blocking
 * reads); keys are spelled out in full.
 */
@Injectable()
export class DocEventsService implements OnApplicationShutdown {
  private readonly prefix: string;
  private readonly url: string;
  private writer: Redis | null = null;

  constructor(
    config: ConfigService<Env, true>,
    private readonly ai: AiConfig,
  ) {
    this.prefix = config.get('QUEUE_PREFIX', { infer: true });
    this.url = config.get('REDIS_URL', { infer: true });
  }

  streamKey(documentId: string): string {
    return `devimpact:doc-events:${this.prefix}:${documentId}`;
  }

  private cancelKey(documentId: string): string {
    return `devimpact:doc-cancel:${this.prefix}:${documentId}`;
  }

  /** A fresh connection (blocking reads need their own). Caller disconnects it. */
  connection(): Redis {
    const client = new Redis({ ...redisOptionsFromUrl(this.url), maxRetriesPerRequest: 2 });
    client.on('error', () => undefined);
    return client;
  }

  private client(): Redis {
    this.writer ??= this.connection();
    return this.writer;
  }

  async publish<E extends DocumentStreamEvent>(
    documentId: string,
    event: E['event'],
    data: E['data'],
  ): Promise<string> {
    const key = this.streamKey(documentId);
    const redis = this.client();
    const id = await redis.xadd(
      key,
      'MAXLEN',
      '~',
      STREAM_MAXLEN,
      '*',
      'event',
      event,
      'data',
      JSON.stringify(data),
    );
    await redis.expire(key, this.ai.streamTtlSeconds);
    return id ?? '';
  }

  /** Entries after `lastId` (blocking up to `blockMs`). */
  async read(conn: Redis, documentId: string, lastId: string, blockMs: number): Promise<StreamEntry[]> {
    const res = (await conn.xread(
      'COUNT',
      200,
      'BLOCK',
      blockMs,
      'STREAMS',
      this.streamKey(documentId),
      lastId,
    )) as [string, [string, string[]][]][] | null;
    if (!res) return [];
    return res.flatMap(([, entries]) =>
      entries.map(([id, fields]) => {
        const map: Record<string, string> = {};
        for (let i = 0; i + 1 < fields.length; i += 2) map[fields[i]] = fields[i + 1];
        let data: unknown = null;
        try {
          data = JSON.parse(map.data ?? 'null');
        } catch {
          data = null;
        }
        return { id, event: map.event as DocumentStreamEventName, data };
      }),
    );
  }

  async clear(documentId: string): Promise<void> {
    await this.client().del(this.streamKey(documentId), this.cancelKey(documentId));
  }

  async requestCancel(documentId: string): Promise<void> {
    await this.client().set(this.cancelKey(documentId), '1', 'EX', this.ai.streamTtlSeconds);
  }

  async isCancelled(documentId: string): Promise<boolean> {
    return (await this.client().exists(this.cancelKey(documentId))) === 1;
  }

  async onApplicationShutdown() {
    await this.writer?.quit().catch(() => this.writer?.disconnect());
  }
}
