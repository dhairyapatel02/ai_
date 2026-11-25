import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { EMAIL_JOBS, EMAIL_QUEUE, type NotificationJobData } from './email.constants';

/**
 * Enqueues transactional notification emails (`email.send`, F-65): "document ready" and "sync
 * problem". Preferences are checked by the worker at send time; producers never fail their caller.
 * Job ids dedupe: one email per document version, one per integration, problem and UTC day.
 */
@Injectable()
export class NotificationProducer {
  private readonly logger = new Logger(NotificationProducer.name);

  constructor(@InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<NotificationJobData>) {}

  async documentReady(userId: string, documentId: string, version: number): Promise<void> {
    await this.add(
      { kind: 'document_ready', userId, documentId },
      `notify-doc-${documentId}-${String(version)}`,
    );
  }

  async syncProblem(
    userId: string,
    integrationId: string,
    problem: 'needs_reauth' | 'sync_failed',
    now = new Date(),
  ): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    await this.add(
      { kind: 'sync_problem', userId, integrationId, problem },
      `notify-sync-${integrationId}-${problem}-${day}`,
    );
  }

  private async add(data: NotificationJobData, jobId: string): Promise<void> {
    try {
      await this.queue.add(EMAIL_JOBS.send, data, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 2 * 86_400 },
        removeOnFail: { age: 7 * 86_400 },
      });
    } catch (error) {
      this.logger.warn({ jobId, err: (error as Error).name }, 'notification email not queued');
    }
  }
}
