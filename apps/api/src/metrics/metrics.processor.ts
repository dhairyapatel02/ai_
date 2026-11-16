import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { METRICS_QUEUE, type MetricsRecomputeJobData } from '../sync/sync.constants';

/**
 * Placeholder consumer for the `metrics` queue: the deterministic metrics engine arrives in P07.
 * Jobs are acknowledged (and logged) so the queue never grows while P07 is pending.
 */
@Processor(METRICS_QUEUE, { concurrency: 5 })
export class MetricsProcessor extends WorkerHost {
  private readonly logger = new Logger(MetricsProcessor.name);

  process(job: Job<MetricsRecomputeJobData>): Promise<{ skipped: true }> {
    this.logger.log(
      { userId: job.data.userId, from: job.data.from, to: job.data.to, reason: job.data.reason },
      'metrics.recompute received (no-op until P07)',
    );
    return Promise.resolve({ skipped: true });
  }
}
