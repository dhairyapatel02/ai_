import { ActivityService } from './activity.service';

import type { PrismaService } from '../prisma/prisma.service';

function createPrismaMock() {
  return {
    commit: { count: jest.fn().mockResolvedValue(12), groupBy: jest.fn().mockResolvedValue([]) },
    pullRequest: { count: jest.fn().mockResolvedValue(4) },
    codeReview: { count: jest.fn().mockResolvedValue(7) },
    issue: { count: jest.fn().mockResolvedValue(0) },
    impactScore: { findFirst: jest.fn().mockResolvedValue(null) },
  };
}

describe('ActivityService.getSummary (characterization, Prisma mocked)', () => {
  it('returns counts, top repos and a null impact score when none is stored', async () => {
    const prisma = createPrismaMock();
    prisma.commit.groupBy.mockResolvedValue([
      { repo: 'acme/api', _count: { id: 9 } },
      { repo: 'acme/web', _count: { id: 3 } },
    ]);
    const service = new ActivityService(prisma as unknown as PrismaService);

    await expect(service.getSummary('u1')).resolves.toEqual({
      totalCommits: 12,
      totalPRs: 4,
      totalReviews: 7,
      totalIssues: 0,
      topRepos: [
        { repo: 'acme/api', commits: 9 },
        { repo: 'acme/web', commits: 3 },
      ],
      impactScore: null,
    });
    // No date filter when from/to are omitted.
    expect(prisma.commit.count).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(prisma.commit.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' }, take: 5 }),
    );
  });

  it('applies the from/to range to every count and the top-repos query', async () => {
    const prisma = createPrismaMock();
    const service = new ActivityService(prisma as unknown as PrismaService);

    await service.getSummary('u1', '2026-10-01T00:00:00Z', '2026-10-31T23:59:59Z');

    const where = {
      userId: 'u1',
      timestamp: { gte: new Date('2026-10-01T00:00:00Z'), lte: new Date('2026-10-31T23:59:59Z') },
    };
    expect(prisma.commit.count).toHaveBeenCalledWith({ where });
    expect(prisma.pullRequest.count).toHaveBeenCalledWith({ where });
    expect(prisma.codeReview.count).toHaveBeenCalledWith({ where });
    expect(prisma.issue.count).toHaveBeenCalledWith({ where });
    expect(prisma.commit.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where }));
  });

  it('reports the most recent stored impact score, ignoring the requested range', async () => {
    const prisma = createPrismaMock();
    prisma.impactScore.findFirst.mockResolvedValue({ overall: 81 });
    const service = new ActivityService(prisma as unknown as PrismaService);

    const summary = await service.getSummary('u1', '2020-01-01', '2020-01-31');

    expect(summary.impactScore).toBe(81);
    expect(prisma.impactScore.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  });

  it.todo('DATA-02: summary distinguishes merged PRs from all authored PRs (P07)');
});
