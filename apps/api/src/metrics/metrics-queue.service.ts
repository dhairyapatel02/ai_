import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.module';
import {
  METRICS_DEBOUNCE_MS,
  METRICS_FAST_DELAY_MS,
  METRICS_JOBS,
  METRICS_QUEUE,
  metricsJobId,
  type MetricsRecomputeJobData,
} from '../sync/sync.constants';

import type { Env } from '../config/env';

/** Merges `[from, to]` (epoch ms) into the user's pending range atomically. */
const MERGE_RANGE = `
local from = tonumber(ARGV[1])
local to = tonumber(ARGV[2])
local curFrom = tonumber(redis.call('HGET', KEYS[1], 'from'))
local curTo = tonumber(redis.call('HGET', KEYS[1], 'to'))
if curFrom == nil or from < curFrom then redis.call('HSET', KEYS[1], 'from', from) end
if curTo == nil or to > curTo then redis.call('HSET', KEYS[1], 'to', to) end
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1`;

/** Reads and clears the pending range in one step. */
const TAKE_RANGE = `
local from = redis.call('HGET', KEYS[1], 'from')
local to = redis.call('HGET', KEYS[1], 'to')
redis.call('DEL', KEYS[1])
if from == false or to == false then return nil end
return { from, to }`;

/** Pending ranges expire after a week (the nightly recompute covers anything lost). */
const PENDING_TTL_MS = 7 * 86_400_000;

/**
 * Producer for `metrics.recompute` (ARCHITECTURE_V2 §2/§7). Affected ranges are merged per user in
 * Redis (min/max) and one delayed job per user is debounced (BullMQ deduplication: a new request
 * replaces the delayed job and extends its delay), so a sync that touches many slices causes one
 * recompute of the union of their ranges.
 */
@Injectable()
export class MetricsQueueService {
  private readonly logger = new Logger(MetricsQueueService.name);
  private readonly prefix: string;

  constructor(
    @InjectQueue(METRICS_QUEUE) private readonly queue: Queue<MetricsRecomputeJobData>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.prefix = config.get('QUEUE_PREFIX', { infer: true });
  }

  pendingKey(userId: string): string {
    return `metrics-pending:${this.prefix}:${userId}`;
  }

  async enqueueRecompute(data: MetricsRecomputeJobData): Promise<void> {
    const from = Date.parse(data.from);
    const to = Date.parse(data.to);
    await this.redis.eval(
      MERGE_RANGE,
      1,
      this.pendingKey(data.userId),
      String(Math.min(from, to)),
      String(Math.max(from, to)),
      String(PENDING_TTL_MS),
    );
    const fast = data.reason === 'timezone' || data.reason === 'repository_inclusion';
    const delay = fast ? METRICS_FAST_DELAY_MS : METRICS_DEBOUNCE_MS;
    await this.queue.add(METRICS_JOBS.recompute, data, {
      delay,
      deduplication: { id: metricsJobId(data.userId), ttl: delay, extend: true, replace: true },
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: { age: 7 * 86_400 },
    });
    this.logger.debug(
      { userId: data.userId, from: data.from, to: data.to, reason: data.reason },
      'metrics.recompute queued',
    );
  }

  /** The merged pending range (consumed by the recompute job), or null. */
  async takePending(userId: string): Promise<{ from: Date; to: Date } | null> {
    const raw = (await this.redis.eval(TAKE_RANGE, 1, this.pendingKey(userId))) as
      [string, string] | null;
    if (!raw) return null;
    return { from: new Date(Number(raw[0])), to: new Date(Number(raw[1])) };
  }
}
