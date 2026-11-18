import { z } from 'zod';

const emptyToUndefined = (value: string | undefined) => (value === '' ? undefined : value);

/**
 * Browser-safe configuration. `NEXT_PUBLIC_*` values are inlined at build time, so each one must
 * be referenced literally (`process.env.NEXT_PUBLIC_X`) for Next.js to replace it.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url().default('http://localhost:4000/api'),
});

/** Example secret from `.env.example`; refused in production. */
export const EXAMPLE_AUTH_SECRET = 'dev-only-better-auth-secret-change-me-0123456789';

/** Server-only configuration (route handlers / server components). Never import from client code. */
const serverEnvObject = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required (Better Auth stores sessions in Postgres)' })
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgresql:// connection string'),
  // Public URL(s) of this app; the first entry is the canonical one.
  WEB_URL: z.string().default('http://localhost:3000'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.url().optional(),
  AUTH_JWT_ISSUER: z.url().optional(),
  AUTH_JWT_AUDIENCE: z.string().min(1).default('devimpact-api'),
  GITHUB_SIGNIN_CLIENT_ID: z.string().optional(),
  GITHUB_SIGNIN_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ENABLE_DEV_LOGIN: z.enum(['true', 'false']).optional(),
  // Server-side calls to the API (Server Components). Defaults to NEXT_PUBLIC_API_URL; set it when
  // the server reaches the API on another address than the browser (Docker: http://api:4000/api).
  API_INTERNAL_URL: z.url().optional(),
  NEXT_PUBLIC_API_URL: z.url().default('http://localhost:4000/api'),
});

const serverEnvSchema = serverEnvObject.transform((env) => {
  const origins = env.WEB_URL.split(',')
    .map((u) => u.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const webUrl = origins[0] ?? 'http://localhost:3000';
  return {
    ...env,
    WEB_URL: webUrl,
    WEB_ORIGINS: origins,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? webUrl,
    AUTH_JWT_ISSUER: env.AUTH_JWT_ISSUER ?? webUrl,
    API_INTERNAL_URL: (env.API_INTERNAL_URL ?? env.NEXT_PUBLIC_API_URL).replace(/\/+$/, ''),
    github:
      env.GITHUB_SIGNIN_CLIENT_ID && env.GITHUB_SIGNIN_CLIENT_SECRET
        ? { clientId: env.GITHUB_SIGNIN_CLIENT_ID, clientSecret: env.GITHUB_SIGNIN_CLIENT_SECRET }
        : undefined,
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : undefined,
  };
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function formatIssues(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

export function parsePublicEnv(raw: Record<string, string | undefined>) {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_API_URL: emptyToUndefined(raw.NEXT_PUBLIC_API_URL),
  });
  if (!result.success) {
    throw new Error(`Invalid web environment configuration: ${formatIssues(result.error)}`);
  }
  return result.data;
}

export const publicEnv = parsePublicEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});

export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const input = Object.fromEntries(
    Object.keys(serverEnvObject.shape).map((key) => [key, emptyToUndefined(raw[key])]),
  );
  const result = serverEnvSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid web server environment configuration: ${formatIssues(result.error)}`);
  }
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.BETTER_AUTH_SECRET === EXAMPLE_AUTH_SECRET
  ) {
    throw new Error(
      'Invalid web server environment configuration: BETTER_AUTH_SECRET must not be the .env.example value in production',
    );
  }
  return result.data;
}

let cached: ServerEnv | undefined;
/** Validated server env (cached). Called lazily so `next build` doesn't need runtime secrets. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/**
 * Dev login (ADR-0003): only when NODE_ENV is not production AND ENABLE_DEV_LOGIN=true.
 * `process.env.NODE_ENV` is inlined by Next.js at build time, so in a production build this is
 * the constant `false` and the dev-login code path is dead.
 */
export function isDevLoginEnabled(raw: Record<string, string | undefined> = process.env): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return raw.NODE_ENV !== 'production' && raw.ENABLE_DEV_LOGIN === 'true';
}
