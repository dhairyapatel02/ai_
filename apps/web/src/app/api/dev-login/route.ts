import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { getServerEnv, isDevLoginEnabled } from '@/env';

export const dynamic = 'force-dynamic';

const DEFAULT_EMAIL = 'demo@devimpact.dev';
const Body = z.strictObject({ email: z.email().max(254).optional() });

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const notFound = () =>
  json(404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });

/**
 * `POST /api/dev-login { email? }` — development/E2E sign-in as an existing (seeded) user
 * (ADR-0003, F-02). Returns 404 unless NODE_ENV !== 'production' && ENABLE_DEV_LOGIN === 'true';
 * in a production build `isDevLoginEnabled()` is the constant `false`. Never creates users.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isDevLoginEnabled()) return notFound();
  return devLogin(request);
}

async function devLogin(request: Request): Promise<Response> {
  const env = getServerEnv();

  // Same-origin only (the session cookie is set for this origin).
  const origin = request.headers.get('origin');
  if (origin && !env.WEB_ORIGINS.includes(origin.replace(/\/+$/, ''))) {
    return json(403, {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Cross-origin dev login refused' },
    });
  }

  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return json(400, {
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'Malformed JSON body' },
    });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json(400, {
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'Invalid email' },
    });
  }
  const email = (parsed.data.email ?? DEFAULT_EMAIL).toLowerCase();

  const [{ getAuth }, { getPrisma }, { hashPassword }] = await Promise.all([
    import('@/lib/auth'),
    import('@/lib/prisma'),
    import('better-auth/crypto'),
  ]);
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    return json(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: `No user ${email}. Run \`npm run db:seed\` first.` },
    });
  }

  // A fresh random password per dev login: the credential account can't be used any other way.
  const password = randomBytes(24).toString('base64url');
  const hash = await hashPassword(password);
  await prisma.account.upsert({
    where: { providerId_accountId: { providerId: 'credential', accountId: user.id } },
    update: { password: hash },
    create: { providerId: 'credential', accountId: user.id, userId: user.id, password: hash },
  });

  const auth = getAuth();
  const signedIn = await auth.api.signInEmail({
    body: { email, password, rememberMe: true },
    headers: request.headers,
    asResponse: true,
  });
  if (!signedIn.ok) {
    return json(signedIn.status, {
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Dev login failed' },
    });
  }
  // Forward only the session cookie; never echo the session token in the body.
  const response = json(200, { success: true, data: { user: { id: user.id, email } } });
  for (const cookie of signedIn.headers.getSetCookie())
    response.headers.append('set-cookie', cookie);
  return response;
}
