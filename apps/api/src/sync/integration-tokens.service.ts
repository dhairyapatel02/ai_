import { Inject, Injectable, Logger } from '@nestjs/common';
import { IntegrationStatus } from '@prisma/client';

import { TokenCipher, TokenCipherService } from '../crypto/token-cipher';
import { NotificationProducer } from '../email/notification-producer';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderAuthError } from '../providers/provider.errors';
import { ACTIVITY_PROVIDER } from '../providers/providers.module';
import { TOKEN_REFRESH_MARGIN_MS } from './sync.constants';

import type { ActivityProvider } from '@devimpact/shared';

export type ReauthReason =
  'GITHUB_TOKEN_REVOKED' | 'GITHUB_REFRESH_FAILED' | 'GITHUB_APP_AUTHORIZATION_REVOKED';

/**
 * Token lifecycle for data-source integrations (ADR-0004/0005, F-16): tokens are decrypted only
 * here, at call time; expiring user tokens are refreshed under a row lock (refresh tokens rotate,
 * so two jobs must never refresh concurrently); unrecoverable failures mark the integration
 * NEEDS_REAUTH, which also pauses its schedule (the fan-out only picks ACTIVE integrations).
 */
@Injectable()
export class IntegrationTokensService {
  private readonly logger = new Logger(IntegrationTokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: TokenCipherService,
    @Inject(ACTIVITY_PROVIDER) private readonly provider: ActivityProvider,
    private readonly notifications: NotificationProducer,
  ) {}

  /** A usable access token; refreshes when it expires within 10 minutes. */
  async accessToken(userId: string, integrationId: string, now = Date.now()): Promise<string> {
    const row = await this.prisma.integration.findFirst({
      where: { id: integrationId, userId },
      select: {
        status: true,
        accessTokenEnc: true,
        accessTokenExpiresAt: true,
        refreshTokenEnc: true,
      },
    });
    if (!row?.accessTokenEnc || row.status !== IntegrationStatus.ACTIVE) {
      throw new ProviderAuthError('NO_TOKEN');
    }
    const expiring =
      row.accessTokenExpiresAt !== null &&
      row.accessTokenExpiresAt.getTime() - now < TOKEN_REFRESH_MARGIN_MS;
    if (expiring && row.refreshTokenEnc) {
      const refreshed = await this.refresh(userId, integrationId, row.accessTokenEnc);
      if (!refreshed) throw new ProviderAuthError('REFRESH_FAILED');
      return refreshed;
    }
    return this.cipher.decrypt(row.accessTokenEnc, TokenCipher.aad(integrationId, 'accessToken'));
  }

  /**
   * Refreshes the user token unless another worker already did (the stored ciphertext changed
   * since `staleTokenEnc` was read). Returns null — after marking NEEDS_REAUTH — when GitHub
   * rejects the refresh token or there is none.
   */
  async refresh(
    userId: string,
    integrationId: string,
    staleTokenEnc: string | null,
  ): Promise<string | null> {
    const result = await this.prisma.$transaction(
      async (tx) => {
        // user-scope: row lock by primary key; the row is re-read with userId right below.
        await tx.$queryRaw`SELECT id FROM "integrations" WHERE id = ${integrationId} FOR UPDATE`;
        const row = await tx.integration.findFirst({
          where: { id: integrationId, userId },
          select: {
            accessTokenEnc: true,
            accessTokenExpiresAt: true,
            refreshTokenEnc: true,
            status: true,
          },
        });
        if (row?.status !== IntegrationStatus.ACTIVE) return null;
        if (
          row.accessTokenEnc &&
          row.accessTokenEnc !== staleTokenEnc &&
          (row.accessTokenExpiresAt === null ||
            row.accessTokenExpiresAt.getTime() - Date.now() >= TOKEN_REFRESH_MARGIN_MS)
        ) {
          return this.cipher.decrypt(
            row.accessTokenEnc,
            TokenCipher.aad(integrationId, 'accessToken'),
          );
        }
        if (!row.refreshTokenEnc) return null;
        let tokens;
        try {
          tokens = await this.provider.refreshToken(
            this.cipher.decrypt(
              row.refreshTokenEnc,
              TokenCipher.aad(integrationId, 'refreshToken'),
            ),
          );
        } catch (error) {
          if (error instanceof ProviderAuthError) return null;
          throw error;
        }
        await tx.integration.update({
          where: { id: integrationId, userId },
          data: {
            accessTokenEnc: this.cipher.encrypt(
              tokens.accessToken,
              TokenCipher.aad(integrationId, 'accessToken'),
            ),
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
            ...(tokens.refreshToken
              ? {
                  refreshTokenEnc: this.cipher.encrypt(
                    tokens.refreshToken,
                    TokenCipher.aad(integrationId, 'refreshToken'),
                  ),
                  refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
                }
              : {}),
          },
        });
        this.logger.log({ integrationId }, 'GitHub user token refreshed');
        return tokens.accessToken;
      },
      { timeout: 30_000 },
    );
    if (result === null) await this.markNeedsReauth(userId, integrationId, 'GITHUB_REFRESH_FAILED');
    return result;
  }

  /** Session hook for a 401: refresh once, else mark NEEDS_REAUTH. */
  async afterUnauthorized(userId: string, integrationId: string): Promise<string | null> {
    const row = await this.prisma.integration.findFirst({
      where: { id: integrationId, userId },
      select: { accessTokenEnc: true, refreshTokenEnc: true },
    });
    if (!row?.refreshTokenEnc) {
      await this.markNeedsReauth(userId, integrationId, 'GITHUB_TOKEN_REVOKED');
      return null;
    }
    return this.refresh(userId, integrationId, row.accessTokenEnc);
  }

  /** NEEDS_REAUTH: drop the unusable tokens, keep every activity row (FLOWS F3). */
  async markNeedsReauth(
    userId: string,
    integrationId: string,
    reason: ReauthReason,
  ): Promise<void> {
    const { count } = await this.prisma.integration.updateMany({
      where: { id: integrationId, userId, status: IntegrationStatus.ACTIVE },
      data: {
        status: IntegrationStatus.NEEDS_REAUTH,
        statusReason: reason,
        accessTokenEnc: null,
        refreshTokenEnc: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      },
    });
    this.logger.warn({ integrationId, reason }, 'Integration needs reconnection');
    // "Sync problems" email (F-65) — only on the transition, preference checked by the worker.
    if (count > 0) await this.notifications.syncProblem(userId, integrationId, 'needs_reauth');
  }
}
