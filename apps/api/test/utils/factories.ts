import { DocumentType, PRState, Provider, type Prisma, type PrismaClient } from '@prisma/client';

/**
 * Minimal test-data factories. Each returns the created row; pass overrides for the fields a
 * test cares about. Sequence numbers keep unique columns unique within a test.
 */
let sequence = 0;
const next = () => ++sequence;

export function buildFactories(prisma: PrismaClient) {
  return {
    user(overrides: Partial<Prisma.UserCreateInput> = {}) {
      const n = next();
      return prisma.user.create({
        data: { email: `user${n}@example.test`, name: `User ${n}`, ...overrides },
      });
    },

    integration(userId: string, overrides: Partial<Prisma.IntegrationUncheckedCreateInput> = {}) {
      return prisma.integration.create({
        data: {
          userId,
          provider: Provider.GITHUB,
          accessToken: 'test-token',
          metadata: { username: 'octocat' },
          ...overrides,
        },
      });
    },

    commit(
      userId: string,
      integrationId: string,
      overrides: Partial<Prisma.CommitUncheckedCreateInput> = {},
    ) {
      const n = next();
      return prisma.commit.create({
        data: {
          userId,
          integrationId,
          sha: `sha${n.toString().padStart(8, '0')}`,
          message: `feat: change ${n}`,
          repo: 'acme/api',
          branch: 'main',
          additions: 10,
          deletions: 2,
          timestamp: new Date('2026-10-15T12:00:00Z'),
          ...overrides,
        },
      });
    },

    pullRequest(
      userId: string,
      integrationId: string,
      overrides: Partial<Prisma.PullRequestUncheckedCreateInput> = {},
    ) {
      const n = next();
      return prisma.pullRequest.create({
        data: {
          userId,
          integrationId,
          number: n,
          title: `Add feature ${n}`,
          state: PRState.MERGED,
          repo: 'acme/api',
          mergedAt: new Date('2026-10-16T12:00:00Z'),
          timestamp: new Date('2026-10-15T12:00:00Z'),
          ...overrides,
        },
      });
    },

    codeReview(
      userId: string,
      prId: string,
      overrides: Partial<Prisma.CodeReviewUncheckedCreateInput> = {},
    ) {
      return prisma.codeReview.create({
        data: {
          userId,
          prId,
          comments: 1,
          approved: true,
          timestamp: new Date('2026-10-17T12:00:00Z'),
          ...overrides,
        },
      });
    },

    document(
      userId: string,
      overrides: Partial<Prisma.GeneratedDocumentUncheckedCreateInput> = {},
    ) {
      return prisma.generatedDocument.create({
        data: {
          userId,
          type: DocumentType.RESUME,
          content: { bullets: [] },
          dateRange: { from: '2026-01-01', to: '2026-06-30' },
          ...overrides,
        },
      });
    },
  };
}

export type Factories = ReturnType<typeof buildFactories>;
