import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IntegrationStatus,
  Provider,
  SyncKind,
  SyncStage,
  SyncStatus,
  SyncTrigger,
  WebhookStatus,
} from '@prisma/client';

import { MetricsQueueService } from '../metrics/metrics-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { PROVIDER_ENUM } from '../providers/provider-registry';
import { ProviderAuthError } from '../providers/provider.errors';
import { ACTIVITY_PROVIDER } from '../providers/providers.module';
import { IntegrationTokensService } from './integration-tokens.service';
import { SyncEngine } from './sync-engine.service';
import { SyncWriter, type WriteScope } from './sync-writer';
import { CURSOR_OVERLAP_MS } from './sync.constants';
import { SyncService } from './sync.service';

import type { TargetedJobData } from '../webhooks/webhooks.service';
import type {
  ActivityProvider,
  NormalizedRepository,
  ProviderWebhookEvent,
} from '@devimpact/shared';

interface Target {
  id: string;
  userId: string;
  externalLogin: string | null;
  externalAccountId: string | null;
}

const TARGET_SELECT = {
  id: true,
  userId: true,
  externalLogin: true,
  externalAccountId: true,
} as const;

/** Job payloads are JSON: restore the Date fields of a normalised event. */
function rehydrate(event: ProviderWebhookEvent): ProviderWebhookEvent {
  if (event.kind === 'push' && event.earliestCommitAt) {
    return { ...event, earliestCommitAt: new Date(event.earliestCommitAt) };
  }
  if (event.kind === 'installation' && event.installation?.suspendedAt) {
    return {
      ...event,
      installation: {
        ...event.installation,
        suspendedAt: new Date(event.installation.suspendedAt),
      },
    };
  }
  return event;
}

/**
 * `sync.targeted` (ARCHITECTURE_V2 §6.4): resolves the integrations a webhook affects (author /
 * reviewer / pusher among connected users, or the installation), refetches only the affected
 * PR or commits with that user's token, upserts idempotently and queues `metrics.recompute`.
 */
@Injectable()
export class SyncTargetedService {
  private readonly logger = new Logger(SyncTargetedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: SyncWriter,
    private readonly engine: SyncEngine,
    private readonly tokens: IntegrationTokensService,
    private readonly metrics: MetricsQueueService,
    private readonly sync: SyncService,
    @Inject(ACTIVITY_PROVIDER) private readonly provider: ActivityProvider,
  ) {}

  async handle(data: TargetedJobData, attempt = { number: 1, max: 1 }): Promise<void> {
    const event = rehydrate(data.event);
    try {
      await this.dispatch(event, data.deliveryId);
      await this.markDelivery(data.deliveryId, WebhookStatus.PROCESSED, null);
    } catch (error) {
      if (attempt.number < attempt.max) throw error;
      await this.markDelivery(
        data.deliveryId,
        WebhookStatus.FAILED,
        error instanceof Error ? error.name : 'Error',
      );
      this.logger.error({ deliveryId: data.deliveryId, err: error }, 'Webhook processing failed');
    }
  }

  private async markDelivery(id: string, status: WebhookStatus, error: string | null) {
    await this.prisma.webhookDelivery.updateMany({
      where: { id },
      data: { status, error, processedAt: new Date() },
    });
  }

  private async byLogin(
    logins: (string | null)[],
    externalIds: (string | null)[] = [],
  ): Promise<Target[]> {
    const names = logins.filter((l): l is string => !!l);
    const ids = externalIds.filter((l): l is string => !!l);
    if (names.length === 0 && ids.length === 0) return [];
    // user-scope: webhook fan-in — resolves which connected users an event concerns.
    return this.prisma.integration.findMany({
      where: {
        provider: Provider.GITHUB,
        status: IntegrationStatus.ACTIVE,
        OR: [
          ...(ids.length ? [{ externalAccountId: { in: ids } }] : []),
          ...names.map((login) => ({
            externalLogin: { equals: login, mode: 'insensitive' as const },
          })),
        ],
      },
      select: TARGET_SELECT,
    });
  }

