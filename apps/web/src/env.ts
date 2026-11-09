import { z } from 'zod';

const emptyToUndefined = (value: string | undefined) => (value === '' ? undefined : value);

/**
 * Browser-safe configuration. `NEXT_PUBLIC_*` values are inlined at build time, so each one must
 * be referenced literally (`process.env.NEXT_PUBLIC_X`) for Next.js to replace it.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url().default('http://localhost:4000/api'),
  // Dev-only: email the auto dev-login uses (e.g. the seeded demo@devimpact.dev). Removed with
  // dev-login itself in P05 (D-003).
  NEXT_PUBLIC_DEV_LOGIN_EMAIL: z.email().optional(),
});

/** Server-only configuration (route handlers / server components). Never import from client code. */
const serverEnvSchema = z.object({
  NEXTAUTH_SECRET: z.string().optional(),
  NEXTAUTH_URL: z.url().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

function formatIssues(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

export function parsePublicEnv(raw: Record<string, string | undefined>) {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_API_URL: emptyToUndefined(raw.NEXT_PUBLIC_API_URL),
    NEXT_PUBLIC_DEV_LOGIN_EMAIL: emptyToUndefined(raw.NEXT_PUBLIC_DEV_LOGIN_EMAIL),
  });
  if (!result.success) {
    throw new Error(`Invalid web environment configuration: ${formatIssues(result.error)}`);
  }
  return result.data;
}

export const publicEnv = parsePublicEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_DEV_LOGIN_EMAIL: process.env.NEXT_PUBLIC_DEV_LOGIN_EMAIL,
});

export function getServerEnv() {
  const raw = Object.fromEntries(
    Object.keys(serverEnvSchema.shape).map((key) => [key, emptyToUndefined(process.env[key])]),
  );
  const result = serverEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid web server environment configuration: ${formatIssues(result.error)}`);
  }
  return result.data;
}
