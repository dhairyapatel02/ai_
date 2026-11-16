import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { METRICS_JOBS, METRICS_QUEUE, type MetricsRecomputeJobData } from '../sync/sync.constants';

/**
 * Producer for `metrics.recompute` (ARCHITECTURE_V2 §7). Debounced per user for 30 s with BullMQ
 * deduplication; P07 implements the consumer (merging ranges, rollups, score invalidation).
 */
@Injectable()
export class MetricsQueueService {
  private readonly logger = new Logger(MetricsQueueService.name);

  constructor(@InjectQueue(METRICS_QUEUE) private readonly queue: Queue<MetricsRecomputeJobData>) {}

  async enqueueRecompute(data: MetricsRecomputeJobData): Promise<void> {
    await this.queue.add(METRICS_JOBS.recompute, data, {
      deduplication: { id: `metrics-${data.userId}-${data.reason}`, ttl: 30_000 },
      removeOnComplete: true,
      removeOnFail: { age: 7 * 86_400 },
    });
    this.logger.debug(
      { userId: data.userId, from: data.from, to: data.to },
      'metrics.recompute queued',
    );
  }
}
