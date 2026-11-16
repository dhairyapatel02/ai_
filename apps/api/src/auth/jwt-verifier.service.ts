import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

import { AppException } from '../common/app-exception';

import type { Env } from '../config/env';
import type { AuthUser } from './auth.decorators';

const JWKS_CACHE_MS = 10 * 60 * 1000;
const CLOCK_TOLERANCE_S = 60;
const MAX_TOKEN_LENGTH = 4096;

/**
 * Verifies Better Auth API tokens (ADR-0003): EdDSA signature via the web app's JWKS (cached
 * 10 min, refetched on an unknown `kid`), `iss`, `aud`, `exp`, `nbf` with 60 s tolerance.
 * Stateless — no database or session lookup.
 */
@Injectable()
export class JwtVerifierService {
  private readonly logger = new Logger(JwtVerifierService.name);
  private readonly jwks: JWTVerifyGetKey;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(config: ConfigService<Env, true>) {
    this.issuer = config.get('AUTH_JWT_ISSUER', { infer: true });
    this.audience = config.get('AUTH_JWT_AUDIENCE', { infer: true });
    this.jwks = createRemoteJWKSet(new URL(config.get('AUTH_JWKS_URL', { infer: true })), {
      cacheMaxAge: JWKS_CACHE_MS,
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    });
  }

  async verify(token: string): Promise<AuthUser> {
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      throw AppException.unauthenticated('Invalid access token');
    }
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['EdDSA'],
        clockTolerance: CLOCK_TOLERANCE_S,
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 64) {
        throw AppException.unauthenticated('Invalid access token');
      }
      return { id: payload.sub };
    } catch (error) {
      if (error instanceof AppException) throw error;
      if (error instanceof errors.JWTExpired) {
        throw AppException.unauthenticated('Access token expired');
      }
      if (error instanceof errors.JWKSTimeout || isFetchFailure(error)) {
        // The web app (JWKS host) is unreachable: we cannot verify, so we must not trust.
        this.logger.error({ err: error }, 'JWKS unavailable; rejecting token');
      }
      throw AppException.unauthenticated('Invalid access token');
    }
  }
}

function isFetchFailure(error: unknown): boolean {
  return error instanceof TypeError && /fetch/i.test(error.message);
}
