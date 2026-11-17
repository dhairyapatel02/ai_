import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';

import { redisOptionsFromUrl } from '../config/redis';
import {
  AI_JOBS,
  AI_QUEUE,
  aiJobId,
  type AiGenerateJobData,
  type AiJobResult,
} from './ai.constants';

import type { Env } from '../config/env';

/**
 * Producer side of the `ai` queue: `ai.generate` (streamed documents, fire-and-forget) and
 * `ai.quick` (awaited by the API for at most `timeoutMs`, ARCHITECTURE_V2 §8). Jobs carry ids only.
 */
@Injectable()
export class AiQueueService implements OnModuleDestroy {
  private events: QueueEvents | null = null;

  constructor(
    @InjectQueue(AI_QUEUE) private readonly queue: Queue<AiGenerateJobData>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async enqueueGenerate(data: AiGenerateJobData): Promise<void> {
    await this.queue.add(AI_JOBS.generate, data, {
      jobId: aiJobId(data.documentId, data.version),
      attempts: 1, // retries happen inside AiClient, before any output is streamed
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
    });
  }

  private async queueEvents(): Promise<QueueEvents> {
    if (!this.events) {
      this.events = new QueueEvents(AI_QUEUE, {
        connection: redisOptionsFromUrl(this.config.get('REDIS_URL', { infer: true })),
        prefix: this.config.get('QUEUE_PREFIX', { infer: true }),
      });
      await this.events.waitUntilReady();
    }
    return this.events;
  }

  /** Runs a quick action in the worker and waits for it; `null` on timeout. */
  async runQuick(data: AiGenerateJobData, timeoutMs: number): Promise<AiJobResult | null> {
    const events = await this.queueEvents();
    const job = await this.queue.add(AI_JOBS.quick, data, {
      jobId: aiJobId(data.documentId, data.version),
      attempts: 1,
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600, count: 1000 },
    });
    try {
      return (await job.waitUntilFinished(events, timeoutMs)) as AiJobResult;
    } catch (error) {
      if (error instanceof Error && /timed out/i.test(error.message)) return null;
      return {
        ok: false,
        error: {
          kind: 'unavailable',
          code: 'GENERATION_FAILED',
          message: 'The AI job failed.',
          retryable: true,
        },
      };
    }
  }

  async onModuleDestroy() {
    await this.events?.close();
  }
}
