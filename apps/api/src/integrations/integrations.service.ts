import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationMechanism, IntegrationStatus, Provider, SyncTrigger } from '@prisma/client';

import { AppException } from '../common/app-exception';
import { TokenCipher, TokenCipherService } from '../crypto/token-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry, kindOf } from '../providers/provider-registry';
import { SyncService } from '../sync/sync.service';
import {
  GitHubAppClient,
  type GitHubInstallationInfo,
  type GitHubUserToken,
} from './github-app.client';
import { assertIntegrationSlot } from './integration-slots';
import {
  SAFE_INTEGRATION_SELECT,
  scheduleSlotFor,
  toIntegrationDto,
  type SafeIntegration,
} from './integration.mapper';
import { OAuthStateService } from './oauth-state.service';
import { ProviderConnectService } from './provider-connect.service';

import type { Env } from '../config/env';
import type {
  ConnectGitHubResult,
  DisconnectResult,
  GitHubCallbackInput,
  IntegrationDto,
  SyncRunDto,
} from '@devimpact/shared';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly github: GitHubAppClient,
    private readonly state: OAuthStateService,
    private readonly cipher: TokenCipherService,
    private readonly sync: SyncService,
    private readonly registry: ProviderRegistry,
    private readonly providerConnect: ProviderConnectService,
  ) {}

  private get callbackUrl(): string {
    return `${this.config.get('WEB_URL', { infer: true })}/integrations/github/callback`;
  }

  private dto(row: SafeIntegration): IntegrationDto {
    const manage =
      row.provider === Provider.GITHUB
        ? this.github.manageUrl()
        : this.registry
            .oauth(kindOf(row.provider) as 'gitlab' | 'jira' | 'linear')
            .manageUrl(row.baseUrl);
    return toIntegrationDto(row, manage);
  }

  async list(userId: string): Promise<IntegrationDto[]> {
    const rows = await this.prisma.integration.findMany({
      where: { userId },
      select: SAFE_INTEGRATION_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.dto(row));
  }

  async get(
    userId: string,
    id: string,
  ): Promise<IntegrationDto & { currentRun: SyncRunDto | null }> {
    const row = await this.prisma.integration.findFirst({
      where: { id, userId },
      select: SAFE_INTEGRATION_SELECT,
    });
    if (!row) throw AppException.notFound('Integration');
    return { ...this.dto(row), currentRun: await this.sync.currentRun(userId, row.id) };
  }

  /** `POST /integrations/github/connect` — install (no installation yet) or authorize. */
  async connect(userId: string, returnTo?: string): Promise<ConnectGitHubResult> {
    this.github.assertConfigured();
    const [user, rows] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } }),
      this.prisma.integration.findMany({
        where: { userId, provider: Provider.GITHUB },
        select: { status: true, mechanism: true, _count: { select: { installations: true } } },
      }),
    ]);
    await assertIntegrationSlot(this.prisma, userId, user.plan, Provider.GITHUB);
    const hasInstallation = rows.some(
      (row) => row.mechanism === IntegrationMechanism.GITHUB_APP && row._count.installations > 0,
    );
    return hasInstallation
      ? this.authorizeLink(userId, { returnTo })
      : this.installLink(userId, returnTo);
  }

  /** `POST /integrations/:id/reconnect` — authorize again, bound to this integration. */
  async reconnect(userId: string, id: string): Promise<ConnectGitHubResult> {
    const row = await this.prisma.integration.findFirst({
      where: { id, userId },
      select: { id: true, provider: true, baseUrl: true },
    });
    if (!row) throw AppException.notFound('Integration');
    if (row.provider !== Provider.GITHUB) {
      return this.providerConnect.authorizeLink(
        userId,
        kindOf(row.provider) as 'gitlab' | 'jira' | 'linear',
        { integrationId: row.id, baseUrl: row.baseUrl ?? undefined },
      );
    }
    this.github.assertConfigured();
    return this.authorizeLink(userId, { integrationId: row.id });
  }

  private async installLink(userId: string, returnTo?: string): Promise<ConnectGitHubResult> {
    const issued = await this.state.issue(userId, { returnTo });
    return {
      url: this.github.installUrl(issued.state),
      mode: 'install',
      expiresAt: issued.expiresAt.toISOString(),
    };
  }

  private async authorizeLink(
    userId: string,
    extra: { returnTo?: string; integrationId?: string },
  ): Promise<ConnectGitHubResult> {
    const issued = await this.state.issue(userId, { ...extra, pkce: true });
    return {
      url: this.github.authorizeUrl(issued.state, issued.codeChallenge, this.callbackUrl),
      mode: 'authorize',
      expiresAt: issued.expiresAt.toISOString(),
    };
  }

  /** `POST /integrations/github/callback` (ARCHITECTURE_V2 §5). */
  async callback(
    userId: string,
    input: GitHubCallbackInput,
  ): Promise<
    | {
        kind: 'connected';
        integration: IntegrationDto;
        syncRun: SyncRunDto;
        returnTo: string | null;
      }
    | {
        kind: 'pending';
        integration: IntegrationDto | null;
        pendingApproval: true;
        returnTo: string | null;
      }
  > {
    // The state is verified (and burned) before anything else, including denied consent.
    const { payload, codeVerifier } = await this.state.consume(input.state, userId);
    const returnTo = payload.r ?? null;

    if (input.error) {
      throw new AppException(
        'OAUTH_DENIED',
        'GitHub access was not granted. You can try again at any time.',
      );
    }
    if (!input.code) {
      // setupAction=request: an organization owner must approve the installation first.
      const existing = await this.prisma.integration.findFirst({
        where: { userId, provider: Provider.GITHUB },
        select: SAFE_INTEGRATION_SELECT,
        orderBy: { updatedAt: 'desc' },
      });
      return {
        kind: 'pending',
        integration: existing ? this.dto(existing) : null,
        pendingApproval: true,
        returnTo,
      };
    }

    this.github.assertConfigured();
    const token = await this.github.exchangeCode(
      input.code,
      payload.p ? codeVerifier : undefined,
      this.callbackUrl,
    );
    let integration: SafeIntegration;
    let wasReconnect = false;
    try {
      const [profile, installations] = await Promise.all([
        this.github.getUser(token.accessToken),
        this.github.listInstallations(token.accessToken),
      ]);
      const before = await this.prisma.integration.findFirst({
        where: { userId, provider: Provider.GITHUB, externalAccountId: profile.nodeId },
        select: { status: true, backfillFrom: true },
      });
      wasReconnect = !!payload.i || before?.status === IntegrationStatus.NEEDS_REAUTH;
      integration = await this.upsertFromGitHub(userId, payload.i, token, profile, installations);
    } catch (error) {
      // Don't leave a live token behind if we could not store it.
      await this.github.revokeToken(token.accessToken);
      throw error;
    }

    // Backfill on first connect; incremental from the cursors after a reconnect (ARCHITECTURE_V2 §6.2).
    const syncRun = await this.sync.requestSync(userId, {
      integrationId: integration.id,
      trigger: wasReconnect ? SyncTrigger.RECONNECT : SyncTrigger.INITIAL,
      reuseActive: true,
    });
    const dto = this.dto(integration);
    if (input.setupAction === 'request') {
      return { kind: 'pending', integration: dto, pendingApproval: true, returnTo };
    }
    return { kind: 'connected', integration: dto, syncRun, returnTo };
  }

  private async upsertFromGitHub(
    userId: string,
    reconnectId: string | undefined,
    token: GitHubUserToken,
    profile: { nodeId: string; login: string; name: string | null; avatarUrl: string | null },
    installations: GitHubInstallationInfo[],
  ): Promise<SafeIntegration> {
    return this.prisma.$transaction(async (tx) => {
      // user-scope: deliberately global — enforces one GitHub account per DevImpact user.
      const byAccount = await tx.integration.findUnique({
        where: {
          provider_externalAccountId: {
            provider: Provider.GITHUB,
            externalAccountId: profile.nodeId,
          },
        },
        select: { id: true, userId: true },
      });
      if (byAccount && byAccount.userId !== userId) {
        throw new AppException(
          'INTEGRATION_ACCOUNT_IN_USE',
          'This GitHub account is already connected to another DevImpact account',
        );
      }

      let targetId = byAccount?.id;
      if (reconnectId) {
        const target = await tx.integration.findFirst({
          where: { id: reconnectId, userId },
          select: { id: true, externalAccountId: true },
        });
        if (!target) throw AppException.notFound('Integration');
        if (target.externalAccountId && target.externalAccountId !== profile.nodeId) {
          throw new AppException(
            'CONFLICT',
            'Reconnect with the GitHub account this integration belongs to',
          );
        }
        targetId = target.id;
      }
      // A migrated v0.1 row (no GitHub identity yet) is upgraded in place so its activity stays attached.
      targetId ??= (
        await tx.integration.findFirst({
          where: { userId, provider: Provider.GITHUB, externalAccountId: null },
          select: { id: true },
          orderBy: { updatedAt: 'desc' },
        })
      )?.id;

      if (!targetId) {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { plan: true },
        });
        await assertIntegrationSlot(tx, userId, user.plan, Provider.GITHUB);
        targetId = (
          await tx.integration.create({
            data: { userId, provider: Provider.GITHUB },
            select: { id: true },
          })
        ).id;
      }

      const id = targetId;
      await tx.integration.update({
        where: { id, userId },
        data: {
          mechanism: IntegrationMechanism.GITHUB_APP,
          externalAccountId: profile.nodeId,
          externalLogin: profile.login,
          displayName: profile.name,
          avatarUrl: profile.avatarUrl,
          status: IntegrationStatus.ACTIVE,
          statusReason: null,
          disconnectedAt: null,
          accessTokenEnc: this.cipher.encrypt(
            token.accessToken,
            TokenCipher.aad(id, 'accessToken'),
          ),
          refreshTokenEnc: token.refreshToken
            ? this.cipher.encrypt(token.refreshToken, TokenCipher.aad(id, 'refreshToken'))
            : null,
          accessTokenExpiresAt: token.accessTokenExpiresAt,
          refreshTokenExpiresAt: token.refreshTokenExpiresAt,
          scheduleSlotMinute: scheduleSlotFor(id),
        },
      });

      const ids = installations.map((inst) => BigInt(inst.id));
      await tx.gitHubInstallation.deleteMany({
        where: { integrationId: id, installationId: { notIn: ids } },
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
            integrationId_installationId: { integrationId: id, installationId: BigInt(inst.id) },
          },
          create: { integrationId: id, installationId: BigInt(inst.id), ...data },
          update: data,
        });
      }
      return tx.integration.findUniqueOrThrow({
        where: { id, userId },
        select: SAFE_INTEGRATION_SELECT,
      });
    });
  }

  /** `DELETE /integrations/:id` — revoke at GitHub (best effort), drop tokens, optionally purge activity. */
  async disconnect(userId: string, id: string, purgeData: boolean): Promise<DisconnectResult> {
    const row = await this.prisma.integration.findFirst({
      where: { id, userId },
      select: { id: true, provider: true, baseUrl: true, accessTokenEnc: true },
    });
    if (!row) throw AppException.notFound('Integration');

    let tokenRevoked = false;
    if (row.accessTokenEnc) {
      try {
        const token = this.cipher.decrypt(
          row.accessTokenEnc,
          TokenCipher.aad(row.id, 'accessToken'),
        );
        tokenRevoked =
          row.provider === Provider.GITHUB
            ? await this.github.revokeToken(token)
            : await this.registry.get(row.provider).revokeToken(token, row.baseUrl);
      } catch (error) {
        this.logger.warn({ integrationId: row.id, err: error }, 'Could not revoke provider token');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.integration.update({
        where: { id: row.id, userId },
        data: {
          status: IntegrationStatus.DISCONNECTED,
          statusReason: 'USER_DISCONNECTED',
          disconnectedAt: new Date(),
          accessTokenEnc: null,
          refreshTokenEnc: null,
          accessTokenExpiresAt: null,
          refreshTokenExpiresAt: null,
        },
      });
      // Linked identities belong to the connection (D-030): freed so they can be linked elsewhere.
      await tx.providerIdentity.deleteMany({ where: { userId, integrationId: row.id } });
      if (purgeData) {
        // Activity only; sync history stays (DATA_MODEL_V2 §6). Never purged implicitly (DATA-07).
        await tx.pullRequestReview.deleteMany({ where: { userId, integrationId: row.id } });
        await tx.commit.deleteMany({ where: { userId, integrationId: row.id } });
        await tx.pullRequest.deleteMany({ where: { userId, integrationId: row.id } });
        await tx.issue.deleteMany({ where: { userId, integrationId: row.id } });
        await tx.repository.deleteMany({ where: { userId, integrationId: row.id } });
      }
    });

    return { integrationId: row.id, status: 'disconnected', purged: purgeData, tokenRevoked };
  }

  /** Revokes every stored GitHub token of a user (account deletion). Best effort. */
  async revokeAllTokens(userId: string): Promise<void> {
    const rows = await this.prisma.integration.findMany({
      where: { userId, accessTokenEnc: { not: null } },
      select: { id: true, provider: true, baseUrl: true, accessTokenEnc: true },
    });
    for (const row of rows) {
      if (!row.accessTokenEnc) continue;
      try {
        const token = this.cipher.decrypt(
          row.accessTokenEnc,
          TokenCipher.aad(row.id, 'accessToken'),
        );
        if (row.provider === Provider.GITHUB) await this.github.revokeToken(token);
        else await this.registry.get(row.provider).revokeToken(token, row.baseUrl);
      } catch (error) {
        this.logger.warn({ integrationId: row.id, err: error }, 'Could not revoke GitHub token');
      }
    }
  }
}
