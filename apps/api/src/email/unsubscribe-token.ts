import { createHmac, timingSafeEqual } from 'node:crypto';

import type { UnsubscribeList } from '@devimpact/shared';

/**
 * Signed unsubscribe tokens (API_CONTRACT_V2 §17): `base64url(JSON{ u, l, e })` + "." +
 * `base64url(HMAC-SHA256(secret, "unsub.v1." + payload))`. Stateless and idempotent — replaying a
 * valid token only repeats the same opt-out. The secret is dedicated (`UNSUBSCRIBE_TOKEN_SECRET`).
 */
export interface UnsubscribeClaims {
  userId: string;
  list: UnsubscribeList;
  /** Expiry, epoch seconds. */
  exp: number;
}

const DOMAIN = 'unsub.v1.';

function sign(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret)
    .update(DOMAIN + payload)
    .digest();
}

export function createUnsubscribeToken(
  secret: string,
  claims: { userId: string; list: UnsubscribeList },
  ttlDays: number,
  now = new Date(),
): string {
  const exp = Math.floor(now.getTime() / 1000) + ttlDays * 86_400;
  const payload = Buffer.from(
    JSON.stringify({ u: claims.userId, l: claims.list, e: exp }),
  ).toString('base64url');
  return `${payload}.${sign(secret, payload).toString('base64url')}`;
}

export type VerifyResult =
  { ok: true; claims: UnsubscribeClaims } | { ok: false; reason: 'invalid' | 'expired' };

export function verifyUnsubscribeToken(
  secret: string,
  token: string,
  now = new Date(),
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'invalid' };
  const [payload, signature] = parts;
  const expected = sign(secret, payload);
  const given = Buffer.from(signature, 'base64url');
  // Constant-time comparison (lengths are public: SHA-256 output is always 32 bytes).
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'invalid' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const c = raw as { u?: unknown; l?: unknown; e?: unknown };
  if (
    typeof c.u !== 'string' ||
    !/^c[0-9a-z]{20,31}$/.test(c.u) ||
    (c.l !== 'digest' && c.l !== 'all') ||
    typeof c.e !== 'number' ||
    !Number.isInteger(c.e)
  ) {
    return { ok: false, reason: 'invalid' };
  }
  if (c.e * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, claims: { userId: c.u, list: c.l, exp: c.e } };
}
