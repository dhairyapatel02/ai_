import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { AppException } from '../common/app-exception';
import { REDIS_CLIENT } from '../redis/redis.module';

import type { Env } from '../config/env';

export const STATE_TTL_SECONDS = 600;

export interface OAuthStatePayload {
  /** User the flow was started by; the callback must be made by the same user. */
  u: string;
  /** Single-use nonce (Redis key). */
  n: string;
  /** Expiry, unix seconds. */
  e: number;
  /** Where the web app returns after the callback. */
  r?: string;
  /** Integration being reconnected, if any. */
  i?: string;
  /** 1 when the authorize URL carried a PKCE challenge (send the verifier on exchange). */
  p?: 1;
  /** Provider the flow belongs to (P13): a state minted for one provider is invalid for another. */
  k?: 'gitlab' | 'jira' | 'linear';
  /** Self-managed GitLab origin chosen at connect (allow-listed). */
  b?: string;
}

export interface IssuedState {
  state: string;
  expiresAt: Date;
  /** PKCE S256 challenge (authorize mode). */
  codeChallenge: string;
}

export interface ConsumedState {
  payload: OAuthStatePayload;
  codeVerifier: string;
}

/**
 * Signed, expiring, single-use OAuth `state` bound to the user (ADR-0004 §4, SEC-04):
 * `base64url(JSON payload) "." base64url(HMAC-SHA256)` with `OAUTH_STATE_SECRET`; the nonce and
 * the PKCE verifier live in Redis for 10 minutes and are deleted on first use.
 */
@Injectable()
export class OAuthStateService {
  private readonly secret: string;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.secret = config.get('OAUTH_STATE_SECRET', { infer: true });
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  async issue(
    userId: string,
    extra: {
      returnTo?: string;
      integrationId?: string;
      pkce?: boolean;
      provider?: OAuthStatePayload['k'];
      baseUrl?: string;
    } = {},
    now = Date.now(),
  ): Promise<IssuedState> {
    const nonce = randomBytes(18).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const exp = Math.floor(now / 1000) + STATE_TTL_SECONDS;
    const payload: OAuthStatePayload = {
      u: userId,
      n: nonce,
      e: exp,
      ...(extra.returnTo ? { r: extra.returnTo } : {}),
      ...(extra.integrationId ? { i: extra.integrationId } : {}),
      ...(extra.pkce ? { p: 1 as const } : {}),
      ...(extra.provider ? { k: extra.provider } : {}),
      ...(extra.baseUrl ? { b: extra.baseUrl } : {}),
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    await this.redis.set(`oauth-state:${nonce}`, codeVerifier, 'EX', STATE_TTL_SECONDS);
    return {
      state: `${body}.${this.sign(body)}`,
      expiresAt: new Date(exp * 1000),
      codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    };
  }

  /** Verifies signature, expiry and user binding, then burns the nonce. Throws OAUTH_STATE_INVALID. */
  async consume(state: string, userId: string, now = Date.now()): Promise<ConsumedState> {
    const invalid = () =>
      new AppException(
        'OAUTH_STATE_INVALID',
        'This connection link is invalid or has expired. Please start again.',
      );
    const [body, signature, ...rest] = state.split('.');
    if (!body || !signature || rest.length > 0) throw invalid();

    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();

    let payload: OAuthStatePayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
    } catch {
      throw invalid();
    }
    if (
      typeof payload.u !== 'string' ||
      typeof payload.n !== 'string' ||
      typeof payload.e !== 'number'
    ) {
      throw invalid();
    }
    if (payload.e * 1000 <= now || payload.u !== userId) throw invalid();

    // GETDEL makes the nonce single-use even under concurrent callbacks.
    const codeVerifier = await this.redis.getdel(`oauth-state:${payload.n}`);
    if (!codeVerifier) throw invalid();
    return { payload, codeVerifier };
  }
}
