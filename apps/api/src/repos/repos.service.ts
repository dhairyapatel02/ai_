import { Injectable } from '@nestjs/common';
import { type Prisma, type Repository } from '@prisma/client';

import { AppException } from '../common/app-exception';
import { decodeOffsetCursor, encodeOffsetCursor } from '../common/pagination';
import { MetricsQueueService } from '../metrics/metrics-queue.service';
import { PrismaService } from '../prisma/prisma.service';

import type { RepoListQuery, RepoPurgeResult, RepositoryDto } from '@devimpact/shared';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function safeHttps(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export function toRepositoryDto(row: Repository): RepositoryDto {
  return {
    id: row.id,
    integrationId: row.integrationId,
    fullName: row.fullName,
    isPrivate: row.isPrivate,
    isFork: row.isFork,
    isArchived: row.isArchived,
    accessible: row.accessible,
    included: row.included,
    inclusionSource: row.inclusionSource === 'USER' ? 'user' : 'default',
    viaInstallation: row.installationId !== null,
    lastActivityAt: iso(row.lastActivityAt),
    lastSyncedAt: iso(row.lastSyncedAt),
    htmlUrl: safeHttps(row.htmlUrl),
  };
}

/**
 * Repository selection (F-11, API_CONTRACT_V2 §7). Changing inclusion records a user choice
 * (`inclusionSource = USER`, never overridden by sync) and queues a full-history metrics recompute.
 * Excluded repositories keep their data (until purged) but are never fetched or counted.
 */
@Injectable()
export class ReposService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsQueueService,
  ) {}

  async list(userId: string, query: RepoListQuery) {
    const where: Prisma.RepositoryWhereInput = {
      userId,
      ...(query.integrationId ? { integrationId: query.integrationId } : {}),
      ...(query.included !== undefined ? { included: query.included } : {}),
      ...(query.accessible !== undefined ? { accessible: query.accessible } : {}),
      ...(query.q ? { fullName: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const offset = decodeOffsetCursor(query.cursor);
    const orderBy: Prisma.RepositoryOrderByWithRelationInput[] =
      query.sort === '-lastActivityAt'
        ? [{ lastActivityAt: { sort: 'desc', nulls: 'last' } }, { fullName: 'asc' }]
        : [{ fullName: 'asc' }];
    // user-scope: `where` starts with userId.
    const [rows, total] = await Promise.all([
      this.prisma.repository.findMany({ where, orderBy, skip: offset, take: query.limit + 1 }),
      // user-scope: `where` starts with userId.
      this.prisma.repository.count({ where }),
    ]);
    const hasMore = rows.length > query.limit;
    const items = (hasMore ? rows.slice(0, query.limit) : rows).map(toRepositoryDto);
    return {
      items,
      meta: {
        nextCursor: hasMore ? encodeOffsetCursor(offset + query.limit) : null,
        hasMore,
        total,
      },
    };
  }

  async setIncluded(userId: string, id: string, included: boolean): Promise<RepositoryDto> {
    const row = await this.prisma.repository.findFirst({ where: { id, userId } });
    if (!row) throw AppException.notFound('Repository');
    const updated = await this.prisma.repository.update({
      where: { id: row.id, userId },
      data: { included, inclusionSource: 'USER' },
    });
    if (row.included !== included) await this.recompute(userId);
    return toRepositoryDto(updated);
  }

  async setIncludedMany(
    userId: string,
    ids: string[],
    included: boolean,
  ): Promise<{ updated: number }> {
    const result = await this.prisma.repository.updateMany({
      where: { userId, id: { in: ids } },
      data: { included, inclusionSource: 'USER' },
    });
    if (result.count > 0) await this.recompute(userId);
    return { updated: result.count };
  }

  /** Deletes the repository's activity; the repository stays, excluded (DATA_MODEL_V2 §6). */
  async purge(userId: string, id: string): Promise<RepoPurgeResult> {
    const row = await this.prisma.repository.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!row) throw AppException.notFound('Repository');
    const [reviews, pullRequests, commits] = await this.prisma.$transaction([
      this.prisma.pullRequestReview.deleteMany({
        where: { userId, pullRequest: { repositoryId: row.id } },
      }),
      this.prisma.pullRequest.deleteMany({ where: { userId, repositoryId: row.id } }),
      this.prisma.commit.deleteMany({ where: { userId, repositoryId: row.id } }),
      this.prisma.repository.updateMany({
        where: { id: row.id, userId },
        data: { included: false, inclusionSource: 'USER', commitCursor: null },
      }),
    ]);
    await this.recompute(userId);
    return {
      deleted: { pullRequests: pullRequests.count, reviews: reviews.count, commits: commits.count },
    };
  }

  private async recompute(userId: string) {
    await this.metrics.enqueueRecompute({
      userId,
      from: new Date(0).toISOString(),
      to: new Date().toISOString(),
      reason: 'repository_inclusion',
    });
  }
}
