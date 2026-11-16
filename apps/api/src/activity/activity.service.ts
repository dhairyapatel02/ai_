import { toUtcRange } from '@devimpact/shared';
import { Injectable } from '@nestjs/common';

import { afterCursor, decodeCursor, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

import type { ActivityListQuery, DateRangeQuery, PullRequestListQuery } from '@devimpact/shared';

type Range = { gte?: Date; lt?: Date } | undefined;

/**
 * v1-era activity reads on the v2 data model (P06). Items keep the v1 keys the current web pages
 * read (`repo`, `timestamp`, `message`) next to the v2 fields; P07 replaces the shapes.
 * Authored and reviewed PRs are distinct (DATA-01): `/activity/prs` defaults to authored PRs and
 * never returns unrefreshed v0.1 stubs; summaries count reviews from `pull_request_reviews`.
 */
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

  private async range(userId: string, bounds: { from?: string; to?: string }): Promise<Range> {
    if (bounds.from === undefined && bounds.to === undefined) return undefined;
    return toUtcRange(bounds, await this.timezoneOf(userId));
  }

  async getCommits(userId: string, query: ActivityListQuery) {
    const range = await this.range(userId, query);
    const rows = await this.prisma.commit.findMany({
      where: {
        userId,
        repository: { included: true },
        ...(range ? { authoredAt: range } : {}),
        ...afterCursor('authoredAt', decodeCursor(query.cursor)),
      },
      include: { repository: { select: { fullName: true } } },
      orderBy: [{ authoredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = toPage(rows, query.limit, (row) => row.authoredAt);
    return {
      meta: page.meta,
      items: page.items.map(({ repository, ...c }) => ({
        ...c,
        repo: repository.fullName,
        message: c.messageHeadline,
        timestamp: c.authoredAt,
      })),
    };
  }

  async getPullRequests(userId: string, query: PullRequestListQuery) {
    const range = await this.range(userId, query);
    const rows = await this.prisma.pullRequest.findMany({
      where: {
        userId,
        isAuthoredByUser: query.role === 'authored',
        legacyStub: false,
        repository: { included: true },
        ...(range ? { createdAtRemote: range } : {}),
        ...afterCursor('createdAtRemote', decodeCursor(query.cursor)),
      },
      include: { repository: { select: { fullName: true } } },
      orderBy: [{ createdAtRemote: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = toPage(rows, query.limit, (row) => row.createdAtRemote);
    return {
      meta: page.meta,
      items: page.items.map(({ repository, ...p }) => ({
        ...p,
        repo: repository.fullName,
        timestamp: p.createdAtRemote,
      })),
    };
  }

  async getSummary(userId: string, query: DateRangeQuery) {
    const range = await this.range(userId, query);
    const included = { repository: { included: true } };

    const [totalCommits, totalPRs, totalReviews, totalIssues, impactScore, topReposRaw] =
      await Promise.all([
        this.prisma.commit.count({
          where: { userId, ...included, ...(range ? { authoredAt: range } : {}) },
        }),
        this.prisma.pullRequest.count({
          where: {
            userId,
            isAuthoredByUser: true,
            legacyStub: false,
            ...included,
            ...(range ? { createdAtRemote: range } : {}),
          },
        }),
        this.prisma.pullRequestReview.count({
          where: {
            userId,
            pullRequest: included,
            ...(range ? { submittedAt: range } : {}),
          },
        }),
        this.prisma.issue.count({ where: { userId, ...(range ? { timestamp: range } : {}) } }),
        this.prisma.impactScore.findFirst({
          where: { userId },
          orderBy: [{ year: 'desc' }, { month: 'desc' }],
        }),
        this.prisma.commit.groupBy({
          by: ['repositoryId'],
          where: { userId, ...included, ...(range ? { authoredAt: range } : {}) },
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
          take: 5,
        }),
      ]);

    const repos = await this.prisma.repository.findMany({
      where: { userId, id: { in: topReposRaw.map((r) => r.repositoryId) } },
      select: { id: true, fullName: true },
    });
    const nameOf = new Map(repos.map((r) => [r.id, r.fullName]));
    const topRepos = topReposRaw.map((r) => ({
      repo: nameOf.get(r.repositoryId) ?? 'unknown',
      commits: r._count.id,
    }));

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
    const range = await this.range(userId, { from, to });
    const included = { repository: { included: true } };

    const [commits, prs, reviews] = await Promise.all([
      this.prisma.commit.findMany({
        where: { userId, ...included, ...(range ? { authoredAt: range } : {}) },
        include: { repository: { select: { fullName: true } } },
        orderBy: { authoredAt: 'desc' },
      }),
      this.prisma.pullRequest.findMany({
        where: {
          userId,
          isAuthoredByUser: true,
          legacyStub: false,
          ...included,
          ...(range ? { createdAtRemote: range } : {}),
        },
        include: { repository: { select: { fullName: true } } },
        orderBy: { createdAtRemote: 'desc' },
      }),
      this.prisma.pullRequestReview.findMany({
        where: { userId, pullRequest: included, ...(range ? { submittedAt: range } : {}) },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);

    return {
      commits: commits.map((c) => ({
        message: c.messageHeadline,
        repo: c.repository.fullName,
        additions: c.additions,
        deletions: c.deletions,
      })),
      prs: prs.map((p) => ({
        title: p.title,
        repo: p.repository.fullName,
        state: p.state,
        mergedAt: p.mergedAt?.toISOString() || null,
      })),
      reviews: reviews.map((r) => ({
        comments: r.commentsCount,
        approved: r.state === 'APPROVED',
      })),
    };
  }
}
