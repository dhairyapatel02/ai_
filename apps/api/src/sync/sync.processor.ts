import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, Job } from 'bullmq';

import { SyncEngine } from './sync-engine.service';
import { SyncScheduler } from './sync-scheduler.service';
import { SyncTargetedService } from './sync-targeted.service';
import { SYNC_JOB_ATTEMPTS, SYNC_JOBS, SYNC_QUEUE, type SyncJobData } from './sync.constants';

import type { TargetedJobData } from '../webhooks/webhooks.service';

/**
 * Consumer of the `sync` queue (worker process; also the API when RUN_WORKER_IN_API=true).
 * Dispatches by job name: backfill/incremental runs, webhook-targeted refreshes, scheduler fan-out.
 */
@Processor(SYNC_QUEUE, { concurrency: 5 })
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(
    private readonly engine: SyncEngine,
    private readonly targeted: SyncTargetedService,
    private readonly scheduler: SyncScheduler,
  ) {
    super();
  }

  async process(
    job: Job<SyncJobData | TargetedJobData | Record<string, never>>,
    token?: string,
  ): Promise<unknown> {
    const attempt = { number: job.attemptsMade + 1, max: job.opts.attempts ?? SYNC_JOB_ATTEMPTS };
    switch (job.name) {
      case SYNC_JOBS.backfill:
      case SYNC_JOBS.incremental: {
        const data = job.data as SyncJobData;
        const outcome = await this.engine.run(data.syncRunId, data.userId, attempt);
        if (outcome.type === 'delayed') {
          // Rate limit: keep the same job (and its id) and resume after the reset (ADR-0007).
          await job.moveToDelayed(outcome.until.getTime(), token);
          throw new DelayedError();
        }
        return outcome;
      }
      case SYNC_JOBS.targeted:
        await this.targeted.handle(job.data as TargetedJobData, attempt);
        return { ok: true };
      case SYNC_JOBS.fanout:
        return this.scheduler.fanout(new Date());
      default:
        this.logger.warn({ name: job.name }, 'Unknown sync job ignored');
        return null;
    }
  }
}