  private async dispatch(event: ProviderWebhookEvent, deliveryId: string): Promise<void> {
    switch (event.kind) {
      case 'pull_request':
      case 'pull_request_review': {
        const people =
          event.kind === 'pull_request'
            ? await this.byLogin([event.authorLogin], [event.authorExternalId])
            : await this.byLogin(
                [event.authorLogin, event.reviewerLogin],
                [event.authorExternalId, event.reviewerExternalId],
              );
        // Users who already hold a reviewed copy of this PR get their row refreshed too.
        // user-scope: webhook fan-in across users that track this repository + number.
        const reviewers = await this.prisma.pullRequest.findMany({
          where: {
            number: event.number,
            isAuthoredByUser: false,
            repository: { externalId: event.repository.externalId },
            integration: { status: IntegrationStatus.ACTIVE },
          },
          select: { integration: { select: TARGET_SELECT } },
        });
        const targets = new Map<string, Target>();
        for (const t of [...people, ...reviewers.map((r) => r.integration)]) targets.set(t.id, t);
        for (const target of targets.values()) {
          await this.refreshPullRequest(target, event.repository, event.number, deliveryId);
        }
        return;
      }
      case 'push': {
        for (const target of await this.byLogin(event.authorLogins)) {
          await this.refreshCommits(target, event.repository, event.earliestCommitAt, deliveryId);
        }
        return;
      }
      case 'installation':
        await this.handleInstallation(event);
        return;
      case 'authorization_revoked': {
        if (!event.senderExternalId) return;
        // user-scope: the revoked GitHub account identifies its (single) integration.
        const rows = await this.prisma.integration.findMany({
          where: { provider: Provider.GITHUB, externalAccountId: event.senderExternalId },
          select: { id: true, userId: true },
        });
        for (const row of rows)
          await this.tokens.markNeedsReauth(row.userId, row.id, 'GITHUB_APP_AUTHORIZATION_REVOKED');
        return;
      }
      case 'activity_changed':
        await this.handleActivityChanged(event);
        return;
      case 'ignored':
        return;
    }
  }

  /**
   * GitLab / Jira / Linear webhooks (P13): an incremental sync of each matching integration (cursor
   * − 1 h) instead of a per-record refetch. Reuses an active run, so bursts collapse into one.
   */
  private async handleActivityChanged(
    event: Extract<ProviderWebhookEvent, { kind: 'activity_changed' }>,
  ): Promise<void> {
    const provider = PROVIDER_ENUM[event.provider];
    const accounts = event.accountExternalIds.slice(0, 20);
    const repos = event.repositoryExternalIds.slice(0, 20);
    if (accounts.length === 0 && repos.length === 0) return;
    // user-scope: webhook fan-in — resolves which connected users an event concerns.
    const rows = await this.prisma.integration.findMany({
      where: {
        provider,
        status: IntegrationStatus.ACTIVE,
        OR: [
          ...(accounts.length ? [{ externalAccountId: { in: accounts } }] : []),
          ...(repos.length
            ? [{ repositories: { some: { externalId: { in: repos }, included: true } } }]
            : []),
        ],
      },
      select: { id: true, userId: true, config: true },
      take: 200,
    });
    for (const row of rows) {
      if (event.siteId && !siteMatches(row.config, event.siteId)) continue;
      try {
        await this.sync.requestSync(row.userId, {
          integrationId: row.id,
          trigger: SyncTrigger.WEBHOOK,
          reuseActive: true,
        });
      } catch (error) {
        this.logger.warn({ integrationId: row.id, err: error }, 'Webhook sync not queued');
      }
    }
  }

  /** Runs `fn` inside a TARGETED SyncRun so webhook work is visible in sync history. */
  private async withRun(
    target: Target,
    deliveryId: string,
    stage: SyncStage,
    fn: (scope: WriteScope) => Promise<{ from: Date; to: Date } | null>,
  ): Promise<void> {
    const run = await this.prisma.syncRun.create({
      data: {
        userId: target.userId,
        integrationId: target.id,
        trigger: SyncTrigger.WEBHOOK,
        kind: SyncKind.TARGETED,
        status: SyncStatus.RUNNING,
        stage,
        startedAt: new Date(),
        webhookDeliveryId: deliveryId,
      },
    });
    try {
      const range = await fn({ userId: target.userId, integrationId: target.id });
      await this.prisma.syncRun.updateMany({
        where: { id: run.id, userId: target.userId },
        data: {
          status: SyncStatus.SUCCEEDED,
          stage: SyncStage.DONE,
          progress: 100,
          finishedAt: new Date(),
        },
      });
      if (range) {
        await this.metrics.enqueueRecompute({
          userId: target.userId,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          reason: 'webhook',
        });
      }
    } catch (error) {
      const auth = error instanceof ProviderAuthError;
      if (auth) await this.tokens.markNeedsReauth(target.userId, target.id, 'GITHUB_TOKEN_REVOKED');
      await this.prisma.syncRun.updateMany({
        where: { id: run.id, userId: target.userId },
        data: {
          status: SyncStatus.FAILED,
          finishedAt: new Date(),
          errorCode: auth ? 'GITHUB_REAUTH_REQUIRED' : 'GITHUB_UNAVAILABLE',
          errorMessage: auth
            ? 'GitHub access was revoked. Reconnect GitHub to resume syncing.'
            : 'GitHub could not be reached.',
        },
      });
      if (!auth) throw error;
    }
  }

