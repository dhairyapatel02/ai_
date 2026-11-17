import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { IntegrationStatus } from '@prisma/client';
import { Queue } from 'bullmq';

import { PrismaService } from '../prisma/prisma.service';
import {
  METRICS_JOBS,
  METRICS_NIGHTLY_SCHEDULER_ID,
  METRICS_QUEUE,
  type MetricsRecomputeJobData,
} from '../sync/sync.constants';
import { MetricsQueueService } from './metrics-queue.service';
import { MetricsRepository } from './metrics.repository';

/** 02:30 UTC daily (ARCHITECTURE_V2 §2). */
export const NIGHTLY_PATTERN = '30 2 * * *';
/** Safety window recomputed every night for active users (late webhooks, reverts, day changes). */
export const NIGHTLY_DAYS = 35;

/**
 * `metrics.nightly` (BullMQ job scheduler, upserted idempotently on worker boot — the pattern of
 * `SyncScheduler`): recomputes the last 35 days of every user with an active integration, and the
 * full history of users that have no snapshots yet (e.g. data that predates P07).
 */
@Injectable()
export class MetricsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MetricsScheduler.name);

  constructor(
    @InjectQueue(METRICS_QUEUE) private readonly queue: Queue<MetricsRecomputeJobData>,
    private readonly prisma: PrismaService,
    private readonly producer: MetricsQueueService,
    private readonly repo: MetricsRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.register();
  }

  async register(): Promise<void> {
    await this.queue.upsertJobScheduler(
      METRICS_NIGHTLY_SCHEDULER_ID,
      { pattern: NIGHTLY_PATTERN, tz: 'UTC' },
      {
        name: METRICS_JOBS.nightly,
        data: {} as MetricsRecomputeJobData,
        opts: { removeOnComplete: true, removeOnFail: 50 },
      },
    );
    this.logger.log(
      `Job scheduler "${METRICS_NIGHTLY_SCHEDULER_ID}" registered (${NIGHTLY_PATTERN})`,
    );
  }

  async nightly(now = new Date()): Promise<{ queued: number; full: number }> {
    // user-scope: the nightly job deliberately scans every user with an active integration.
    const integrations = await this.prisma.integration.findMany({
      where: { status: IntegrationStatus.ACTIVE },
      select: { userId: true },
      distinct: ['userId'],
    });
    const recentFrom = new Date(now.getTime() - NIGHTLY_DAYS * 86_400_000);
    let full = 0;
    for (const { userId } of integrations) {
      const bootstrap = !(await this.repo.hasSnapshots(userId));
      if (bootstrap) full++;
      await this.producer.enqueueRecompute({
        userId,
        from: (bootstrap ? new Date(0) : recentFrom).toISOString(),
        to: now.toISOString(),
        reason: 'nightly',
      });
    }
    this.logger.log({ queued: integrations.length, full }, 'metrics.nightly done');
    return { queued: integrations.length, full };
  }
}
