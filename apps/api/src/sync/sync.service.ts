import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Provider } from '@prisma/client';
import { Queue } from 'bullmq';

import { PrismaService } from '../prisma/prisma.service';
import { SYNC_QUEUE } from './sync.constants';

import type { SyncJobData } from './sync.processor';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectQueue(SYNC_QUEUE) private syncQueue: Queue<SyncJobData>,
    private prisma: PrismaService,
  ) {}

  async triggerSync(userId: string) {
    const integration = await this.prisma.integration.findUnique({
      where: { userId_provider: { userId, provider: Provider.GITHUB } },
    });

    if (!integration) {
      throw new Error('GitHub integration not connected');
    }

    const job = await this.syncQueue.add('sync-github', {
      userId,
      integrationId: integration.id,
    });

    this.logger.log(`Sync job ${job.id} queued for user ${userId}`);
    return { jobId: job.id, status: 'queued' };
  }

  async getSyncStatus(userId: string) {
    const jobs = await this.syncQueue.getJobs(['active', 'waiting', 'completed', 'failed']);
    const userJobs = jobs.filter((j) => j.data?.userId === userId);

    if (userJobs.length === 0) {
      return { status: 'idle', lastSync: null };
    }

    const latest = userJobs.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
    const state = await latest.getState();

    return {
      status: state,
      jobId: latest.id,
      progress: latest.progress,
      lastSync: latest.finishedOn ? new Date(latest.finishedOn) : null,
    };
  }
}
