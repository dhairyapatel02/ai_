import { toUtcRange } from '@devimpact/shared';
import { Injectable } from '@nestjs/common';

import { afterCursor, decodeCursor, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

import type { ActivityListQuery, DateRangeQuery } from '@devimpact/shared';

@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService) {}

  /** The user's IANA time zone (D-019); date-only bounds are local days in it. */
  async timezoneOf(userId: string): Promise<string> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    return settings?.timezone ?? 'UTC';
  }

  private async timestampFilter(userId: string, bounds: { from?: string; to?: string }) {
    if (bounds.from === undefined && bounds.to === undefined) return {};
    const range = toUtcRange(bounds, await this.timezoneOf(userId));
    return { timestamp: range };
  }

  async getCommits(userId: string, query: ActivityListQuery) {
    const range = await this.timestampFilter(userId, query);
    const rows = await this.prisma.commit.findMany({
      where: { userId, ...range, ...afterCursor('timestamp', decodeCursor(query.cursor)) },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (row) => row.timestamp);
  }

  async getPullRequests(userId: string, query: ActivityListQuery) {
    const range = await this.timestampFilter(userId, query);
    const rows = await this.prisma.pullRequest.findMany({
      where: { userId, ...range, ...afterCursor('timestamp', decodeCursor(query.cursor)) },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (row) => row.timestamp);
  }

  async getSummary(userId: string, query: DateRangeQuery) {
    const timestampWhere = await this.timestampFilter(userId, query);

    const [totalCommits, totalPRs, totalReviews, totalIssues, impactScore] = await Promise.all([
      this.prisma.commit.count({ where: { userId, ...timestampWhere } }),
      this.prisma.pullRequest.count({ where: { userId, ...timestampWhere } }),
      this.prisma.codeReview.count({ where: { userId, ...timestampWhere } }),
      this.prisma.issue.count({ where: { userId, ...timestampWhere } }),
      this.prisma.impactScore.findFirst({
        where: { userId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      }),
    ]);

    const topReposRaw = await this.prisma.commit.groupBy({
      by: ['repo'],
      where: { userId, ...timestampWhere },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });

    const topRepos = topReposRaw.map((r) => ({ repo: r.repo, commits: r._count.id }));

    return {
      totalCommits,
      totalPRs,
      totalReviews,
      totalIssues,
      topRepos,
      impactScore: impactScore?.overall ?? null,
    };
  }

  /** Inputs for the v1 generators; `from`/`to` are validated bounds (dates or timestamps). */
  async getActivityDataForAI(userId: string, from: string, to: string) {
    const dateFilter = await this.timestampFilter(userId, { from, to });

    const [commits, prs, reviews] = await Promise.all([
      this.prisma.commit.findMany({
        where: { userId, ...dateFilter },
        orderBy: { timestamp: 'desc' },
      }),
      this.prisma.pullRequest.findMany({
        where: { userId, ...dateFilter },
        orderBy: { timestamp: 'desc' },
      }),
      this.prisma.codeReview.findMany({
        where: { userId, ...dateFilter },
        orderBy: { timestamp: 'desc' },
      }),
    ]);

    return {
      commits: commits.map((c) => ({
        message: c.message,
        repo: c.repo,
        additions: c.additions,
        deletions: c.deletions,
      })),
      prs: prs.map((p) => ({
        title: p.title,
        repo: p.repo,
        state: p.state,
        mergedAt: p.mergedAt?.toISOString() || null,
      })),
      reviews: reviews.map((r) => ({
        comments: r.comments,
        approved: r.approved,
      })),
    };
  }
}
