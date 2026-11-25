import {
  PROVIDER_LABELS,
  type ConnectProviderResult,
  type IdentityDto,
  type IntegrationDto,
  type OAuthProviderWire,
  type ProviderAccount,
  type ProviderCallbackInput,
  type ProviderTokenSet,
  type SyncRunDto,
} from '@devimpact/shared';
import { Injectable, Logger } from '@nestjs/common';
import {
  IdentityKind,
  IdentitySource,
  IntegrationMechanism,
  IntegrationStatus,
  Prisma,
  SyncTrigger,
} from '@prisma/client';

import { AppException } from '../common/app-exception';
import { TokenCipher, TokenCipherService } from '../crypto/token-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { PROVIDER_ENUM, ProviderRegistry } from '../providers/provider-registry';
import { SyncService } from '../sync/sync.service';
import { assertIntegrationSlot } from './integration-slots';
import { SAFE_INTEGRATION_SELECT, scheduleSlotFor, toIntegrationDto } from './integration.mapper';
import { OAuthStateService } from './oauth-state.service';

/** `GET /integrations/providers` entry (S19 decides which cards can connect). */
export interface ProviderAvailability {
  provider: 'github' | OAuthProviderWire;
  category: 'code' | 'issues';
  configured: boolean;
  instances: { url: string; label: string }[];
}

/**
 * GitLab / Jira / Linear connect flows (P13, ARCHITECTURE_V2 §5, D-030): signed single-use state
 * bound to user + provider (+ GitLab instance), PKCE S256 where the provider supports it, code
 * exchange on the server, tokens encrypted with AAD bound to integration + field (D-005), provider
 * identities linked, backfill queued. A token is revoked again if it cannot be stored.
 */
@Injectable()
export class ProviderConnectService {
  private readonly logger = new Logger(ProviderConnectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly state: OAuthStateService,
    private readonly cipher: TokenCipherService,
    private readonly sync: SyncService,
  ) {}

  availability(githubConfigured: boolean): ProviderAvailability[] {
    return [
      { provider: 'github', category: 'code', configured: githubConfigured, instances: [] },
      {
        provider: 'gitlab',
        category: 'code',
        configured: this.registry.oauth('gitlab').configured(),
        instances: this.registry.gitlabInstances
          .list()
          .map((i) => ({ url: i.url, label: i.label })),
      },
      {
        provider: 'jira',
        category: 'issues',
        configured: this.registry.oauth('jira').configured(),
        instances: [],
      },
      {
        provider: 'linear',
        category: 'issues',
        configured: this.registry.oauth('linear').configured(),
        instances: [],
      },
    ];
  }

  private assertConfigured(kind: OAuthProviderWire): void {
    if (!this.registry.oauth(kind).configured()) {
      throw new AppException(
        'UPSTREAM_UNAVAILABLE',
        `${PROVIDER_LABELS[kind]} is not configured on this server`,
        { provider: kind, reason: 'not_configured' },
      );
    }
  }

  /** Validates a self-managed GitLab origin against the allow-list (SSRF guard). */
  private baseUrlFor(kind: OAuthProviderWire, baseUrl: string | undefined): string | undefined {
    if (kind !== 'gitlab') {
      if (baseUrl) {
        throw new AppException('VALIDATION_FAILED', 'baseUrl is only supported for GitLab', {
          issues: [{ path: 'body.baseUrl', message: 'Not supported', code: 'custom' }],
        });
      }
      return undefined;
    }
    const instance = this.registry.gitlabInstances.resolve(baseUrl);
    if (!instance) {
      throw new AppException('VALIDATION_FAILED', 'This GitLab instance is not configured', {
        issues: [{ path: 'body.baseUrl', message: 'Unknown GitLab instance', code: 'custom' }],
      });
    }
    // gitlab.com / the default instance is stored as null.
    return instance.url === this.registry.gitlabInstances.list()[0]?.url ? undefined : instance.url;
  }

