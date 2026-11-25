import { z } from 'zod';

import { parseEntitlementsOverride } from '../entitlements/entitlements';
import { parseGitLabInstances } from '../providers/gitlab/instances';
import { loadModelPrices } from './ai-pricing';

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
  'dev-only-unsubscribe-secret-change-me-0123456789',
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
    // Requests per minute per user for the `default` rate-limit class (API_CONTRACT_V2 §1.1).
    // Raised only for the E2E API server, whose axe loops visit every page in four contexts.
    RATE_LIMIT_DEFAULT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_EXPORT_PER_HOUR: z.coerce.number().int().min(1).default(30),
    // `GET /me/export` (full data export) per user per day — 3 by contract; E2E raises it.
    RATE_LIMIT_DATA_EXPORT_PER_DAY: z.coerce.number().int().min(1).default(3),
    // Sync pauses (WAITING_RATE_LIMIT) when GitHub's remaining budget drops below this (ADR-0007).
    SYNC_RATE_LIMIT_MIN_REMAINING: z.coerce.number().int().min(0).default(200),
    // Worker liveness file touched every few seconds (used by the compose healthcheck).
    WORKER_HEARTBEAT_FILE: optionalString,

    // ── AI (ADR-0009). Optional so the app runs on seed data; without a key, generation
    // requests fail with 503 UPSTREAM_UNAVAILABLE { reason: 'not_configured' }.
    ANTHROPIC_API_KEY: optionalString,
    // Override the API base URL (test mode: an in-process fake or a local mock server, OPS-15).
    ANTHROPIC_BASE_URL: z.url().optional(),
    // Model ids live ONLY here (never in services): documents/highlights tier and fast tier.
    ANTHROPIC_MODEL_DEFAULT: z.string().min(1).default('claude-opus-5-5'),
    ANTHROPIC_MODEL_FAST: z.string().min(1).default('claude-haiku-5-5'),
    // Server-side refusal fallback (beta `server-side-fallback-2026-07-01`) on the default tier.
    AI_FALLBACKS_ENABLED: booleanString.default(true),
    // Thinking depth (`output_config.effort`) per tier.
    AI_EFFORT_DEFAULT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
    AI_EFFORT_FAST: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),
    // Per-attempt timeout of a document generation / a quick action (ms).
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(180_000),
    AI_QUICK_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20_000),
    // Retries for retryable Anthropic errors (429, 5xx, overloaded, connection) with backoff+jitter.
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_RETRY_BASE_MS: z.coerce.number().int().min(0).default(1_000),
    // Concurrent `ai` jobs per worker process (caps spend and Anthropic concurrency).
    AI_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    // Retention of document event streams in Redis (SSE resume window).
    AI_STREAM_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
    // Optional JSON overrides: plan limits (PRD §6) and the price table (US$ per 1M tokens).
    // e.g. ENTITLEMENTS_JSON='{"FREE":{"aiGenerationsPerMonth":30}}'
    //      AI_PRICES_JSON='{"my-model":{"input":3,"output":15,"cacheRead":0.3,"cacheWrite":3.75}}'
    ENTITLEMENTS_JSON: optionalString,
    AI_PRICES_JSON: optionalString,

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

    // ── GitLab / Jira / Linear (P13, D-030). All optional: a provider is offered on S19 only when
    // its client id + secret are set. Base URLs are overridable for tests and self-managed GitLab.
    // GitLab OAuth application (scopes `read_api read_user`): gitlab.com or one self-managed origin.
    GITLAB_URL: z.url({ protocol: /^https?$/ }).default('https://gitlab.com'),
    GITLAB_CLIENT_ID: optionalString,
    GITLAB_CLIENT_SECRET: optionalString,
    // Extra self-managed instances: JSON [{ "url": "https://gitlab.example.com", "clientId": "…",
    // "clientSecret": "…", "label": "Example GitLab" }]. The connect `baseUrl` must be one of them.
    GITLAB_INSTANCES_JSON: optionalString,
    // `X-Gitlab-Token` secret of project/group webhooks (`POST /api/webhooks/gitlab`).
    GITLAB_WEBHOOK_SECRET: optionalString,
    // Atlassian OAuth 2.0 (3LO) app for Jira Cloud (scopes `read:jira-work read:jira-user offline_access`).
    JIRA_CLIENT_ID: optionalString,
    JIRA_CLIENT_SECRET: optionalString,
    JIRA_AUTH_URL: z.url().default('https://auth.atlassian.com'),
    JIRA_API_URL: z.url().default('https://api.atlassian.com'),
    // Secret of Jira Cloud admin webhooks (`X-Hub-Signature: sha256=…`); optional — polling otherwise.
    JIRA_WEBHOOK_SECRET: optionalString,
    // Linear OAuth application (scope `read`, PKCE).
    LINEAR_CLIENT_ID: optionalString,
    LINEAR_CLIENT_SECRET: optionalString,
    LINEAR_WEB_URL: z.url().default('https://linear.app'),
    LINEAR_API_URL: z.url().default('https://api.linear.app'),
    // Signing secret of the Linear OAuth app webhook (`Linear-Signature`, HMAC-SHA256 hex).
    LINEAR_WEBHOOK_SECRET: optionalString,
    // Per-request timeout + transient retries for GitLab / Jira / Linear calls.
    PROVIDER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    PROVIDER_REQUEST_RETRIES: z.coerce.number().int().min(0).max(10).default(2),

    // ── Email (P12, ARCHITECTURE_V2 §2/§10). `console` logs messages (dev default), `memory` keeps
    // them in-process (tests only), `smtp` uses SMTP_URL (nodemailer), `resend` the Resend HTTP API.
    EMAIL_TRANSPORT: z.enum(['console', 'memory', 'smtp', 'resend']).default('console'),
    EMAIL_FROM: z.string().min(3).max(200).default('DevImpact <digest@devimpact.local>'),
    SMTP_URL: z
      .string()
      .regex(/^smtps?:\/\//, 'SMTP_URL must be an smtp:// or smtps:// URL')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    RESEND_API_KEY: optionalString,
    RESEND_API_URL: z.url({ protocol: /^https?$/ }).default('https://api.resend.com'),
    // Weekly digest fan-out (hourly scheduler). Off = no digests are enqueued.
    DIGEST_ENABLED: booleanString.default(true),
    // HMAC secret for unsubscribe links (`POST /api/notifications/unsubscribe`, no login).
    UNSUBSCRIBE_TOKEN_SECRET: z
      .string()
      .min(32, 'UNSUBSCRIBE_TOKEN_SECRET must be at least 32 characters')
      .default('dev-only-unsubscribe-secret-change-me-0123456789'),
    UNSUBSCRIBE_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(60),

    // Token encryption at rest (ADR-0005).
    TOKEN_ENCRYPTION_KEYS: tokenKeyList,
    TOKEN_ENCRYPTION_ACTIVE_KEY: z.coerce.number().int().nonnegative(),
    // HMAC secret for the GitHub connect `state` parameter.
    OAUTH_STATE_SECRET: z.string().min(32, 'OAUTH_STATE_SECRET must be at least 32 characters'),
  })
  .superRefine((env, ctx) => {
    const entitlements = parseEntitlementsOverride(env.ENTITLEMENTS_JSON);
    if (!entitlements.ok) {
      ctx.addIssue({ code: 'custom', path: ['ENTITLEMENTS_JSON'], message: entitlements.error });
    }
    try {
      loadModelPrices(env.AI_PRICES_JSON);
    } catch (error) {
      ctx.addIssue({ code: 'custom', path: ['AI_PRICES_JSON'], message: (error as Error).message });
    }
    const gitlab = parseGitLabInstances(env.GITLAB_INSTANCES_JSON);
    if (!gitlab.ok) {
      ctx.addIssue({ code: 'custom', path: ['GITLAB_INSTANCES_JSON'], message: gitlab.error });
    }
    if (env.EMAIL_TRANSPORT === 'smtp' && !env.SMTP_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message: 'is required when EMAIL_TRANSPORT=smtp',
      });
    }
    if (env.EMAIL_TRANSPORT === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'is required when EMAIL_TRANSPORT=resend',
      });
    }
    if (env.NODE_ENV === 'production' && env.EMAIL_TRANSPORT === 'memory') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_TRANSPORT'],
        message: '"memory" is for tests only; use smtp or resend in production',
      });
    }
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
    const leaked = [
      'TOKEN_ENCRYPTION_KEYS',
      'OAUTH_STATE_SECRET',
      'UNSUBSCRIBE_TOKEN_SECRET',
    ].filter((key) =>
      key === 'UNSUBSCRIBE_TOKEN_SECRET'
        ? EXAMPLE_SECRETS.has(env.UNSUBSCRIBE_TOKEN_SECRET)
        : (raw_[key] ?? '').split(',').some((part) => EXAMPLE_SECRETS.has(part.trim())),
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
