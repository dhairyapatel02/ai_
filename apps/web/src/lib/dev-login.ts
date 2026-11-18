'use client';

/**
 * `POST /api/dev-login` (same origin; 404 in production builds) — development/E2E only (F-02).
 * Lives in lib because components never call fetch directly.
 */
export async function devLogin(
  email?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- same-origin route handler, not the API
    const res = await fetch('/api/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(email ? { email } : {}),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, message: body.error?.message ?? `Request failed (${res.status})` };
  } catch {
    return { ok: false, message: 'The web server did not respond.' };
  }
}