  private async refreshPullRequest(
    target: Target,
    repository: NormalizedRepository,
    number: number,
    deliveryId: string,
  ) {
    if (!target.externalLogin) return;
    const login = target.externalLogin;
    await this.withRun(target, deliveryId, SyncStage.AUTHORED_PRS, async (scope) => {
      const session = this.engine.openSession(scope.userId, scope.integrationId);
      const result = await session.pullRequest(login, repository.fullName, number);
      if (!result) return null;
      const pr = result.role === 'authored' ? result.pullRequest : result.reviewed.pullRequest;
      if (result.role === 'reviewed' && result.reviewed.reviews.length === 0) {
        // Not (or no longer) reviewed by this user: keep any existing row untouched.
        // user-scope: scoped by userId inside `scope`.
        const existing = await this.prisma.pullRequest.count({
          where: {
            userId: scope.userId,
            integrationId: scope.integrationId,
            number,
            repository: { externalId: pr.repository.externalId },
          },
        });
        if (existing === 0) return null;
      }
      await this.writer.transaction(async (tx) => {
        const { refs } = await this.writer.upsertRepositories(tx, scope, [pr.repository], {
          withActivity: true,
        });
        const ref = refs.get(pr.repository.externalId);
        if (!ref) return;
        const prs = await this.writer.upsertPullRequests(tx, scope, [
          { pr, repositoryId: ref.id, authored: result.role === 'authored' },
        ]);
        if (result.role === 'reviewed') {
          const id = prs.ids.get(pr.externalId);
          if (id)
            await this.writer.upsertReviews(tx, scope, [
              { reviewed: result.reviewed, pullRequestId: id },
            ]);
        }
      });
      const touched = [pr.createdAt, pr.mergedAt, pr.closedAt, pr.updatedAt].filter(
        (d): d is Date => d !== null,
      );
      return { from: new Date(Math.min(...touched.map((d) => d.getTime()))), to: new Date() };
    });
  }

  private async refreshCommits(
    target: Target,
    repository: NormalizedRepository,
    earliest: Date | null,
    deliveryId: string,
  ) {
    if (!target.externalAccountId) return;
    const authorId = target.externalAccountId;
    await this.withRun(target, deliveryId, SyncStage.COMMITS, async (scope) => {
      const ref = await this.writer.transaction(async (tx) => {
        const { refs } = await this.writer.upsertRepositories(tx, scope, [repository], {
          withActivity: true,
        });
        return refs.get(repository.externalId);
      });
      if (!ref?.included || !ref.accessible) return null; // excluded repositories are not imported
      const until = new Date();
      const since = new Date(
        (earliest ?? new Date(until.getTime() - 86_400_000)).getTime() - CURSOR_OVERLAP_MS,
      );
      const session = this.engine.openSession(scope.userId, scope.integrationId);
      for await (const page of session.commits(authorId, [{ repository, since, until }])) {
        if (page.notFound) return null;
        await this.writer.transaction((tx) =>
          this.writer.insertCommits(tx, scope, ref.id, page.items),
        );
      }
      return { from: since, to: until };
    });
  }

