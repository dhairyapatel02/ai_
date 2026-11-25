import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { IntegrationStatus, Provider, SyncTrigger } from '@prisma/client';
import { Queue } from 'bullmq';

import { PrismaService } from '../prisma/prisma.service';
import { FANOUT_SCHEDULER_ID, SYNC_JOBS, SYNC_QUEUE, type SyncJobData } from './sync.constants';
import { SyncService } from './sync.service';

/** Hourly cron for the fan-out job (BullMQ job scheduler, upserted idempotently on boot). */
export const FANOUT_PATTERN = '0 * * * *';

/**
 * Scheduled incremental sync (ADR-0007): an hourly `sync.fanout` enqueues every ACTIVE
 * integration whose jittered daily slot (`scheduleSlotMinute`, 0..1439 UTC) falls in the current
 * hour, delayed to that minute — so each active integration syncs once per 24 h. NEEDS_REAUTH,
 * SUSPENDED and DISCONNECTED integrations are paused simply by not being ACTIVE.
 */
@Injectable()
export class SyncScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SyncScheduler.name);

  constructor(
    @InjectQueue(SYNC_QUEUE) private readonly queue: Queue<SyncJobData>,
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.register();
  }

  async register(): Promise<void> {
    await this.queue.upsertJobScheduler(
      FANOUT_SCHEDULER_ID,
      { pattern: FANOUT_PATTERN, tz: 'UTC' },
      {
        name: SYNC_JOBS.fanout,
        data: {} as SyncJobData,
        opts: { removeOnComplete: true, removeOnFail: 50 },
      },
    );
    this.logger.log(`Job scheduler "${FANOUT_SCHEDULER_ID}" registered (${FANOUT_PATTERN})`);
  }

  async fanout(now = new Date()): Promise<{ queued: number; skipped: number }> {
    const hourStart = now.getUTCHours() * 60;
    // user-scope: the scheduler deliberately scans every user's ACTIVE integrations.
    const due = await this.prisma.integration.findMany({
      where: {
        // Every provider (P13): GitHub, GitLab, Jira and Linear each once per 24 h at their slot.
        status: IntegrationStatus.ACTIVE,
        scheduleSlotMinute: { gte: hourStart, lt: hourStart + 60 },
      },
      select: { id: true, userId: true, scheduleSlotMinute: true },
    });
    const elapsed = now.getUTCMinutes() * 60_000 + now.getUTCSeconds() * 1000;
    let queued = 0;
    let skipped = 0;
    for (const integration of due) {
      try {
        await this.sync.requestSync(integration.userId, {
          integrationId: integration.id,
          trigger: SyncTrigger.SCHEDULED,
          delayMs: Math.max(0, (integration.scheduleSlotMinute - hourStart) * 60_000 - elapsed),
          reuseActive: true,
        });
        queued++;
      } catch (error) {
        skipped++;
        this.logger.warn(
          { integrationId: integration.id, err: error },
          'Scheduled sync not queued',
        );
      }
    }
    this.logger.log({ queued, skipped, hour: now.getUTCHours() }, 'sync.fanout done');
    return { queued, skipped };
  }
}
