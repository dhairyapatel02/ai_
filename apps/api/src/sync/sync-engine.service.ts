import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IntegrationStatus,
  type Prisma,
  SyncKind,
  SyncStage,
  SyncStatus,
  type SyncRun,
} from '@prisma/client';

import { NotificationProducer } from '../email/notification-producer';
import { MetricsQueueService } from '../metrics/metrics-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from '../providers/provider.errors';
import { ACTIVITY_PROVIDER } from '../providers/providers.module';
import { IntegrationTokensService } from './integration-tokens.service';
import { type RepoRef, SyncWriter, type WriteScope } from './sync-writer';
import { CURSOR_OVERLAP_MS, RECENT_WINDOW_DAYS } from './sync.constants';

import type { Env } from '../config/env';
import type {
  ActivityProvider,
  CommitRequest,
  NormalizedRepository,
  ProviderSession,
  SyncCounts,
  SyncRunError,
} from '@devimpact/shared';

const DAY_MS = 86_400_000;
type ActivityStage = 'AUTHORED_PRS' | 'REVIEWED_PRS' | 'COMMITS';
const STAGES: ActivityStage[] = ['AUTHORED_PRS', 'REVIEWED_PRS', 'COMMITS'];

export interface Slice {
  from: Date;
  to: Date;
  recent: boolean;
}

/** Resumable position, persisted on `SyncRun.checkpoint` (rate-limit pauses, retries). */
export interface Checkpoint {
  reposDone?: boolean;
  slice?: number;
  stage?: ActivityStage;
  done?: number;
  /** Planned work units per `slice:stage` key (1 until the provider reports a total). */
  plan?: Record<string, number>;
}

export type RunOutcome =
  { type: 'finished'; status: SyncStatus } | { type: 'delayed'; until: Date } | { type: 'skipped' };

const COUNT_KEYS = [
  'repos',
  'prsAuthored',
  'prsReviewed',
  'reviews',
  'commits',
  'created',
  'updated',
] as const;
type Counts = Record<(typeof COUNT_KEYS)[number], number>;

/**
 * Backfill slices (ADR-0007): newest 30 days first, then month by month backwards to the start of
 * the plan history window. Incremental runs are one slice.
 */
export function planSlices(kind: SyncKind, from: Date, to: Date): Slice[] {
  if (kind !== SyncKind.BACKFILL) return [{ from, to, recent: false }];
  const recentFrom = new Date(Math.max(from.getTime(), to.getTime() - RECENT_WINDOW_DAYS * DAY_MS));
  const slices: Slice[] = [{ from: recentFrom, to, recent: true }];
  let end = recentFrom;
  while (end.getTime() > from.getTime()) {
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - 1);
    const sliceFrom = new Date(Math.max(start.getTime(), from.getTime()));
    slices.push({ from: sliceFrom, to: end, recent: false });
    end = sliceFrom;
  }
  return slices;
}

/** Monotonic progress from planned work units; reaches 100 only when the run finishes. */
export function progressOf(checkpoint: Checkpoint, previous: number, totalSlices: number): number {
  const plan = checkpoint.plan ?? {};
  let planned = 1; // repositories stage
  for (let s = 0; s < totalSlices; s++) {
    for (const stage of STAGES) planned += plan[`${s}:${stage}`] ?? 1;
  }
  const value = Math.floor(((checkpoint.done ?? 0) / planned) * 100);
  return Math.max(previous, Math.min(99, value));
}

const SAFE_MESSAGES: Record<string, string> = {
  GITHUB_REAUTH_REQUIRED:
    'GitHub access was revoked or expired. Reconnect GitHub to resume syncing — nothing has been deleted.',
  GITHUB_UNAVAILABLE: 'GitHub could not be reached. The sync will be retried.',
  INTERNAL: 'The sync failed unexpectedly. Please try again.',
};

