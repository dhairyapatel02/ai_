import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import {
  IntegrationStatus,
  Provider,
  SyncKind,
  SyncStatus,
  SyncTrigger,
  type Prisma,
  type SyncRun,
} from '@prisma/client';
import { Queue } from 'bullmq';

import { AppException } from '../common/app-exception';
import { afterCursor, decodeCursor, toPage } from '../common/pagination';
import { limitsFor } from '../entitlements/entitlements';
import { PrismaService } from '../prisma/prisma.service';
import { RATE_LIMIT_WINDOWS } from '../throttle/rate-limit';
import { nextSlotAfter, toSyncRunDto } from './sync-run.mapper';
import {
  CURSOR_OVERLAP_MS,
  SYNC_BACKOFF_MS,
  SYNC_JOB_ATTEMPTS,
  SYNC_JOBS,
  SYNC_QUEUE,
  type SyncJobData,
  syncJobId,
} from './sync.constants';

import type { SyncRunDto, SyncRunListQuery, SyncStatusDto } from '@devimpact/shared';

export const ACTIVE_RUN_STATUSES: SyncStatus[] = [
  SyncStatus.QUEUED,
  SyncStatus.RUNNING,
  SyncStatus.WAITING_RATE_LIMIT,
];
/** A queued/running run whose job vanished (e.g. Redis was flushed) is reaped after this. */
const ORPHAN_AFTER_MS = 2 * 60_000;

export interface RequestSyncOptions {
  integrationId?: string;
  trigger: SyncTrigger;
  /** Start the job later (scheduler jitter). */
  delayMs?: number;
  /** Return the active run instead of throwing SYNC_IN_PROGRESS (connect callback, scheduler). */
  reuseActive?: boolean;
}