  /** `POST /integrations/:provider/connect`. */
  async connect(
    userId: string,
    kind: OAuthProviderWire,
    input: { returnTo?: string; baseUrl?: string },
  ): Promise<ConnectProviderResult> {
    this.assertConfigured(kind);
    const baseUrl = this.baseUrlFor(kind, input.baseUrl);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true },
    });
    await assertIntegrationSlot(this.prisma, userId, user.plan, PROVIDER_ENUM[kind]);
    return this.authorizeLink(userId, kind, { returnTo: input.returnTo, baseUrl });
  }

  async authorizeLink(
    userId: string,
    kind: OAuthProviderWire,
    extra: { returnTo?: string; integrationId?: string; baseUrl?: string },
  ): Promise<ConnectProviderResult> {
    this.assertConfigured(kind);
    const client = this.registry.oauth(kind);
    const issued = await this.state.issue(userId, {
      returnTo: extra.returnTo,
      integrationId: extra.integrationId,
      pkce: client.usesPkce,
      provider: kind,
      baseUrl: extra.baseUrl,
    });
    return {
      url: client.authorizeUrl({
        state: issued.state,
        codeChallenge: issued.codeChallenge,
        redirectUri: client.callbackUrl(),
        baseUrl: extra.baseUrl ?? null,
      }),
      mode: 'authorize',
      expiresAt: issued.expiresAt.toISOString(),
    };
  }

  /** `POST /integrations/:provider/callback`. */
  async callback(
    userId: string,
    kind: OAuthProviderWire,
    input: ProviderCallbackInput,
  ): Promise<{ integration: IntegrationDto; syncRun: SyncRunDto; returnTo: string | null }> {
    const { payload, codeVerifier } = await this.state.consume(input.state, userId);
    if (payload.k !== kind) {
      throw new AppException(
        'OAUTH_STATE_INVALID',
        'This connection link is invalid or has expired. Please start again.',
      );
    }
    const label = PROVIDER_LABELS[kind];
    if (input.error || !input.code) {
      throw new AppException(
        'OAUTH_DENIED',
        `${label} access was not granted. You can try again at any time.`,
      );
    }
    this.assertConfigured(kind);
    const client = this.registry.oauth(kind);
    const baseUrl = payload.b ?? null;
    if (kind === 'gitlab' && !this.registry.gitlabInstances.resolve(baseUrl)) {
      throw new AppException(
        'OAUTH_STATE_INVALID',
        'This GitLab instance is no longer configured.',
      );
    }
    const token = await client.exchangeCode({
      code: input.code,
      codeVerifier: payload.p ? codeVerifier : '',
      redirectUri: client.callbackUrl(),
      baseUrl,
    });
    const provider = this.registry.get(PROVIDER_ENUM[kind]);
    let result: { id: string; wasReconnect: boolean };
    try {
      const account = await client.account(token.accessToken, baseUrl);
      result = await this.store(userId, kind, payload.i, baseUrl, token, account);
    } catch (error) {
      await provider.revokeToken(token.accessToken, baseUrl).catch(() => false);
      throw error;
    }
    const syncRun = await this.sync.requestSync(userId, {
      integrationId: result.id,
      trigger: result.wasReconnect ? SyncTrigger.RECONNECT : SyncTrigger.INITIAL,
      reuseActive: true,
    });
    const row = await this.prisma.integration.findUniqueOrThrow({
      where: { id: result.id, userId },
      select: SAFE_INTEGRATION_SELECT,
    });
    return {
      integration: toIntegrationDto(row, client.manageUrl(row.baseUrl)),
      syncRun,
      returnTo: payload.r ?? null,
    };
  }

  private async store(
    userId: string,
    kind: OAuthProviderWire,
    reconnectId: string | undefined,
    baseUrl: string | null,
    token: ProviderTokenSet,
    account: ProviderAccount,
  ): Promise<{ id: string; wasReconnect: boolean }> {
    const provider = PROVIDER_ENUM[kind];
    return this.prisma.$transaction(async (tx) => {
      // user-scope: deliberately global — one provider account → one DevImpact user.
      const byAccount = await tx.integration.findUnique({
        where: { provider_externalAccountId: { provider, externalAccountId: account.externalId } },
        select: { id: true, userId: true, status: true },
      });
      if (byAccount && byAccount.userId !== userId) {
        throw new AppException(
          'INTEGRATION_ACCOUNT_IN_USE',
          `This ${PROVIDER_LABELS[kind]} account is already connected to another DevImpact account`,
        );
      }
      let targetId = byAccount?.id;
      let wasReconnect = byAccount?.status === IntegrationStatus.NEEDS_REAUTH;
      if (reconnectId) {
        const target = await tx.integration.findFirst({
          where: { id: reconnectId, userId, provider },
          select: { id: true, externalAccountId: true },
        });
        if (!target) throw AppException.notFound('Integration');
        if (target.externalAccountId && target.externalAccountId !== account.externalId) {
          throw new AppException(
            'CONFLICT',
            `Reconnect with the ${PROVIDER_LABELS[kind]} account this integration belongs to`,
          );
        }
        targetId = target.id;
        wasReconnect = true;
      }
      if (!targetId || byAccount?.status === IntegrationStatus.DISCONNECTED) {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { plan: true },
        });
        await assertIntegrationSlot(tx, userId, user.plan, provider);
      }
      targetId ??= (
        await tx.integration.create({
          data: { userId, provider, mechanism: IntegrationMechanism.OAUTH2 },
          select: { id: true },
        })
      ).id;
      const id = targetId;
      await tx.integration.update({
        where: { id, userId },
        data: {
          mechanism: IntegrationMechanism.OAUTH2,
          externalAccountId: account.externalId,
          externalLogin: account.login,
          displayName: account.name,
          avatarUrl: account.avatarUrl,
          baseUrl,
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
      await this.linkProviderIdentities(tx, userId, id, kind, baseUrl, account);
      return { id, wasReconnect };
    });
  }

  /**
   * Identities reported by the provider (account id, username, verified emails) are linked as
   * verified `PROVIDER` identities. A verified identity wins over another user's unverified
   * `MANUAL` claim of the same email (D-030); it never takes another user's verified identity.
   */
  private async linkProviderIdentities(
    tx: Prisma.TransactionClient,
    userId: string,
    integrationId: string,
    kind: OAuthProviderWire,
    baseUrl: string | null,
    account: ProviderAccount,
  ): Promise<void> {
    const provider = PROVIDER_ENUM[kind];
    const host = baseUrl ? new URL(baseUrl).host : null;
    const wanted: { kind: IdentityKind; value: string }[] = [
      { kind: IdentityKind.ACCOUNT, value: account.externalId },
      { kind: IdentityKind.USERNAME, value: host ? `${host}/${account.login}` : account.login },
      ...(account.verifiedEmails ?? []).map((email) => ({
        kind: IdentityKind.EMAIL,
        value: email.trim().toLowerCase(),
      })),
    ].filter((i) => i.value.length > 0 && i.value.length <= 254);
    await tx.providerIdentity.deleteMany({
      where: { userId, integrationId, source: IdentitySource.PROVIDER },
    });
    for (const identity of wanted) {
      // user-scope: global uniqueness — drop another user's unverified claim of this identity.
      await tx.providerIdentity.deleteMany({
        where: {
          provider,
          kind: identity.kind,
          value: identity.value,
          source: IdentitySource.MANUAL,
        },
      });
      await tx.providerIdentity.createMany({
        data: [
          {
            userId,
            integrationId,
            provider,
            kind: identity.kind,
            value: identity.value,
            source: IdentitySource.PROVIDER,
            verified: true,
          },
        ],
        skipDuplicates: true,
      });
    }
  }

  // ── Identity linking API (D-030) ──────────────────────────────────────────────────────────

  private async ownIntegration(userId: string, id: string) {
    const row = await this.prisma.integration.findFirst({
      where: { id, userId },
      select: { id: true, provider: true, status: true },
    });
    if (!row) throw AppException.notFound('Integration');
    return row;
  }

  private identityDto(row: {
    id: string;
    integrationId: string;
    provider: string;
    kind: IdentityKind;
    value: string;
    source: IdentitySource;
    verified: boolean;
    createdAt: Date;
  }): IdentityDto {
    return {
      id: row.id,
      integrationId: row.integrationId,
      provider: row.provider.toLowerCase() as IdentityDto['provider'],
      kind: row.kind.toLowerCase() as IdentityDto['kind'],
      value: row.value,
      source: row.source.toLowerCase() as IdentityDto['source'],
      verified: row.verified,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listIdentities(userId: string, integrationId: string): Promise<IdentityDto[]> {
    await this.ownIntegration(userId, integrationId);
    const rows = await this.prisma.providerIdentity.findMany({
      where: { userId, integrationId },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.identityDto(r));
  }

  /**
   * Manually links a commit email (GitLab: commits authored with another address). Unverified;
   * refused when any other user already holds it (409), and capped at 10 per integration.
   */
  async addIdentity(userId: string, integrationId: string, email: string): Promise<IdentityDto> {
    const integration = await this.ownIntegration(userId, integrationId);
    if (integration.status === IntegrationStatus.DISCONNECTED) {
      throw new AppException('CONFLICT', 'This connection is disconnected');
    }
    const count = await this.prisma.providerIdentity.count({
      where: { userId, integrationId, source: IdentitySource.MANUAL },
    });
    if (count >= 10) {
      throw new AppException('CONFLICT', 'You can link up to 10 extra emails per connection', {
        reason: 'identity_limit',
      });
    }
    try {
      const row = await this.prisma.providerIdentity.create({
        data: {
          userId,
          integrationId,
          provider: integration.provider,
          kind: IdentityKind.EMAIL,
          value: email,
          source: IdentitySource.MANUAL,
          verified: false,
        },
      });
      // Older commits by this email arrive with the next backfill.
      await this.prisma.integration.updateMany({
        where: { id: integrationId, userId },
        data: { backfillFrom: null },
      });
      return this.identityDto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('CONFLICT', 'This email is already linked to an account', {
          reason: 'identity_in_use',
        });
      }
      throw error;
    }
  }

  async removeIdentity(userId: string, integrationId: string, identityId: string): Promise<void> {
    await this.ownIntegration(userId, integrationId);
    const row = await this.prisma.providerIdentity.findFirst({
      where: { id: identityId, userId, integrationId },
      select: { id: true, source: true },
    });
    if (!row) throw AppException.notFound('Identity');
    if (row.source !== IdentitySource.MANUAL) {
      throw new AppException('CONFLICT', 'Identities reported by the provider cannot be removed', {
        reason: 'provider_identity',
      });
    }
    await this.prisma.providerIdentity.deleteMany({ where: { id: row.id, userId } });
  }

  /** `PATCH /integrations/:id` — Jira story points field; a change re-reads every issue. */
  async update(
    userId: string,
    integrationId: string,
    input: { storyPointsField?: string | null },
  ): Promise<void> {
    const row = await this.prisma.integration.findFirst({
      where: { id: integrationId, userId },
      select: { id: true, provider: true, config: true },
    });
    if (!row) throw AppException.notFound('Integration');
    if (input.storyPointsField === undefined) return;
    if (row.provider !== 'JIRA') {
      throw new AppException('VALIDATION_FAILED', 'storyPointsField is only supported for Jira', {
        issues: [{ path: 'body.storyPointsField', message: 'Not supported', code: 'custom' }],
      });
    }
    const config = {
      ...((row.config ?? {}) as Record<string, unknown>),
      storyPointsField: input.storyPointsField,
    };
    await this.prisma.integration.updateMany({
      where: { id: row.id, userId },
      data: { config: config, backfillFrom: null },
    });
    try {
      await this.sync.requestSync(userId, {
        integrationId: row.id,
        trigger: SyncTrigger.MANUAL,
        reuseActive: true,
      });
    } catch (error) {
      this.logger.warn(
        { integrationId: row.id, err: error },
        'Re-sync after settings change not queued',
      );
    }
  }
}