/**
 * The sync orchestrator (ADR-0007, ARCHITECTURE_V2 §6). Depends only on the `ActivityProvider`
 * interface. `SyncRun` is the source of truth for status/progress; every stage writes idempotently
 * and cursors advance only after the run's data is committed.
 */
@Injectable()
export class SyncEngine {
  private readonly logger = new Logger(SyncEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: SyncWriter,
    private readonly tokens: IntegrationTokensService,
    private readonly metrics: MetricsQueueService,
    private readonly config: ConfigService<Env, true>,
    @Inject(ACTIVITY_PROVIDER) private readonly provider: ActivityProvider,
    private readonly notifications: NotificationProducer,
  ) {}

  openSession(userId: string, integrationId: string): ProviderSession {
    return this.provider.openSession({
      getAccessToken: () => this.tokens.accessToken(userId, integrationId),
      onUnauthorized: () => this.tokens.afterUnauthorized(userId, integrationId),
      minRemaining: this.config.get('SYNC_RATE_LIMIT_MIN_REMAINING', { infer: true }),
      key: `integration-${integrationId}`,
    });
  }

  async run(
    syncRunId: string,
    userId: string,
    attempt: { number: number; max: number } = { number: 1, max: 1 },
  ): Promise<RunOutcome> {
    const run = await this.prisma.syncRun.findFirst({ where: { id: syncRunId, userId } });
    if (!run || ['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(run.status)) {
      return { type: 'skipped' };
    }
    const integration = await this.prisma.integration.findFirst({
      where: { id: run.integrationId, userId },
      select: {
        id: true,
        status: true,
        externalLogin: true,
        externalAccountId: true,
        syncCursor: true,
        backfillFrom: true,
      },
    });
    if (integration?.status !== IntegrationStatus.ACTIVE) {
      const code =
        integration?.status === IntegrationStatus.NEEDS_REAUTH
          ? 'GITHUB_REAUTH_REQUIRED'
          : 'INTERNAL';
      await this.finish(run, SyncStatus.FAILED, {
        errorCode: code,
        errorMessage: SAFE_MESSAGES[code] ?? null,
      });
      return { type: 'finished', status: SyncStatus.FAILED };
    }

    const scope: WriteScope = { userId, integrationId: integration.id };
    const checkpoint = (run.checkpoint ?? {}) as Checkpoint;
    const counts = this.counts(run.counts);
    const errors = (Array.isArray(run.errors) ? run.errors : []) as SyncRunError[];
    const windowTo = run.windowTo ?? new Date();
    const windowFrom = run.windowFrom ?? new Date(windowTo.getTime() - DAY_MS);
    const slices = planSlices(run.kind, windowFrom, windowTo);
    const session = this.openSession(userId, integration.id);
    const failedRepoIds = new Set<string>();
    let progress = run.progress;

    const save = async (data: Prisma.SyncRunUpdateManyMutationInput = {}) => {
      progress = progressOf(checkpoint, progress, slices.length);
      await this.prisma.syncRun.updateMany({
        where: { id: run.id, userId },
        data: {
          progress,
          checkpoint: checkpoint as Prisma.InputJsonValue,
          counts: counts,
          errors: errors,
          apiCalls: run.apiCalls + session.stats.requests,
          rateLimitRemaining: session.stats.rateLimitRemaining,
          ...data,
        },
      });
    };
    const addError = (
      stage: SyncRunError['stage'],
      code: string,
      message: string,
      repo: string | null,
    ) => {
      errors.push({ stage, repo, code, message, at: new Date().toISOString() });
    };

    await save({
      status: SyncStatus.RUNNING,
      startedAt: run.startedAt ?? new Date(),
      resumeAt: null,
      errorCode: null,
      errorMessage: null,
    });

    try {
      // ── Prepare: identity for search qualifiers (GET /user only when unknown).
      let login = integration.externalLogin;
      let authorId = integration.externalAccountId;
      if (!login || !authorId) {
        const account = await session.getAccount();
        login = account.login;
        authorId = account.externalId;
        await this.prisma.integration.updateMany({
          where: { id: integration.id, userId },
          data: { externalLogin: login, externalAccountId: authorId },
        });
      }

      // ── Repositories: installations + their repositories.
      if (!checkpoint.reposDone) {
        await save({ stage: SyncStage.REPOSITORIES });
        await this.syncRepositories(session, scope);
        checkpoint.reposDone = true;
        checkpoint.done = (checkpoint.done ?? 0) + 1;
        await save();
      }

      const cursor = (integration.syncCursor ?? {}) as {
        authoredPrsUpdatedAt?: string;
        reviewedPrsUpdatedAt?: string;
      };
      for (let s = checkpoint.slice ?? 0; s < slices.length; s++) {
        const slice = slices[s];
        const startStage =
          checkpoint.slice === s && checkpoint.stage ? STAGES.indexOf(checkpoint.stage) : 0;
        checkpoint.slice = s;
        for (let st = startStage; st < STAGES.length; st++) {
          const stage = STAGES[st];
          checkpoint.stage = stage;
          await save({ stage });
          const key = `${s}:${stage}`;
          const plan = (checkpoint.plan ??= {});
          const advance = async (total: number | null) => {
            if (total !== null) plan[key] = Math.max(1, total);
            checkpoint.done = (checkpoint.done ?? 0) + 1;
            await save();
          };

          if (stage === 'AUTHORED_PRS') {
            const from = this.streamFrom(run.kind, slice.from, cursor.authoredPrsUpdatedAt);
            await this.authoredStage(
              session,
              scope,
              login,
              { from, to: slice.to },
              counts,
              advance,
            );
          } else if (stage === 'REVIEWED_PRS') {
            const from = this.streamFrom(run.kind, slice.from, cursor.reviewedPrsUpdatedAt);
            await this.reviewedStage(
              session,
              scope,
              login,
              { from, to: slice.to },
              counts,
              advance,
            );
          } else {
            await this.commitStage(
              session,
              scope,
              login,
              authorId,
              run.kind,
              slice,
              integration.backfillFrom,
              counts,
              failedRepoIds,
              addError,
              advance,
            );
          }
        }
        checkpoint.stage = undefined;
        checkpoint.slice = s + 1;
        await save();

        if (slice.recent && run.kind === SyncKind.BACKFILL) {
          // Dashboard can render now (A-4); older months keep loading.
          await this.metrics.enqueueRecompute({
            userId,
            from: slice.from.toISOString(),
            to: slice.to.toISOString(),
            reason: 'sync',
          });
          await save({ recentWindowCompletedAt: new Date() });
        }
      }

      // ── Finalize: cursors, legacy purge, rollups.
      await save({ stage: SyncStage.PERSIST });
      await this.finalizeCursors(
        scope,
        run.kind,
        windowFrom,
        windowTo,
        failedRepoIds,
        integration.backfillFrom === null,
      );
      counts.repos = await this.prisma.repository.count({
        where: { userId, integrationId: integration.id },
      });
      await save({ stage: SyncStage.ROLLUPS });
      await this.metrics.enqueueRecompute({
        userId,
        from: windowFrom.toISOString(),
        to: windowTo.toISOString(),
        reason: 'sync',
      });
      const status = errors.length > 0 ? SyncStatus.PARTIAL : SyncStatus.SUCCEEDED;
      await this.finish(
        run,
        status,
        {},
        {
          counts,
          errors,
          apiCalls: run.apiCalls + session.stats.requests,
          rateLimitRemaining: session.stats.rateLimitRemaining,
        },
      );
      this.logger.log(
        { syncRunId: run.id, status, apiCalls: run.apiCalls + session.stats.requests, counts },
        'Sync run finished',
      );
      return { type: 'finished', status };
    } catch (error) {
      return this.handleFailure(run, userId, error, save, attempt);
    }
  }

  /** Lower bound of a PR search stream: cursor − 1 h for incremental runs, never before the slice. */
  private streamFrom(kind: SyncKind, sliceFrom: Date, cursor: string | undefined): Date {
    if (kind !== SyncKind.INCREMENTAL || !cursor) return sliceFrom;
    return new Date(Math.max(sliceFrom.getTime(), Date.parse(cursor) - CURSOR_OVERLAP_MS));
  }

  private async handleFailure(
    run: SyncRun,
    userId: string,
    error: unknown,
    save: (data?: Prisma.SyncRunUpdateManyMutationInput) => Promise<void>,
    attempt: { number: number; max: number },
  ): Promise<RunOutcome> {
    if (error instanceof ProviderRateLimitError) {
      // Never drop data: keep the checkpoint and resume after the reset (+ up to 60 s jitter).
      const until = new Date(
        Math.max(error.resetAt.getTime(), Date.now()) + Math.floor(Math.random() * 60_000),
      );
      await save({
        status: SyncStatus.WAITING_RATE_LIMIT,
        resumeAt: until,
        rateLimitRemaining: error.remaining,
      });
      this.logger.warn(
        { syncRunId: run.id, resumeAt: until.toISOString() },
        'Sync paused by GitHub rate limit',
      );
      return { type: 'delayed', until };
    }
    if (error instanceof ProviderAuthError) {
      await this.tokens.markNeedsReauth(userId, run.integrationId, 'GITHUB_TOKEN_REVOKED');
      await save();
      await this.finish(run, SyncStatus.FAILED, {
        errorCode: 'GITHUB_REAUTH_REQUIRED',
        errorMessage: SAFE_MESSAGES.GITHUB_REAUTH_REQUIRED ?? null,
      });
      return { type: 'finished', status: SyncStatus.FAILED };
    }
    const code = error instanceof ProviderUnavailableError ? 'GITHUB_UNAVAILABLE' : 'INTERNAL';
    this.logger.error({ syncRunId: run.id, err: error, attempt: attempt.number }, 'Sync run error');
    if (attempt.number < attempt.max) {
      await save({
        status: SyncStatus.QUEUED,
        errorCode: code,
        errorMessage: SAFE_MESSAGES[code] ?? null,
      });
      throw error; // BullMQ retries with exponential backoff and resumes from the checkpoint
    }
    await save();
    await this.finish(run, SyncStatus.FAILED, {
      errorCode: code,
      errorMessage: SAFE_MESSAGES[code] ?? null,
    });
    return { type: 'finished', status: SyncStatus.FAILED };
  }

  private async finish(
    run: SyncRun,
    status: SyncStatus,
    error: { errorCode?: string | null; errorMessage?: string | null },
    extra: {
      counts?: Counts;
      errors?: SyncRunError[];
      apiCalls?: number;
      rateLimitRemaining?: number | null;
    } = {},
  ): Promise<void> {
    const now = new Date();
    const ok = status === SyncStatus.SUCCEEDED || status === SyncStatus.PARTIAL;
    await this.prisma.$transaction([
      this.prisma.syncRun.updateMany({
        where: { id: run.id, userId: run.userId },
        data: {
          status,
          stage: ok ? SyncStage.DONE : undefined,
          progress: ok ? 100 : undefined,
          finishedAt: now,
          resumeAt: null,
          ...error,
          ...(extra.counts ? { counts: extra.counts } : {}),
          ...(extra.errors ? { errors: extra.errors } : {}),
          ...(extra.apiCalls !== undefined ? { apiCalls: extra.apiCalls } : {}),
          ...(extra.rateLimitRemaining !== undefined
            ? { rateLimitRemaining: extra.rateLimitRemaining }
            : {}),
        },
      }),
      this.prisma.integration.updateMany({
        where: { id: run.integrationId, userId: run.userId },
        data: { lastSyncedAt: now, ...(ok ? { lastSuccessfulSyncAt: now } : {}) },
      }),
    ]);
    // "Sync problems" email (F-65; preference checked by the worker, at most one per day).
    if (status === SyncStatus.FAILED && error.errorCode !== 'INTEGRATION_NEEDS_REAUTH') {
      await this.notifications.syncProblem(run.userId, run.integrationId, 'sync_failed', now);
    }
  }

  private counts(raw: Prisma.JsonValue): Counts {
    const source = (raw ?? {}) as Partial<SyncCounts>;
    return Object.fromEntries(COUNT_KEYS.map((k) => [k, source[k] ?? 0])) as Counts;
  }

  /** Installations + their repositories (ADR-0007 stage 2). */
  private async syncRepositories(session: ProviderSession, scope: WriteScope): Promise<void> {
    const installations = await session.listInstallations();
    const repos = await session.listRepositories(installations);
    await this.writer.transaction(async (tx) => {
      const ids = installations.map((i) => BigInt(i.installationId));
      await tx.gitHubInstallation.deleteMany({
        where: { integrationId: scope.integrationId, installationId: { notIn: ids } },
      });
      for (const inst of installations) {
        const data = {
          accountLogin: inst.accountLogin,
          accountType: inst.accountType,
          repositorySelection: inst.repositorySelection,
          suspendedAt: inst.suspendedAt,
        };
        await tx.gitHubInstallation.upsert({
          where: {
            integrationId_installationId: {
              integrationId: scope.integrationId,
              installationId: BigInt(inst.installationId),
            },
          },
          create: {
            integrationId: scope.integrationId,
            installationId: BigInt(inst.installationId),
            ...data,
          },
          update: data,
        });
      }
      await this.writer.upsertRepositories(tx, scope, repos, {
        withActivity: false,
        markInstallation: true,
      });
      // Repositories no longer granted by any installation: reachable only if public.
      const granted = repos.map((r) => r.externalId);
      await tx.repository.updateMany({
        where: {
          userId: scope.userId,
          integrationId: scope.integrationId,
          installationId: { not: null },
          externalId: { notIn: granted },
          isPrivate: true,
        },
        data: { installationId: null, accessible: false },
      });
      await tx.repository.updateMany({
        where: {
          userId: scope.userId,
          integrationId: scope.integrationId,
          installationId: { not: null },
          externalId: { notIn: granted },
          isPrivate: false,
        },
        data: { installationId: null },
      });
    });
  }

  private async authoredStage(
    session: ProviderSession,
    scope: WriteScope,
    login: string,
    window: { from: Date; to: Date },
    counts: Counts,
    advance: (total: number | null) => Promise<void>,
  ): Promise<void> {
    let pages = 0;
    for await (const page of session.authoredPullRequests(login, window)) {
      await this.writer.transaction(async (tx) => {
        const { refs, created } = await this.writer.upsertRepositories(
          tx,
          scope,
          page.items.map((p) => p.repository),
          { withActivity: true },
        );
        counts.created += created;
        const result = await this.writer.upsertPullRequests(
          tx,
          scope,
          page.items.flatMap((pr) => {
            const ref = refs.get(pr.repository.externalId);
            return ref ? [{ pr, repositoryId: ref.id, authored: true }] : [];
          }),
        );
        counts.prsAuthored += page.items.length;
        counts.created += result.created;
        counts.updated += result.updated;
      });
      pages++;
      await advance(pages === 1 ? Math.ceil(page.total / 50) : null);
    }
    if (pages === 0) await advance(1);
  }

  private async reviewedStage(
    session: ProviderSession,
    scope: WriteScope,
    login: string,
    window: { from: Date; to: Date },
    counts: Counts,
    advance: (total: number | null) => Promise<void>,
  ): Promise<void> {
    let pages = 0;
    for await (const page of session.reviewedPullRequests(login, window)) {
      await this.writer.transaction(async (tx) => {
        const { refs, created } = await this.writer.upsertRepositories(
          tx,
          scope,
          page.items.map((r) => r.pullRequest.repository),
          { withActivity: true },
        );
        counts.created += created;
        const withRepo = page.items.flatMap((reviewed) => {
          const ref = refs.get(reviewed.pullRequest.repository.externalId);
          return ref ? [{ reviewed, repositoryId: ref.id }] : [];
        });
        const prs = await this.writer.upsertPullRequests(
          tx,
          scope,
          withRepo.map((w) => ({
            pr: w.reviewed.pullRequest,
            repositoryId: w.repositoryId,
            authored: false,
          })),
        );
        const reviews = await this.writer.upsertReviews(
          tx,
          scope,
          withRepo.flatMap((w) => {
            const id = prs.ids.get(w.reviewed.pullRequest.externalId);
            return id ? [{ reviewed: w.reviewed, pullRequestId: id }] : [];
          }),
        );
        counts.prsReviewed += page.items.length;
        counts.reviews += page.items.reduce((n, r) => n + r.reviews.length, 0);
        counts.created += prs.created + reviews.created;
        counts.updated += prs.updated + reviews.updated;
      });
      pages++;
      await advance(pages === 1 ? Math.ceil(page.total / 50) : null);
    }
    if (pages === 0) await advance(1);
  }

  private async commitStage(
    session: ProviderSession,
    scope: WriteScope,
    login: string,
    authorId: string,
    kind: SyncKind,
    slice: Slice,
    backfillFrom: Date | null,
    counts: Counts,
    failedRepoIds: Set<string>,
    addError: (
      stage: SyncRunError['stage'],
      code: string,
      message: string,
      repo: string | null,
    ) => void,
    advance: (total: number | null) => Promise<void>,
  ): Promise<void> {
    const active = await session.commitRepositories(login, slice);
    const refs = await this.writer.transaction(async (tx) => {
      const result = await this.writer.upsertRepositories(
        tx,
        scope,
        active.map((a) => a.repository),
        { withActivity: true },
      );
      counts.created += result.created;
      return result.refs;
    });

    const requests = new Map<string, { request: CommitRequest; ref: RepoRef }>();
    const add = (ref: RepoRef, since: Date) => {
      if (!ref.included || !ref.accessible) return; // excluded repositories are never fetched (F-11)
      requests.set(ref.externalId, {
        ref,
        request: { repository: this.normalized(ref), since, until: slice.to },
      });
    };
    for (const { repository } of active) {
      const ref = refs.get(repository.externalId);
      if (!ref) continue;
      const since =
        kind === SyncKind.INCREMENTAL && ref.commitCursor
          ? new Date(Math.max(slice.from.getTime(), ref.commitCursor.getTime() - CURSOR_OVERLAP_MS))
          : slice.from;
      add(ref, since);
    }
    if (kind === SyncKind.INCREMENTAL) {
      // Included repositories whose history is behind the window (e.g. re-included by the user).
      const stale = await this.prisma.repository.findMany({
        where: {
          userId: scope.userId,
          integrationId: scope.integrationId,
          included: true,
          accessible: true,
          lastActivityAt: { not: null },
          OR: [
            { commitCursor: null },
            { commitCursor: { lt: new Date(slice.from.getTime() - CURSOR_OVERLAP_MS) } },
          ],
        },
      });
      for (const ref of stale) {
        if (requests.has(ref.externalId)) continue;
        const start = ref.commitCursor ?? backfillFrom ?? slice.from;
        add(ref, new Date(start.getTime() - CURSOR_OVERLAP_MS));
      }
    }

    const plannedPages = [...requests.values()].reduce((n, { ref }) => {
      const activity = active.find((a) => a.repository.externalId === ref.externalId);
      return n + Math.max(1, Math.ceil((activity?.commitCount ?? 1) / 100));
    }, 1);
    await advance(plannedPages); // contributions call
    if (requests.size === 0) return;

    for await (const page of session.commits(
      authorId,
      [...requests.values()].map((r) => r.request),
    )) {
      const entry = requests.get(page.repositoryExternalId);
      if (!entry) continue;
      if (page.notFound) {
        failedRepoIds.add(entry.ref.id);
        addError(
          'commits',
          'REPOSITORY_NOT_ACCESSIBLE',
          'Repository is no longer accessible to the GitHub App',
          entry.ref.fullName,
        );
        await this.prisma.repository.updateMany({
          where: { id: entry.ref.id, userId: scope.userId },
          data: { accessible: false },
        });
        await advance(null);
        continue;
      }
      await this.writer.transaction(async (tx) => {
        const result = await this.writer.insertCommits(tx, scope, entry.ref.id, page.items);
        counts.commits += page.items.length;
        counts.created += result.created;
        if (page.branch && page.branch !== entry.ref.defaultBranch) {
          await tx.repository.updateMany({
            where: { id: entry.ref.id, userId: scope.userId },
            data: { defaultBranch: page.branch },
          });
        }
      });
      await advance(null);
    }
  }

  private normalized(ref: RepoRef): NormalizedRepository {
    return {
      externalId: ref.externalId,
      fullName: ref.fullName,
      ownerLogin: ref.ownerLogin,
      name: ref.name,
      isPrivate: ref.isPrivate,
      isFork: ref.isFork,
      isArchived: ref.isArchived,
      defaultBranch: ref.defaultBranch,
      htmlUrl: ref.htmlUrl,
      installationId: ref.installationId?.toString() ?? null,
    };
  }

  /**
   * Cursors advance only now that every stage of the run committed (ADR-0007). Repositories that
   * failed keep their cursor so the next run retries them. The first successful backfill purges
   * remaining v0.1 stubs and `legacy:` reviews — they are fully re-derived from GitHub (P06-3).
   */
  private async finalizeCursors(
    scope: WriteScope,
    kind: SyncKind,
    windowFrom: Date,
    windowTo: Date,
    failedRepoIds: Set<string>,
    firstBackfill: boolean,
  ): Promise<void> {
    await this.writer.transaction(async (tx) => {
      const cursor = {
        authoredPrsUpdatedAt: windowTo.toISOString(),
        reviewedPrsUpdatedAt: windowTo.toISOString(),
      };
      await tx.integration.updateMany({
        where: { id: scope.integrationId, userId: scope.userId },
        data: {
          syncCursor: cursor,
          ...(kind === SyncKind.BACKFILL ? { backfillFrom: windowFrom } : {}),
        },
      });
      await tx.repository.updateMany({
        where: {
          userId: scope.userId,
          integrationId: scope.integrationId,
          included: true,
          accessible: true,
          id: { notIn: [...failedRepoIds] },
          ...(kind === SyncKind.BACKFILL
            ? {}
            : { OR: [{ commitCursor: null }, { commitCursor: { lt: windowTo } }] }),
        },
        data: { commitCursor: windowTo, lastSyncedAt: new Date() },
      });
      if (kind === SyncKind.BACKFILL && firstBackfill) {
        await tx.pullRequestReview.deleteMany({
          where: {
            userId: scope.userId,
            integrationId: scope.integrationId,
            externalId: { startsWith: 'legacy:' },
          },
        });
        await tx.pullRequest.deleteMany({
          where: { userId: scope.userId, integrationId: scope.integrationId, legacyStub: true },
        });
      }
    });
    // Activity timestamps for the repository list (sort by -lastActivityAt).
    await this.prisma.$executeRaw`
      UPDATE "repositories" r SET "last_activity_at" = a.last_at
      FROM (
        SELECT "repository_id" AS id, MAX(t) AS last_at FROM (
          SELECT "repository_id", "authored_at" AS t FROM "commits" WHERE "userId" = ${scope.userId} AND "integrationId" = ${scope.integrationId}
          UNION ALL
          SELECT "repository_id", COALESCE("updated_at_remote", "created_at_remote") FROM "pull_requests" WHERE "userId" = ${scope.userId} AND "integrationId" = ${scope.integrationId}
        ) x GROUP BY 1
      ) a
      WHERE r.id = a.id AND r."user_id" = ${scope.userId}`;
  }
}
