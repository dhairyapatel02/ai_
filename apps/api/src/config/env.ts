import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

/**
 * Example secrets shipped in `.env.example`. They make local setup work out of the box and are
 * rejected when NODE_ENV=production.
 */
export const EXAMPLE_SECRETS = new Set([
  '1:ZGV2LW9ubHktdG9rZW4ta2V5LWRvLW5vdC11c2UtISE=',
  'dev-only-oauth-state-secret-change-me-0123456789',
]);

const webUrlList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })).min(1));

/** `TOKEN_ENCRYPTION_KEYS="1:<base64 32 bytes>,2:<base64 32 bytes>"` (ADR-0005). */
const tokenKeyList = z.string().transform((value, ctx) => {
  const keys = new Map<number, Buffer>();
  for (const entry of value
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)) {
    const match = /^(\d{1,4}):([A-Za-z0-9+/=_-]+)$/.exec(entry);
    if (!match) {
      ctx.addIssue({ code: 'custom', message: 'entries must look like "<version>:<base64 key>"' });
      return z.NEVER;
    }
    const version = Number(match[1]);
    const key = Buffer.from(match[2] ?? '', 'base64');
    if (key.length !== 32) {
      ctx.addIssue({ code: 'custom', message: `key ${version} must decode to exactly 32 bytes` });
      return z.NEVER;
    }
    if (keys.has(version)) {
      ctx.addIssue({ code: 'custom', message: `key version ${version} is listed twice` });
      return z.NEVER;
    }
    keys.set(version, key);
  }
  if (keys.size === 0) {
    ctx.addIssue({ code: 'custom', message: 'at least one key is required' });
    return z.NEVER;
  }
  return keys;
});

/**
 * Single source of truth for API/worker configuration (OPS-10, GAP-09).
 * Every variable is documented in the root `.env.example`.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

    // HTTP port for the API. `PORT` is accepted as a fallback for PaaS hosts (OPS-08).
    API_PORT: z.coerce.number().int().positive().optional(),
    PORT: z.coerce.number().int().positive().optional(),

    DATABASE_URL: z
      .string({ error: 'DATABASE_URL is required (postgresql://user:pass@host:5432/db)' })
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgresql:// connection string'),
    REDIS_URL: z
      .string({ error: 'REDIS_URL is required (redis://host:6379)' })
      .regex(/^rediss?:\/\//, 'REDIS_URL must be a redis:// or rediss:// URL'),

    // Public URL(s) of the web app, comma-separated. All entries form the CORS allow-list; the
    // first one is the redirect base (GitHub callback) and the default JWT issuer.
    WEB_URL: webUrlList.default(['http://localhost:3000']),

    // JWT verification (ADR-0003). Defaults derive from the first WEB_URL.
    AUTH_JWT_ISSUER: z.url().optional(),
    AUTH_JWT_AUDIENCE: z.string().min(1).default('devimpact-api'),
    AUTH_JWKS_URL: z.url().optional(),

    // When true (local default) the API process also consumes BullMQ queues.
    // Docker Compose sets it to false and runs `node dist/worker.js` separately.
    RUN_WORKER_IN_API: booleanString.default(true),
    // BullMQ key prefix. Defaults to "devimpact", or "devimpact-test" when NODE_ENV=test, so test
    // runs never feed a local dev worker (OPS-17).
    QUEUE_PREFIX: optionalString,
    // Sync pauses (WAITING_RATE_LIMIT) when GitHub's remaining budget drops below this (ADR-0007).
    SYNC_RATE_LIMIT_MIN_REMAINING: z.coerce.number().int().min(0).default(200),
    // Worker liveness file touched every few seconds (used by the compose healthcheck).
    WORKER_HEARTBEAT_FILE: optionalString,

    // Optional so the app can be developed with seed data only. AI calls fail without it.
    ANTHROPIC_API_KEY: optionalString,
    ANTHROPIC_BASE_URL: z.url().optional(),

    // GitHub App (data source, ADR-0004). Optional so the app runs on seed data; connect fails
    // with a clear error until they are set.
    GITHUB_APP_ID: optionalString,
    GITHUB_APP_SLUG: optionalString,
    GITHUB_APP_CLIENT_ID: optionalString,
    GITHUB_APP_CLIENT_SECRET: optionalString,
    // App private key (installation tokens): PEM (raw, `\n`-escaped or base64) or a mounted file.
    GITHUB_APP_PRIVATE_KEY: optionalString,
    GITHUB_APP_PRIVATE_KEY_FILE: optionalString,
    // HMAC secret of the App webhook (`POST /api/webhooks/github`); deliveries are rejected without it.
    GITHUB_WEBHOOK_SECRET: optionalString,
    // Retries for transient GitHub errors (5xx, network) inside one request (plugin-retry).
    GITHUB_REQUEST_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
    // @octokit/plugin-throttling request pacing (1 s between POSTs per token). Tests turn it off.
    GITHUB_THROTTLING: booleanString.default(true),
    // github.com (OAuth endpoints) and REST API base; overridable for tests/GHES.
    GITHUB_WEB_URL: z.url().default('https://github.com'),
    GITHUB_API_URL: z.url().default('https://api.github.com'),

    // Token encryption at rest (ADR-0005).
    TOKEN_ENCRYPTION_KEYS: tokenKeyList,
    TOKEN_ENCRYPTION_ACTIVE_KEY: z.coerce.number().int().nonnegative(),
    // HMAC secret for the GitHub connect `state` parameter.
    OAUTH_STATE_SECRET: z.string().min(32, 'OAUTH_STATE_SECRET must be at least 32 characters'),
  })
  .superRefine((env, ctx) => {
    if (!env.TOKEN_ENCRYPTION_KEYS.has(env.TOKEN_ENCRYPTION_ACTIVE_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['TOKEN_ENCRYPTION_ACTIVE_KEY'],
        message: 'must name a version listed in TOKEN_ENCRYPTION_KEYS',
      });
    }
  })
  .transform((env) => {
    const webUrl = env.WEB_URL[0] ?? 'http://localhost:3000';
    return {
      ...env,
      API_PORT: env.API_PORT ?? env.PORT ?? 4000,
      WEB_URL: webUrl,
      WEB_ORIGINS: env.WEB_URL,
      AUTH_JWT_ISSUER: env.AUTH_JWT_ISSUER ?? webUrl,
      AUTH_JWKS_URL: env.AUTH_JWKS_URL ?? `${webUrl}/api/auth/jwks`,
      LOG_LEVEL: env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info'),
      QUEUE_PREFIX: env.QUEUE_PREFIX ?? (env.NODE_ENV === 'test' ? 'devimpact-test' : 'devimpact'),
    };
  });

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
  const env = result.data;
  if (env.NODE_ENV === 'production') {
    const raw_ = raw as Record<string, string | undefined>;
    const leaked = ['TOKEN_ENCRYPTION_KEYS', 'OAUTH_STATE_SECRET'].filter((key) =>
      (raw_[key] ?? '').split(',').some((part) => EXAMPLE_SECRETS.has(part.trim())),
    );
    if (leaked.length > 0) {
      throw new EnvValidationError(
        leaked.map(
          (key) => `${key}: the example value from .env.example must not be used in production`,
        ),
      );
    }
  }
  return env;
}
