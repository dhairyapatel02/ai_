import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { jwt } from 'better-auth/plugins';

import { getServerEnv, isDevLoginEnabled } from '@/env';

import { getPrisma } from './prisma';

const DAY = 60 * 60 * 24;

function createAuth() {
  const env = getServerEnv();
  const prisma = getPrisma();
  const devLogin = isDevLoginEnabled();

  return betterAuth({
    appName: 'DevImpact AI',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.WEB_ORIGINS,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    // Sign-in identities only (ADR-0004): GitHub OAuth App + Google, identity scopes.
    socialProviders: {
      ...(env.github ? { github: { ...env.github, scope: ['read:user', 'user:email'] } } : {}),
      ...(env.google ? { google: { ...env.google, scope: ['openid', 'email', 'profile'] } } : {}),
    },
    // Email/password exists only to back the dev login (never in production, no sign-up).
    emailAndPassword: { enabled: devLogin, disableSignUp: true },

    account: {
      encryptOAuthTokens: true,
      // Same verified email across GitHub/Google → one user; also links legacy v0.1 users.
      accountLinking: { enabled: true, trustedProviders: ['github', 'google'] },
    },
    session: { expiresIn: 30 * DAY, updateAge: DAY },
    user: {
      additionalFields: {
        plan: { type: 'string', input: false, defaultValue: 'FREE', required: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await prisma.userSettings.upsert({
              where: { userId: user.id },
              update: {},
              create: { userId: user.id },
            });
          },
        },
      },
    },
    advanced: {
      // Ids come from Prisma (`@default(cuid())`), like every other table.
      database: { generateId: false },
      useSecureCookies: env.NODE_ENV === 'production',
    },
    plugins: [
      // Short-lived EdDSA API tokens verified by NestJS via /api/auth/jwks (ADR-0003).
      jwt({
        jwks: { keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' } },
        jwt: {
          issuer: env.AUTH_JWT_ISSUER,
          audience: env.AUTH_JWT_AUDIENCE,
          expirationTime: '15m',
          // Only the subject: the API loads everything else itself.
          definePayload: () => ({}),
        },
      }),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { devimpactAuth?: Auth };

/** Lazily created Better Auth instance (env is read at request time, not at build time). */
export function getAuth(): Auth {
  globalForAuth.devimpactAuth ??= createAuth();
  return globalForAuth.devimpactAuth;
}
