import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import type {
  NormalizedCommit,
  NormalizedPullRequest,
  NormalizedRepository,
  NormalizedReviewedPullRequest,
} from '@devimpact/shared';

type Tx = Prisma.TransactionClient;

export interface WriteScope {
  userId: string;
  integrationId: string;
}

export interface RepoRef {
  id: string;
  externalId: string;
  fullName: string;
  included: boolean;
  accessible: boolean;
  inclusionSource: string;
  commitCursor: Date | null;
  defaultBranch: string | null;
  ownerLogin: string;
  name: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  htmlUrl: string | null;
  installationId: bigint | null;
}

export interface WriteResult {
  created: number;
  updated: number;
}

const REPO_SELECT = {
  id: true,
  externalId: true,
  fullName: true,
  included: true,
  accessible: true,
  inclusionSource: true,
  commitCursor: true,
  defaultBranch: true,
  ownerLogin: true,
  name: true,
  isPrivate: true,
  isFork: true,
  isArchived: true,
  htmlUrl: true,
  installationId: true,
} satisfies Prisma.RepositorySelect;

const sameTime = (a: Date | null | undefined, b: Date | null | undefined) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

function differs<T extends Record<string, unknown>>(current: T, next: Partial<T>): boolean {
  return Object.entries(next).some(([key, value]) => {
    const old = current[key];
    if (value instanceof Date || old instanceof Date) {
      return !sameTime(old as Date | null, value as Date | null);
    }
    if (Array.isArray(value)) return JSON.stringify(value) !== JSON.stringify(old);
    return old !== value;
  });
}

/**
 * Idempotent, batched writes for the sync engine (ADR-0007, PERF-02): one transaction per page,
 * `createMany({ skipDuplicates })` for new rows and targeted updates only for rows whose fields
 * changed, keyed by natural keys (DATA_MODEL_V2 §1). Re-running a sync creates no rows.
 */
