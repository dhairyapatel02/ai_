import { SyncProcessor, type SyncJobData } from './sync.processor';

import type { GitHubService } from '../github/github.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Job } from 'bullmq';

const NOW = new Date('2026-11-09T12:00:00Z');

function createMocks() {
  const prisma = {
    integration: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'int1', accessToken: 'gh-token' }),
    },
    commit: { upsert: jest.fn().mockResolvedValue({}) },
    pullRequest: {
      upsert: jest
        .fn()
        .mockImplementation(({ create }: { create: { number: number } }) =>
          Promise.resolve({ id: `pr-${create.number}` }),
        ),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    codeReview: { upsert: jest.fn().mockResolvedValue({}) },
    impactScore: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const github = {
    getUsername: jest.fn().mockResolvedValue('octocat'),
    fetchUserRepos: jest.fn().mockResolvedValue(['acme/api']),
    fetchCommits: jest.fn().mockResolvedValue([
      {
        sha: 'abc123',
        message: 'feat: billing',
        repo: 'acme/api',
        branch: 'main',
        additions: 10,
        deletions: 2,
        timestamp: '2026-10-01T10:00:00Z',
      },
    ]),
    fetchPullRequests: jest.fn().mockResolvedValue([
      {
        number: 7,
        title: 'Billing v1',
        body: 'Adds billing',
        state: 'MERGED',
        repo: 'acme/api',
        mergedAt: '2026-10-03T10:00:00Z',
        createdAt: '2026-10-02T10:00:00Z',
      },
    ]),
    fetchReviews: jest.fn().mockResolvedValue([]),
  };
  const job = {
    data: { userId: 'u1', integrationId: 'int1' },
    updateProgress: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new SyncProcessor(
    prisma as unknown as PrismaService,
    github as unknown as GitHubService,
  );
  const run = () => processor.process(job as unknown as Job<SyncJobData>);
  return { prisma, github, job, run };
}

describe('SyncProcessor.process (characterization, Octokit + Prisma mocked)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('upserts commits and authored PRs for the last 6 months and returns totals', async () => {
    const { prisma, github, run } = createMocks();

    await expect(run()).resolves.toEqual({ totalCommits: 1, totalPRs: 1, totalReviews: 0 });

    const since = new Date(NOW);
    since.setMonth(since.getMonth() - 6);
    expect(github.fetchCommits).toHaveBeenCalledWith(
      'gh-token',
      'acme/api',
      'octocat',
      since.toISOString(),
    );
    expect(prisma.commit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_sha: { userId: 'u1', sha: 'abc123' } },
        create: expect.objectContaining({ integrationId: 'int1', repo: 'acme/api' }),
      }),
    );
    expect(prisma.pullRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_repo_number: { userId: 'u1', repo: 'acme/api', number: 7 } },
        create: expect.objectContaining({ state: 'MERGED', title: 'Billing v1' }),
      }),
    );
  });

  it('only scans the 30 most recently pushed repos (reviews: 15) — DATA-03 behaviour', async () => {
    const { github, run } = createMocks();
    github.fetchUserRepos.mockResolvedValue(Array.from({ length: 40 }, (_, i) => `acme/r${i}`));

    await run();

    expect(github.fetchCommits).toHaveBeenCalledTimes(30);
    expect(github.fetchPullRequests).toHaveBeenCalledTimes(30);
    expect(github.fetchReviews).toHaveBeenCalledTimes(15);
  });

  it('links reviews to an existing PR row and invalidates the current + previous month scores', async () => {
    const { prisma, github, run } = createMocks();
    github.fetchReviews.mockResolvedValue([
      {
        prNumber: 7,
        repo: 'acme/api',
        state: 'APPROVED',
        body: 'LGTM',
        submittedAt: '2026-10-04T10:00:00Z',
      },
    ]);
    prisma.pullRequest.findFirst.mockResolvedValue({ id: 'pr-existing' });

    await expect(run()).resolves.toMatchObject({ totalReviews: 1 });

    expect(prisma.codeReview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ prId: 'pr-existing', approved: true, comments: 1 }),
      }),
    );
    expect(prisma.impactScore.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        OR: [
          { month: 11, year: 2026 },
          { month: 10, year: 2026 },
        ],
      },
    });
  });

  it('rethrows failures so BullMQ marks the job failed', async () => {
    const { github, run } = createMocks();
    github.getUsername.mockRejectedValue(new Error('Bad credentials'));

    await expect(run()).rejects.toThrow('Bad credentials');
  });

  it.skip('DATA-01: a PR the user only reviewed is not stored as a PR authored by the user', async () => {
    const { prisma, github, run } = createMocks();
    github.fetchPullRequests.mockResolvedValue([]);
    github.fetchReviews.mockResolvedValue([
      {
        prNumber: 99,
        repo: 'acme/api',
        state: 'APPROVED',
        body: null,
        submittedAt: '2026-10-04T10:00:00Z',
      },
    ]);

    await run();

    expect(prisma.pullRequest.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ userId: 'u1', number: 99 }) }),
    );
  });

  it.skip('BUG-09: progress reaches 100% when the sync completes', async () => {
    const { job, run } = createMocks();
    await run();
    expect(job.updateProgress).toHaveBeenLastCalledWith(100);
  });

  it.todo(
    'DATA-04: GitHub errors for a repo fail or flag the sync instead of being swallowed (P06)',
  );
});
