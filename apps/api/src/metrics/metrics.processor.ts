import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { METRICS_JOBS, METRICS_QUEUE, type MetricsRecomputeJobData } from '../sync/sync.constants';
import { MetricsRecomputeService } from './metrics-recompute.service';
import { MetricsScheduler } from './metrics-scheduler.service';

/**
 * Consumer of the `metrics` queue (worker; also the API when RUN_WORKER_IN_API=true):
 * `metrics.recompute` (rollups + score invalidation) and `metrics.nightly` (scheduler fan-out).
 */
@Processor(METRICS_QUEUE, { concurrency: 5 })
export class MetricsProcessor extends WorkerHost {
  private readonly logger = new Logger(MetricsProcessor.name);

  constructor(
    private readonly recompute: MetricsRecomputeService,
    private readonly scheduler: MetricsScheduler,
  ) {
    super();
  }

  async process(job: Job<MetricsRecomputeJobData>): Promise<unknown> {
    switch (job.name) {
      case METRICS_JOBS.recompute:
        return this.recompute.handle(job.data);
      case METRICS_JOBS.nightly:
        return this.scheduler.nightly(new Date());
      default:
        this.logger.warn({ name: job.name }, 'Unknown metrics job ignored');
        return null;
    }
  }
}
