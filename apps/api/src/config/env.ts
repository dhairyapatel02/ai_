import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

/**
 * Single source of truth for API/worker configuration (OPS-10, GAP-09).
 * Every variable is documented in the root `.env.example`.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // HTTP port for the API. `PORT` is accepted as a fallback for PaaS hosts (OPS-08).
    API_PORT: z.coerce.number().int().positive().optional(),
    PORT: z.coerce.number().int().positive().optional(),

    DATABASE_URL: z
      .string({ error: 'DATABASE_URL is required (postgresql://user:pass@host:5432/db)' })
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgresql:// connection string'),
    REDIS_URL: z
      .string({ error: 'REDIS_URL is required (redis://host:6379)' })
      .regex(/^rediss?:\/\//, 'REDIS_URL must be a redis:// or rediss:// URL'),

    // Public URL of the web app: CORS origin and base of the GitHub OAuth redirect.
    // NEXTAUTH_URL is accepted as a legacy fallback.
    WEB_URL: z.url().optional(),
    NEXTAUTH_URL: z.url().optional(),

    // When true (local default) the API process also consumes BullMQ queues.
    // Docker Compose sets it to false and runs `node dist/worker.js` separately.
    RUN_WORKER_IN_API: booleanString.default(true),
    // Worker liveness file touched every few seconds (used by the compose healthcheck).
    WORKER_HEARTBEAT_FILE: optionalString,

    // Optional so the app can be developed with seed data only. AI calls fail without it.
    ANTHROPIC_API_KEY: optionalString,
    ANTHROPIC_BASE_URL: z.url().optional(),

    // Optional: only needed to connect a real GitHub account.
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,
  })
  .transform((env) => ({
    ...env,
    API_PORT: env.API_PORT ?? env.PORT ?? 4000,
    WEB_URL: env.WEB_URL ?? env.NEXTAUTH_URL ?? 'http://localhost:3000',
  }));

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}\n` +
        'See .env.example for every supported variable.',
    );
    this.name = 'EnvValidationError';
  }
}

/** Parses and validates configuration. Throws `EnvValidationError` with readable messages. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => {
        const key = issue.path.join('.') || '(root)';
        return `${key}: ${issue.message}`;
      }),
    );
  }
  return result.data;
}