/**
 * HTTP side of sync (API_CONTRACT_V2 §8): creates `SyncRun` rows and enqueues jobs that carry ids
 * only (never tokens). Status, progress and history are read from the database (DATA-06, BUG-08),
 * so they survive a Redis restart.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectQueue(SYNC_QUEUE) private readonly queue: Queue<SyncJobData>,
    private readonly prisma: PrismaService,
    // Absent in the worker process (no HTTP throttler); only manual syncs consume the quota.
    @Optional() @Inject(getStorageToken()) private readonly throttle?: ThrottlerStorage,
  ) {}

  private async integrationFor(userId: string, integrationId?: string) {
    const row = await this.prisma.integration.findFirst({
      where: integrationId
        ? { id: integrationId, userId }
        : { userId, provider: Provider.GITHUB, status: { not: IntegrationStatus.DISCONNECTED } },
      select: {
        id: true,
        userId: true,
        status: true,
        backfillFrom: true,
        syncCursor: true,
        scheduleSlotMinute: true,
        lastSuccessfulSyncAt: true,
        user: { select: { plan: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row) throw AppException.notFound('GitHub integration');
    return row;
  }

  /** `sync` rate class: 6 manual syncs per hour **per integration** (API_CONTRACT_V2 §1.1). */
  private async consumeManualQuota(integrationId: string): Promise<void> {
    if (!this.throttle) return;
    const { ttl, limit } = RATE_LIMIT_WINDOWS.sync;
    const record = await this.throttle.increment(
      `sync:integration:${integrationId}`,
      ttl,
      limit,
      ttl,
      'sync',
    );
    if (record.isBlocked) {
      throw new AppException('RATE_LIMITED', 'You can sync again later', {
        class: 'sync',
        retryAfterSeconds: record.timeToBlockExpire,
      });
    }
  }

  /** `POST /sync` and internal triggers (connect, reconnect, scheduler). */
  async requestSync(userId: string, options: RequestSyncOptions): Promise<SyncRunDto> {
    const integration = await this.integrationFor(userId, options.integrationId);
    if (integration.status === IntegrationStatus.NEEDS_REAUTH) {
      throw new AppException('INTEGRATION_NEEDS_REAUTH', 'Reconnect GitHub to sync again', {
        integrationId: integration.id,
        reconnectUrl: `/api/integrations/${integration.id}/reconnect`,
      });
    }
    if (integration.status === IntegrationStatus.DISCONNECTED) {
      throw new AppException('CONFLICT', 'This GitHub connection is disconnected');
    }
    if (options.trigger === SyncTrigger.MANUAL) await this.consumeManualQuota(integration.id);

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // user-scope: row lock by primary key of an integration loaded with userId above.
      await tx.$queryRaw`SELECT id FROM "integrations" WHERE id = ${integration.id} FOR UPDATE`;
      const active = await tx.syncRun.findFirst({
        where: {
          userId,
          integrationId: integration.id,
          status: { in: ACTIVE_RUN_STATUSES },
          kind: { not: SyncKind.TARGETED },
        },
        orderBy: { queuedAt: 'desc' },
      });
      if (active && !(await this.isOrphan(active, now))) return { run: active, created: false };
      if (active) {
        await tx.syncRun.updateMany({
          where: { id: active.id, userId },
          data: {
            status: SyncStatus.FAILED,
            finishedAt: now,
            errorCode: 'INTERNAL',
            errorMessage: 'The sync was interrupted. A new sync has been started.',
          },
        });
      }
      const kind = integration.backfillFrom ? SyncKind.INCREMENTAL : SyncKind.BACKFILL;
      const windowFrom = this.windowStart(kind, integration, now);
      const run = await tx.syncRun.create({
        data: {
          userId,
          integrationId: integration.id,
          trigger: options.trigger,
          kind,
          windowFrom,
          windowTo: now,
        },
      });
      return { run, created: true };
    });

    if (!result.created) {
      if (options.reuseActive) return toSyncRunDto(result.run);
      throw new AppException('SYNC_IN_PROGRESS', 'A sync is already running', {
        syncRunId: result.run.id,
        syncRun: toSyncRunDto(result.run),
      });
    }

    const run = result.run;
    const job = await this.queue.add(
      run.kind === SyncKind.BACKFILL ? SYNC_JOBS.backfill : SYNC_JOBS.incremental,
      { syncRunId: run.id, integrationId: integration.id, userId },
      {
        jobId: syncJobId(integration.id),
        attempts: SYNC_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: SYNC_BACKOFF_MS },
        delay: options.delayMs ?? 0,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    const updated = await this.prisma.syncRun.update({
      where: { id: run.id, userId },
      data: { jobId: job.id ?? null },
    });
    this.logger.log(
      { syncRunId: run.id, integrationId: integration.id, kind: run.kind, trigger: run.trigger },
      'Sync queued',
    );
    return toSyncRunDto(updated);
  }

  private windowStart(
    kind: SyncKind,
    integration: {
      backfillFrom: Date | null;
      syncCursor: Prisma.JsonValue;
      user: { plan: Parameters<typeof limitsFor>[0] };
    },
    now: Date,
  ): Date {
    if (kind === SyncKind.BACKFILL) {
      const from = new Date(now);
      from.setUTCMonth(from.getUTCMonth() - limitsFor(integration.user.plan).historyMonths);
      return from;
    }
    const cursor = (integration.syncCursor ?? {}) as Record<string, string | undefined>;
    const times = [cursor.authoredPrsUpdatedAt, cursor.reviewedPrsUpdatedAt]
      .filter((v): v is string => typeof v === 'string')
      .map((v) => Date.parse(v));
    const base = times.length
      ? Math.min(...times)
      : (integration.backfillFrom?.getTime() ?? now.getTime());
    return new Date(base - CURSOR_OVERLAP_MS);
  }

  private async isOrphan(run: SyncRun, now: Date): Promise<boolean> {
    if (now.getTime() - run.queuedAt.getTime() < ORPHAN_AFTER_MS) return false;
    const job = await this.queue.getJob(syncJobId(run.integrationId));
    return job?.data.syncRunId !== run.id;
  }

  /** `GET /sync/status` — DB only (works after a Redis restart). */
  async status(userId: string, integrationId?: string, now = new Date()): Promise<SyncStatusDto> {
    const integration = await this.integrationFor(userId, integrationId);
    const where = { userId, integrationId: integration.id, kind: { not: SyncKind.TARGETED } };
    // user-scope: `where` starts with userId.
    const [current, last] = await Promise.all([
      this.prisma.syncRun.findFirst({
        where: { ...where, status: { in: ACTIVE_RUN_STATUSES } },
        orderBy: { queuedAt: 'desc' },
      }),
      // user-scope: `where` starts with userId.
      this.prisma.syncRun.findFirst({
        where: { ...where, status: { notIn: ACTIVE_RUN_STATUSES } },
        orderBy: { queuedAt: 'desc' },
      }),
    ]);
    let state: SyncStatusDto['state'] = 'idle';
    if (integration.status === IntegrationStatus.NEEDS_REAUTH) state = 'needs_reauth';
    else if (current) state = current.status.toLowerCase() as SyncStatusDto['state'];
    else if (last?.status === SyncStatus.FAILED) state = 'failed';
    return {
      integrationId: integration.id,
      state,
      currentRun: current ? toSyncRunDto(current) : null,
      lastRun: last ? toSyncRunDto(last) : null,
      lastSuccessfulAt: integration.lastSuccessfulSyncAt?.toISOString() ?? null,
      nextScheduledAt:
        integration.status === IntegrationStatus.ACTIVE
          ? nextSlotAfter(integration.scheduleSlotMinute, now).toISOString()
          : null,
    };
  }

  async listRuns(userId: string, query: SyncRunListQuery) {
    const rows = await this.prisma.syncRun.findMany({
      where: {
        userId,
        ...(query.integrationId ? { integrationId: query.integrationId } : {}),
        ...(query.status ? { status: query.status.toUpperCase() as SyncStatus } : {}),
        ...afterCursor('queuedAt', decodeCursor(query.cursor)),
      },
      orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = toPage(rows, query.limit, (row) => row.queuedAt);
    return { items: page.items.map(toSyncRunDto), meta: page.meta };
  }

  async getRun(userId: string, id: string): Promise<SyncRunDto> {
    const run = await this.prisma.syncRun.findFirst({ where: { id, userId } });
    if (!run) throw AppException.notFound('Sync run');
    return toSyncRunDto(run);
  }

  /** Latest non-targeted active run (for `GET /integrations/:id`). */
  async currentRun(userId: string, integrationId: string): Promise<SyncRunDto | null> {
    const run = await this.prisma.syncRun.findFirst({
      where: {
        userId,
        integrationId,
        status: { in: ACTIVE_RUN_STATUSES },
        kind: { not: SyncKind.TARGETED },
      },
      orderBy: { queuedAt: 'desc' },
    });
    return run ? toSyncRunDto(run) : null;
  }
}