@Injectable()
export class SyncWriter {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 60_000, maxWait: 10_000 });
  }

  /**
   * Ensures a Repository row per provider repository. Matches by node id, then by full name
   * (legacy `legacy:<fullName>` rows get their real node id — P06-3). New repositories are included
   * by default when the user has activity in them (`withActivity`), else excluded; a later sighting
   * with activity includes a DEFAULT-excluded repository. User choices (`inclusionSource = USER`)
   * are never overridden.
   */
  async upsertRepositories(
    tx: Tx,
    scope: WriteScope,
    repos: NormalizedRepository[],
    options: { withActivity: boolean; markInstallation?: boolean },
  ): Promise<{ refs: Map<string, RepoRef>; created: number }> {
    const unique = new Map(repos.map((r) => [r.externalId, r]));
    const refs = new Map<string, RepoRef>();
    if (unique.size === 0) return { refs, created: 0 };
    const list = [...unique.values()];
    const existing = await tx.repository.findMany({
      where: {
        userId: scope.userId,
        integrationId: scope.integrationId,
        OR: [
          { externalId: { in: list.map((r) => r.externalId) } },
          { fullName: { in: list.map((r) => r.fullName) } },
        ],
      },
      select: REPO_SELECT,
    });
    const byExternal = new Map(existing.map((r) => [r.externalId, r]));
    const byName = new Map(existing.map((r) => [r.fullName.toLowerCase(), r]));

    const toCreate: Prisma.RepositoryCreateManyInput[] = [];
    for (const repo of list) {
      const current = byExternal.get(repo.externalId) ?? byName.get(repo.fullName.toLowerCase());
      const installationId =
        repo.installationId !== null
          ? BigInt(repo.installationId)
          : (current?.installationId ?? null);
      const fields = {
        externalId: repo.externalId,
        fullName: repo.fullName,
        ownerLogin: repo.ownerLogin,
        name: repo.name,
        isPrivate: repo.isPrivate,
        isFork: repo.isFork,
        isArchived: repo.isArchived,
        defaultBranch: repo.defaultBranch ?? current?.defaultBranch ?? null,
        htmlUrl: repo.htmlUrl ?? current?.htmlUrl ?? null,
        ...(options.markInstallation || repo.installationId !== null ? { installationId } : {}),
      };
      if (!current) {
        toCreate.push({
          userId: scope.userId,
          integrationId: scope.integrationId,
          ...fields,
          installationId,
          included: options.withActivity,
          accessible: true,
        });
        continue;
      }
      const includeNow =
        options.withActivity && !current.included && current.inclusionSource === 'DEFAULT';
      const patch: Partial<RepoRef> = {
        ...fields,
        accessible: true,
        ...(includeNow ? { included: true } : {}),
      };
      if (
        differs(current as unknown as Record<string, unknown>, patch as Record<string, unknown>)
      ) {
        await tx.repository.updateMany({
          where: { id: current.id, userId: scope.userId },
          data: patch,
        });
      }
      refs.set(repo.externalId, { ...current, ...patch });
    }

    let created = 0;
    if (toCreate.length > 0) {
      // user-scope: every row in `toCreate` carries scope.userId.
      created = (await tx.repository.createMany({ data: toCreate, skipDuplicates: true })).count;
      const rows = await tx.repository.findMany({
        where: {
          userId: scope.userId,
          integrationId: scope.integrationId,
          externalId: { in: toCreate.map((r) => r.externalId) },
        },
        select: REPO_SELECT,
      });
      for (const row of rows) refs.set(row.externalId, row);
    }
    return { refs, created };
  }

  private prData(pr: NormalizedPullRequest, authored: boolean) {
    return {
      externalId: pr.externalId,
      title: pr.title,
      body: authored ? pr.body : null,
      url: pr.url,
      state: pr.state,
      isDraft: pr.isDraft,
      isAuthoredByUser: authored,
      authorExternalId: pr.authorExternalId,
      authorLogin: pr.authorLogin,
      labels: authored ? pr.labels : [],
      baseRef: pr.baseRef,
      createdAtRemote: pr.createdAt,
      readyForReviewAt: authored ? pr.readyForReviewAt : null,
      mergedAt: pr.mergedAt,
      closedAt: pr.closedAt,
      updatedAtRemote: pr.updatedAt,
      additions: authored ? pr.additions : null,
      deletions: authored ? pr.deletions : null,
      changedFiles: authored ? pr.changedFiles : null,
      commitsCount: authored ? pr.commitsCount : null,
      firstReviewAt: authored ? pr.firstReviewAt : null,
      reviewersCount: authored ? pr.reviewersCount : null,
      approvalsCount: authored ? pr.approvalsCount : null,
      changesRequestedCount: authored ? pr.changesRequestedCount : null,
      isRevert: pr.isRevert,
      revertedAt: authored ? pr.revertedAt : null,
      revertedByUrl: authored ? pr.revertedByUrl : null,
      legacyStub: false,
    };
  }

  /**
   * Upserts PRs by the natural key (user, repository, number). An authored upsert over a legacy
   * stub clears `legacyStub` and recomputes authorship (P06-3). Returns PR ids by node id.
   */
  async upsertPullRequests(
    tx: Tx,
    scope: WriteScope,
    items: { pr: NormalizedPullRequest; repositoryId: string; authored: boolean }[],
  ): Promise<WriteResult & { ids: Map<string, string> }> {
    const ids = new Map<string, string>();
    if (items.length === 0) return { created: 0, updated: 0, ids };
    const existing = await tx.pullRequest.findMany({
      where: {
        userId: scope.userId,
        OR: items.map((i) => ({ repositoryId: i.repositoryId, number: i.pr.number })),
      },
    });
    const key = (repositoryId: string, number: number) => `${repositoryId}#${number}`;
    const byKey = new Map(existing.map((p) => [key(p.repositoryId, p.number), p]));

    const toCreate: Prisma.PullRequestCreateManyInput[] = [];
    let updated = 0;
    const seen = new Set<string>();
    for (const { pr, repositoryId, authored } of items) {
      const k = key(repositoryId, pr.number);
      if (seen.has(k)) continue;
      seen.add(k);
      const data = this.prData(pr, authored);
      const current = byKey.get(k);
      if (!current) {
        toCreate.push({
          userId: scope.userId,
          integrationId: scope.integrationId,
          repositoryId,
          number: pr.number,
          ...data,
        });
        continue;
      }
      ids.set(pr.externalId, current.id);
      if (differs(current as unknown as Record<string, unknown>, data)) {
        await tx.pullRequest.updateMany({
          where: { id: current.id, userId: scope.userId },
          data: { ...data, integrationId: scope.integrationId, syncedAt: new Date() },
        });
        updated++;
      }
    }
    let created = 0;
    if (toCreate.length > 0) {
      // user-scope: every row in `toCreate` carries scope.userId.
      created = (await tx.pullRequest.createMany({ data: toCreate, skipDuplicates: true })).count;
      const rows = await tx.pullRequest.findMany({
        where: {
          userId: scope.userId,
          externalId: { in: toCreate.flatMap((p) => (p.externalId ? [p.externalId] : [])) },
        },
        select: { id: true, externalId: true },
      });
      for (const row of rows) if (row.externalId) ids.set(row.externalId, row.id);
    }
    return { created, updated, ids };
  }

  /** Upserts the user's own reviews (by review node id) for reviewed PRs. */
  async upsertReviews(
    tx: Tx,
    scope: WriteScope,
    items: { reviewed: NormalizedReviewedPullRequest; pullRequestId: string }[],
  ): Promise<WriteResult> {
    const all = items.flatMap(({ reviewed, pullRequestId }) =>
      reviewed.reviews.map((review) => ({ review, pullRequestId })),
    );
    if (all.length === 0) return { created: 0, updated: 0 };
    const existing = await tx.pullRequestReview.findMany({
      where: { userId: scope.userId, externalId: { in: all.map((a) => a.review.externalId) } },
    });
    const byId = new Map(existing.map((r) => [r.externalId, r]));
    const toCreate: Prisma.PullRequestReviewCreateManyInput[] = [];
    let updated = 0;
    for (const { review, pullRequestId } of all) {
      const data = {
        pullRequestId,
        state: review.state,
        submittedAt: review.submittedAt,
        hasBody: review.hasBody,
        commentsCount: review.commentsCount,
        reviewRequestedAt: review.reviewRequestedAt,
      };
      const current = byId.get(review.externalId);
      if (!current) {
        toCreate.push({
          userId: scope.userId,
          integrationId: scope.integrationId,
          externalId: review.externalId,
          ...data,
        });
      } else if (differs(current as unknown as Record<string, unknown>, data)) {
        await tx.pullRequestReview.updateMany({
          where: { id: current.id, userId: scope.userId },
          data: { ...data, syncedAt: new Date() },
        });
        updated++;
      }
    }
    const created = toCreate.length
      ? // user-scope: every row in `toCreate` carries scope.userId.
        (await tx.pullRequestReview.createMany({ data: toCreate, skipDuplicates: true })).count
      : 0;
    return { created, updated };
  }

  /** Inserts commits de-duplicated by (user, sha); existing commits are immutable. */
  async insertCommits(
    tx: Tx,
    scope: WriteScope,
    repositoryId: string,
    commits: NormalizedCommit[],
  ): Promise<WriteResult> {
    if (commits.length === 0) return { created: 0, updated: 0 };
    const result = await tx.commit.createMany({
      data: commits.map((c) => ({
        userId: scope.userId,
        integrationId: scope.integrationId,
        repositoryId,
        sha: c.sha,
        messageHeadline: c.messageHeadline,
        messageBody: c.messageBody,
        branch: c.branch,
        authoredAt: c.authoredAt,
        committedAt: c.committedAt,
        additions: c.additions,
        deletions: c.deletions,
        changedFiles: c.changedFiles,
        parentsCount: c.parentsCount,
        associatedPrNumber: c.associatedPrNumber,
        authorExternalId: c.authorExternalId,
      })),
      skipDuplicates: true,
    });
    return { created: result.count, updated: 0 };
  }
}
