import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { IntegrationStatus, Provider } from '@prisma/client';
import { Queue } from 'bullmq';

import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { SYNC_QUEUE } from './sync.constants';

import type { SyncJobData } from './sync.processor';

/**
 * v0.1 sync trigger/status kept with v2 conventions (envelope, status codes, ownership). P06
 * replaces it with `POST /sync` + DB-backed `SyncRun`s; jobs carry ids only, never tokens.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectQueue(SYNC_QUEUE) private syncQueue: Queue<SyncJobData>,
    private prisma: PrismaService,
  ) {}

  private async activeIntegration(userId: string) {
    return this.prisma.integration.findFirst({
      where: { userId, provider: Provider.GITHUB, status: { not: IntegrationStatus.DISCONNECTED } },
      select: { id: true, status: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async triggerSync(userId: string) {
    const integration = await this.activeIntegration(userId);
    if (!integration) throw AppException.notFound('GitHub integration');
    if (integration.status === IntegrationStatus.NEEDS_REAUTH) {
      throw new AppException('INTEGRATION_NEEDS_REAUTH', 'Reconnect GitHub to sync again', {
        integrationId: integration.id,
        reconnectUrl: `/api/integrations/${integration.id}/reconnect`,
      });
    }
    return this.enqueue(userId, integration.id);
  }

  /** Called after a successful connect (backfill). */
  async enqueueInitial(userId: string, integrationId: string) {
    return this.enqueue(userId, integrationId);
  }

  private async enqueue(userId: string, integrationId: string) {
    const job = await this.syncQueue.add('sync-github', { userId, integrationId });
    this.logger.log({ jobId: job.id, userId, integrationId }, 'Sync job queued');
    return { jobId: job.id ?? null, status: 'queued' as const };
  }

  async getSyncStatus(userId: string) {
    const jobs = await this.syncQueue.getJobs(['active', 'waiting', 'completed', 'failed']);
    const userJobs = jobs.filter((j) => j.data.userId === userId);

    if (userJobs.length === 0) {
      return { status: 'idle', jobId: null, progress: null, lastSync: null };
    }

    const latest = userJobs.sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!latest) return { status: 'idle', jobId: null, progress: null, lastSync: null };
    const state = await latest.getState();

    return {
      status: state,
      jobId: latest.id ?? null,
      progress: latest.progress,
      lastSync: latest.finishedOn ? new Date(latest.finishedOn).toISOString() : null,
    };
  }
}
