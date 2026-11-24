import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { DigestScheduler } from './digest-scheduler.service';
import { DigestService } from './digest.service';
import { EMAIL_JOBS, EMAIL_QUEUE, type DigestJobData } from './email.constants';

/** Consumer of the `email` queue (worker; also the API when RUN_WORKER_IN_API=true). */
@Processor(EMAIL_QUEUE, { concurrency: 5 })
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly digests: DigestService,
    private readonly scheduler: DigestScheduler,
  ) {
    super();
  }

  async process(job: Job<DigestJobData>): Promise<unknown> {
    switch (job.name) {
      case EMAIL_JOBS.digest:
        return this.digests.deliver(job.data);
      case EMAIL_JOBS.fanout:
        return this.scheduler.fanout(new Date());
      default:
        this.logger.warn({ name: job.name }, 'Unknown email job ignored');
        return null;
    }
  }
}
