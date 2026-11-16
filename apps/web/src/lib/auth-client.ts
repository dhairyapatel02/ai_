import { jwtClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Browser Better Auth client (same origin: `/api/auth/*`). */
export const authClient = createAuthClient({ plugins: [jwtClient()] });

interface CachedToken {
  token: string;
  /** Unix ms. */
  expiresAt: number;
}

let cached: CachedToken | null = null;
let inflight: Promise<string | null> | null = null;

const REFRESH_MARGIN_MS = 60_000;

function expiryOf(token: string): number {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/') ?? ''),
    ) as {
      exp?: number;
    };
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

/**
 * Short-lived API JWT from `GET /api/auth/token`, cached in memory (never localStorage) until 60 s
 * before expiry (ADR-0003 / ADR-0010). Returns null when there is no session.
 */
export async function getApiToken(
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  if (!options.forceRefresh && cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return cached.token;
  }
  inflight ??= (async () => {
    try {
      const res = await fetch('/api/auth/token', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) {
        cached = null;
        return null;
      }
      const body = (await res.json()) as { token?: string };
      if (!body.token) return null;
      cached = { token: body.token, expiresAt: expiryOf(body.token) };
      return body.token;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function clearApiToken(): void {
  cached = null;
}