  /** installation / installation_repositories: bookkeeping + repo access (installation token). */
  private async handleInstallation(event: Extract<ProviderWebhookEvent, { kind: 'installation' }>) {
    const installationId = BigInt(event.installationId);
    // user-scope: installations are resolved globally, then every write is scoped below.
    const linked = await this.prisma.integration.findMany({
      where: {
        provider: Provider.GITHUB,
        OR: [
          { installations: { some: { installationId } } },
          ...(event.senderExternalId ? [{ externalAccountId: event.senderExternalId }] : []),
        ],
      },
      select: { ...TARGET_SELECT, status: true },
    });

    // Repositories the installation grants, fetched with the App installation token (ADR-0004).
    // This list is NOT filtered by what each linked user may see on GitHub (an org member can be
    // linked to an "all repositories" installation through one repo), so it is only used to
    // refresh rows a user already has; new repositories arrive through a per-user sync that lists
    // them with the user's own token (security review, P06).
    let granted = event.repositoriesAdded;
    if (['created', 'new_permissions_accepted', 'unsuspend'].includes(event.action)) {
      try {
        granted = await this.provider.installationRepositories(event.installationId);
      } catch (error) {
        this.logger.warn(
          { installationId: event.installationId, err: error },
          'Installation repositories unavailable; using payload',
        );
      }
    }
    const grantsAccess = event.action !== 'deleted' && event.action !== 'suspend';

    for (const target of linked) {
      const scope = { userId: target.userId, integrationId: target.id };
      if (event.action === 'deleted') {
        await this.prisma.$transaction([
          this.prisma.gitHubInstallation.deleteMany({
            where: { integrationId: target.id, installationId },
          }),
          this.prisma.repository.updateMany({
            where: {
              userId: scope.userId,
              integrationId: scope.integrationId,
              installationId,
              isPrivate: true,
            },
            data: { installationId: null, accessible: false },
          }),
          this.prisma.repository.updateMany({
            where: {
              userId: scope.userId,
              integrationId: scope.integrationId,
              installationId,
              isPrivate: false,
            },
            data: { installationId: null },
          }),
        ]);
        continue;
      }
      if (event.installation) {
        const data = {
          accountLogin: event.installation.accountLogin,
          accountType: event.installation.accountType,
          repositorySelection: event.installation.repositorySelection,
          suspendedAt:
            event.action === 'suspend'
              ? (event.installation.suspendedAt ?? new Date())
              : event.action === 'unsuspend'
                ? null
                : event.installation.suspendedAt,
        };
        await this.prisma.gitHubInstallation.upsert({
          where: { integrationId_installationId: { integrationId: target.id, installationId } },
          create: { integrationId: target.id, installationId, ...data },
          update: data,
        });
      }
      await this.writer.transaction(async (tx) => {
        if (grantsAccess && granted.length) {
          // Existing rows only — never create a repository from an unfiltered list.
          await tx.repository.updateMany({
            where: {
              userId: scope.userId,
              integrationId: scope.integrationId,
              externalId: { in: granted.map((r) => r.externalId) },
            },
            data: { installationId, accessible: true },
          });
        }
        const removed = event.repositoriesRemoved.map((r) => r.externalId);
        if (removed.length) {
          await tx.repository.updateMany({
            where: {
              userId: scope.userId,
              integrationId: scope.integrationId,
              externalId: { in: removed },
              isPrivate: true,
            },
            data: { installationId: null, accessible: false },
          });
          await tx.repository.updateMany({
            where: {
              userId: scope.userId,
              integrationId: scope.integrationId,
              externalId: { in: removed },
              isPrivate: false,
            },
            data: { installationId: null },
          });
        }
        if (event.action === 'suspend') {
          await tx.repository.updateMany({
            where: {
              userId: scope.userId,
              integrationId: scope.integrationId,
              installationId,
              isPrivate: true,
            },
            data: { accessible: false },
          });
        }
      });
      if (grantsAccess && target.status === IntegrationStatus.ACTIVE) {
        // Newly granted repositories are discovered with the user's token (GitHub filters them).
        try {
          await this.sync.requestSync(target.userId, {
            integrationId: target.id,
            trigger: SyncTrigger.WEBHOOK,
            reuseActive: true,
          });
        } catch (error) {
          this.logger.warn({ integrationId: target.id, err: error }, 'Repository sync not queued');
        }
      }
    }
  }
}

/** Jira: site origin in `config.sites[].url`; Linear: `config.organization.id`. */
function siteMatches(config: unknown, siteId: string): boolean {
  const c = (config ?? {}) as {
    sites?: { url?: string }[];
    organization?: { id?: string };
  };
  if (c.organization?.id) return c.organization.id === siteId;
  if (Array.isArray(c.sites)) {
    return c.sites.some((site) => {
      try {
        return new URL(site.url ?? '').origin === siteId;
      } catch {
        return false;
      }
    });
  }
  return true;
}
