import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService) {}

  async getCommits(userId: string, from?: string, to?: string, page = 1, limit = 20) {
    const where: Record<string, unknown> = { userId };
    if (from || to) {
      where.timestamp = {};
      if (from) (where.timestamp as Record<string, unknown>).gte = new Date(from);
      if (to) (where.timestamp as Record<string, unknown>).lte = new Date(to);
    }

    const [data, total] = await Promise.all([
      this.prisma.commit.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.commit.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getPullRequests(userId: string, from?: string, to?: string, page = 1, limit = 20) {
    const where: Record<string, unknown> = { userId };
    if (from || to) {
      where.timestamp = {};
      if (from) (where.timestamp as Record<string, unknown>).gte = new Date(from);
      if (to) (where.timestamp as Record<string, unknown>).lte = new Date(to);
    }

    const [data, total] = await Promise.all([
      this.prisma.pullRequest.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pullRequest.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getSummary(userId: string, from?: string, to?: string) {
    const dateFilter: Record<string, unknown> = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const timestampWhere = Object.keys(dateFilter).length > 0 ? { timestamp: dateFilter } : {};

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

  async getActivityDataForAI(userId: string, from: string, to: string) {
    const dateFilter = {
      timestamp: { gte: new Date(from), lte: new Date(to) },
    };

    const [commits, prs, reviews] = await Promise.all([
      this.prisma.commit.findMany({ where: { userId, ...dateFilter }, orderBy: { timestamp: 'desc' } }),
      this.prisma.pullRequest.findMany({ where: { userId, ...dateFilter }, orderBy: { timestamp: 'desc' } }),
      this.prisma.codeReview.findMany({ where: { userId, ...dateFilter }, orderBy: { timestamp: 'desc' } }),
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
