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
          externalLogin: 'octocat',
          ...overrides,
        },
      });
    },

    /** Repository row (activity references a repository of the same user). */
    async repository(
      userId: string,
      integrationId: string,
      fullName = 'acme/api',
      overrides: Partial<Prisma.RepositoryUncheckedCreateInput> = {},
    ) {
      const existing = await prisma.repository.findFirst({
        where: { userId, integrationId, fullName },
      });
      if (existing && Object.keys(overrides).length === 0) return existing;
      const [ownerLogin = fullName, name = fullName] = fullName.split('/');
      return prisma.repository.upsert({
        where: { integrationId_fullName: { integrationId, fullName } },
        update: overrides,
        create: {
          userId,
          integrationId,
          externalId: `node-repo-${fullName}`,
          fullName,
          ownerLogin,
          name,
          defaultBranch: 'main',
          ...overrides,
        },
      });
    },

    /** v1-style overrides (`repo`, `message`, `timestamp`) are mapped onto the v2 columns. */
    async commit(
      userId: string,
      integrationId: string,
      overrides: Partial<Prisma.CommitUncheckedCreateInput> & {
        repo?: string;
        message?: string;
        timestamp?: Date;
      } = {},
    ) {
      const n = next();
      const { repo = 'acme/api', message, timestamp, ...rest } = overrides;
      const repository = await this.repository(userId, integrationId, repo);
      return prisma.commit.create({
        data: {
          userId,
          integrationId,
          repositoryId: repository.id,
          sha: `sha${n.toString().padStart(8, '0')}`,
          messageHeadline: message ?? `feat: change ${n}`,
          branch: 'main',
          additions: 10,
          deletions: 2,
          authoredAt: timestamp ?? new Date('2026-10-15T12:00:00Z'),
          ...rest,
        },
      });
    },

    async pullRequest(
      userId: string,
      integrationId: string,
      overrides: Partial<Prisma.PullRequestUncheckedCreateInput> & {
        repo?: string;
        timestamp?: Date;
      } = {},
    ) {
      const n = next();
      const { repo = 'acme/api', timestamp, ...rest } = overrides;
      const repository = await this.repository(userId, integrationId, repo);
      return prisma.pullRequest.create({
        data: {
          userId,
          integrationId,
          repositoryId: repository.id,
          number: n,
          title: `Add feature ${n}`,
          state: PRState.MERGED,
          isAuthoredByUser: true,
          mergedAt: new Date('2026-10-16T12:00:00Z'),
          createdAtRemote: timestamp ?? new Date('2026-10-15T12:00:00Z'),
          ...rest,
        },
      });
    },

    /** A review by `userId` on someone else's PR (stored as a reviewed, non-authored PR row). */
    async review(
      userId: string,
      integrationId: string,
      overrides: Partial<Prisma.PullRequestReviewUncheckedCreateInput> = {},
    ) {
      const pr = await this.pullRequest(userId, integrationId, {
        isAuthoredByUser: false,
        authorLogin: 'teammate',
        body: null,
      });
      const n = next();
      return prisma.pullRequestReview.create({
        data: {
          userId,
          integrationId,
          pullRequestId: pr.id,
          externalId: `node-review-${n}`,
          state: 'APPROVED',
          submittedAt: new Date('2026-10-17T12:00:00Z'),
          commentsCount: 1,
          hasBody: true,
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
