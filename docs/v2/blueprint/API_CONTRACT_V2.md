# API Contract v2

*Phase 03 · 2026-11-09 · Status: **binding**. Implemented incrementally by P05–P12. Every schema
named here lives in `packages/shared/src/schemas/` (Zod) and is used by the API validation pipe,
the OpenAPI generator and the web client. Additive changes (new optional fields, new endpoints)
are allowed with a PROGRESS.md note; breaking changes need a DECISIONS.md entry.*

Related: [ADR-0006 API conventions](adr/ADR-0006-api-conventions.md) ·
[DATA_MODEL_V2](DATA_MODEL_V2.md) · [KPI_METHODOLOGY](KPI_METHODOLOGY.md) · [PRD](PRD.md)

## Contents
1. [Conventions](#1-conventions) · 2. [Error codes](#2-error-codes) · 3. [Shared schemas](#3-shared-schemas)
4. [Auth (web)](#4-auth-web-better-auth) · 5. [Me & settings](#5-me--settings) · 6. [Integrations](#6-integrations)
7. [Repositories](#7-repositories) · 8. [Sync](#8-sync) · 9. [Metrics](#9-metrics) · 10. [Impact](#10-impact)
11. [Activity](#11-activity) · 12. [Career](#12-career) · 13. [Documents & generation](#13-documents--generation)
14. [AI utilities](#14-ai-utilities) · 15. [Achievements](#15-achievements) · 16. [Goals](#16-goals)
17. [Notifications](#17-notifications) · 18. [Webhooks](#18-webhooks) · 19. [Health, docs, admin](#19-health-docs-admin)
20. [v1 → v2 endpoint disposition](#20-v1--v2-endpoint-disposition) · 21. [PRD coverage check](#21-prd-coverage-check)

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | API: `NEXT_PUBLIC_API_URL` (e.g. `http://localhost:4000/api`). Auth endpoints live on the **web** origin under `/api/auth/*` (Better Auth). |
| Auth | `Authorization: Bearer <JWT>` issued by Better Auth (`iss = AUTH_JWT_ISSUER`, `aud = devimpact-api`, `sub = userId`, `exp ≤ 15 min`, EdDSA). Routes are authenticated by default; `@Public()` marks exceptions (health, webhooks, unsubscribe, OpenAPI in non-prod). |
| Content type | `application/json; charset=utf-8` unless stated (exports, SSE, webhooks raw body). Max JSON body **256 KB** (413 above). |
| Envelope | Success: `{ "success": true, "data": T, "meta"?: Meta }`. Error: `{ "success": false, "error": { "code": ErrorCode, "message": string, "details"?: unknown, "requestId": string } }`. SSE and file downloads are not enveloped. |
| Status codes | 200 read/update, 201 created, 202 accepted (async work), 204 never used (always return the envelope), 4xx/5xx per §2. |
| IDs | cuid strings. Unknown or other users' IDs → `404 NOT_FOUND` (never 403, to avoid existence leaks). |
| Timestamps | ISO-8601 UTC with `Z` (`2026-11-09T14:03:00.000Z`). |
| Local dates | `YYYY-MM-DD`, interpreted in the user's timezone (`UserSettings.timezone`). |
| Pagination | Cursor-based: query `cursor` (opaque base64url), `limit` (1–100, default 20). `meta: { nextCursor: string \| null, hasMore: boolean, total?: number }`. `total` only where cheap (repos, documents, achievements, goals). |
| Sorting | `sort=<field>` / `sort=-<field>` on endpoints that list allowed fields. |
| Filtering | Repeated params or comma lists: `types=pr_authored,review`. |
| Request ID | `x-request-id` accepted (validated UUID/26-char) or generated; echoed in response header and `error.requestId`. |
| Rate limits | Headers `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; 429 adds `Retry-After`. Classes in §1.1. |
| Caching | Authenticated responses `Cache-Control: private, no-store`. `/metrics/definitions` `private, max-age=3600`. |
| Validation | Zod schemas, `strict()` objects (unknown keys → 400). Coercion only for query strings. |
| Versioning | No URI version in v2.0 (D-006). Deprecated routes return `Deprecation: true` and `Sunset` headers until removed. |
| CORS | Allow-list `WEB_URL` (comma-separated list allowed); methods GET, POST, PATCH, DELETE; headers `Authorization`, `Content-Type`, `x-request-id`, `Last-Event-ID`; no cookies (`credentials: false`). |

### 1.1 Rate-limit classes (Redis-backed `@nestjs/throttler`)

| Class | Key | Limit | Applies to |
|---|---|---|---|
| `default` | user | 300 / min | all authenticated routes unless listed |
| `public` | IP | 60 / min | health, unsubscribe, OpenAPI |
| `sync` | integration | 6 / hour | `POST /sync` |
| `ai` | user | 10 / min **and** 60 / day | `POST /documents`, regenerate, `/ai/*`, `/impact/highlights` (plus monthly plan quota → 402) |
| `export` | user | 30 / hour (documents), 3 / day (`/me/export`) | exports |
| `destructive` | user | 5 / hour | `DELETE /me`, purge endpoints |
| `webhook` | — | not throttled (signature-gated, fast 202) | `/webhooks/*` |
| `sse` | user | 10 concurrent streams | `GET …/stream` |

## 2. Error codes

| Code | HTTP | When | `details` |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | Zod failure on params/query/body | `{ issues: [{ path, message, code }] }` |
| `INVALID_PERIOD` | 400 | Period grammar valid but range invalid (custom < 7 or > 366 days, future start) | `{ period }` |
| `OAUTH_STATE_INVALID` | 400 | Connect callback with missing/invalid/expired/reused `state` | — |
| `OAUTH_DENIED` | 400 | User cancelled on GitHub / `error=access_denied` | — |
| `UNAUTHENTICATED` | 401 | Missing/invalid/expired JWT | — |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | Bad or missing `X-Hub-Signature-256` | — |
| `QUOTA_EXCEEDED` | 402 | Monthly plan AI quota used up | `{ feature, used, limit, resetsAt }` |
| `FORBIDDEN` | 403 | Authenticated but action not allowed (e.g. admin routes) | — |
| `ENTITLEMENT_REQUIRED` | 403 | Plan limit other than AI quota (e.g. 2nd integration, history beyond window) | `{ entitlement, limit, plan }` |
| `NOT_FOUND` | 404 | Unknown route or resource not owned by the user | — |
| `CONFLICT` | 409 | Generic state conflict | — |
| `VERSION_CONFLICT` | 409 | `PATCH /documents/:id` with stale `baseVersion` | `{ currentVersion }` |
| `SYNC_IN_PROGRESS` | 409 | Sync requested while a run is queued/running | `{ syncRunId }` |
| `INTEGRATION_ACCOUNT_IN_USE` | 409 | GitHub account already linked to another DevImpact user | — |
| `INTEGRATION_NEEDS_REAUTH` | 409 | Sync requested on an integration needing reconnection | `{ integrationId, reconnectUrl }` |
| `GENERATION_IN_PROGRESS` | 409 | Regenerate/edit while the document is PENDING/STREAMING | `{ documentId }` |
| `PAYLOAD_TOO_LARGE` | 413 | Body > 256 KB | — |
| `RATE_LIMITED` | 429 | Throttler class exceeded | `{ class, retryAfterSeconds }` |
| `INTERNAL` | 500 | Unexpected error (details logged server-side only) | — |
| `UPSTREAM_ERROR` | 502 | GitHub/Anthropic returned an unexpected error | `{ provider }` |
| `UPSTREAM_UNAVAILABLE` | 503 | Provider overloaded / timeout after retries | `{ provider, retryAfterSeconds? }` |

Messages are human-readable and safe (no stack traces, SQL, paths or provider payloads — SEC-12).

## 3. Shared schemas

Sketches in Zod (v4) notation; final code in `packages/shared/src/schemas/`.

### 3.1 Primitives
```ts
export const Id = z.string().cuid();                       // all resource ids
export const LocalDate = z.iso.date();                     // YYYY-MM-DD
export const Timestamp = z.iso.datetime();                 // UTC ISO-8601
export const Cursor = z.string().max(512).regex(/^[A-Za-z0-9_-]+$/);
export const PageQuery = z.object({ cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20) });
export const PageMeta = z.object({ nextCursor: Cursor.nullable(), hasMore: z.boolean(),
  total: z.number().int().nonnegative().optional() });
export const Envelope = <T extends z.ZodType>(data: T) =>
  z.object({ success: z.literal(true), data, meta: z.record(z.string(), z.unknown()).optional() });
export const ErrorEnvelope = z.object({ success: z.literal(false), error: z.object({
  code: ErrorCode, message: z.string(), details: z.unknown().optional(), requestId: z.string() }) });
```

### 3.2 Enums (mirrors of Prisma enums, lower-case on the wire)
`IntegrationStatus = 'active'|'needs_reauth'|'suspended'|'disconnected'|'error'` ·
`SyncStatus = 'queued'|'running'|'waiting_rate_limit'|'succeeded'|'partial'|'failed'|'cancelled'` ·
`SyncStage = 'prepare'|'repositories'|'authored_prs'|'reviewed_prs'|'commits'|'persist'|'rollups'|'done'` ·
`SyncTrigger = 'initial'|'manual'|'scheduled'|'webhook'|'reconnect'` ·
`DocumentType = 'resume'|'appraisal'|'promotion'|'impact_narrative'|'achievement_statement'|'digest_summary'` ·
`DocumentStatus = 'pending'|'streaming'|'ready'|'failed'|'cancelled'` ·
`AchievementCategory = 'delivery'|'quality'|'mentoring'|'incident'|'leadership'|'learning'|'collaboration'|'other'` ·
`GoalStatus = 'active'|'achieved'|'missed'|'archived'` · `Plan = 'free'|'pro'|'team'|'enterprise'` ·
`MetricKey` = the keys in KPI_METHODOLOGY §3 · `MetricStatus = 'ok'|'insufficient_data'|'not_applicable'` ·
`ActivityType = 'commit'|'pr_opened'|'pr_merged'|'pr_closed'|'review'|'achievement'`.

### 3.3 Refs (evidence identifiers)
```ts
// Stable, human-readable refs used in documents and evidence lists
export const EvidenceRef = z.string().regex(/^(PR|REV|C|ACH)-[A-Za-z0-9._\/@#-]{1,120}$/);
export const EvidenceItem = z.object({ ref: EvidenceRef, kind: z.enum(['pull_request','review','commit','achievement']),
  id: Id, title: z.string(), repo: z.string().nullable(), url: z.url().nullable(), occurredAt: Timestamp });
```
Ref formats: `PR-<owner>/<repo>#<number>`, `REV-<owner>/<repo>#<number>`, `C-<owner>/<repo>@<sha7>`, `ACH-<achievementId>`.

### 3.4 Period parameter
```ts
// period=month:2026-10 | quarter:2026-Q4 | half:2026-H2 | year:2026 | custom:2026-10-01..2026-11-15
export const PeriodSpec = z.string().regex(
  /^(month:\d{4}-(0[1-9]|1[0-2])|quarter:\d{4}-Q[1-4]|half:\d{4}-H[12]|year:\d{4}|custom:\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2})$/);
export const ResolvedPeriod = z.object({ spec: PeriodSpec,
  type: z.enum(['month','quarter','half','year','custom']), startDate: LocalDate, endDate: LocalDate,
  timezone: z.string(), periodDays: z.number().int(), inProgress: z.boolean(), label: z.string() });
```
Default when omitted: the user's `defaultPeriodType` containing today. `parsePeriod(spec, tz, today)`
lives in `packages/shared/src/periods/` (P07) and is shared by API and web (URL state).

### 3.5 Core resource schemas
```ts
export const UserDto = z.object({ id: Id, email: z.email(), name: z.string(), image: z.url().nullable(),
  plan: Plan, createdAt: Timestamp });
export const SettingsDto = z.object({ timezone: z.string(), currentRole: z.string().nullable(),
  careerLevel: z.string().nullable(), targetRole: z.string().nullable(),
  defaultPeriodType: z.enum(['month','quarter','half','year']),
  digestEnabled: z.boolean(), digestDayOfWeek: z.number().int().min(1).max(7), digestHourLocal: z.number().int().min(0).max(23),
  notifySyncFailures: z.boolean(), notifyDocumentReady: z.boolean(), aiRedactPrivateRepos: z.boolean(),
  onboardingStep: z.string().nullable(), onboardingCompletedAt: Timestamp.nullable() });
export const IntegrationDto = z.object({ id: Id, provider: z.literal('github'), status: IntegrationStatus,
  statusReason: z.string().nullable(), externalLogin: z.string().nullable(), displayName: z.string().nullable(),
  avatarUrl: z.url().nullable(), installations: z.array(z.object({ installationId: z.string(), accountLogin: z.string(),
  accountType: z.enum(['User','Organization']), repositorySelection: z.enum(['all','selected']), suspended: z.boolean() })),
  manageUrl: z.url(), lastSyncedAt: Timestamp.nullable(), lastSuccessfulSyncAt: Timestamp.nullable(),
  nextScheduledSyncAt: Timestamp.nullable(), backfillFrom: Timestamp.nullable(), createdAt: Timestamp });
export const RepositoryDto = z.object({ id: Id, integrationId: Id, fullName: z.string(), isPrivate: z.boolean(),
  isFork: z.boolean(), isArchived: z.boolean(), accessible: z.boolean(), included: z.boolean(),
  inclusionSource: z.enum(['default','user']), viaInstallation: z.boolean(), lastActivityAt: Timestamp.nullable(),
  lastSyncedAt: Timestamp.nullable(), htmlUrl: z.url().nullable() });
export const SyncRunDto = z.object({ id: Id, integrationId: Id, trigger: SyncTrigger, kind: z.enum(['backfill','incremental','targeted']),
  status: SyncStatus, stage: SyncStage, progress: z.number().int().min(0).max(100),
  counts: z.object({ repos: z.number(), prsAuthored: z.number(), prsReviewed: z.number(), reviews: z.number(),
  commits: z.number(), created: z.number(), updated: z.number() }).partial(),
  windowFrom: Timestamp.nullable(), windowTo: Timestamp.nullable(), resumeAt: Timestamp.nullable(),
  errorCode: z.string().nullable(), errorMessage: z.string().nullable(),
  errors: z.array(z.object({ stage: SyncStage, repo: z.string().nullable(), code: z.string(), message: z.string(), at: Timestamp })),
  queuedAt: Timestamp, startedAt: Timestamp.nullable(), finishedAt: Timestamp.nullable() });
```

---

## 4. Auth (web, Better Auth)

Served by `apps/web` at `/api/auth/*` (library-defined; listed for completeness). Not part of the
Nest API.

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /api/auth/sign-in/social` `{ provider: 'github'\|'google', callbackURL }` | Start OAuth sign-in | Better Auth handles state + PKCE |
| `GET /api/auth/callback/:provider` | OAuth callback | Sets session cookie |
| `POST /api/auth/sign-out` | End session | |
| `GET /api/auth/get-session` | Current session (web) | Used by RSC/middleware |
| `GET /api/auth/token` | Mint short-lived API JWT | Requires session |
| `GET /api/auth/jwks` | Public keys for API verification | Public, cacheable |
| `GET /api/auth/list-sessions`, `POST /api/auth/revoke-session` | Session management (S) | Settings → Security |
| `POST /api/dev-login` `{ email? }` | Dev/E2E sign-in as a seeded user | **404 unless `NODE_ENV !== 'production' && ENABLE_DEV_LOGIN === 'true'`** |

## 5. Me & settings

| Method & path | Auth / rate | Request | Response `data` | Errors |
|---|---|---|---|---|
| `GET /me` | user · default | — | `{ user: UserDto, settings: SettingsDto, entitlements: Entitlements, integrations: IntegrationSummary[], onboarding: { step, completed } }` | 401 |
| `PATCH /me` | user · default | `{ name?: string(1..100) }` | `{ user: UserDto }` | 400, 401 |
| `GET /me/settings` | user · default | — | `SettingsDto` | 401 |
| `PATCH /me/settings` | user · default | `SettingsDto.partial()` (timezone validated against `Intl.supportedValuesOf('timeZone')`) | `SettingsDto` — timezone change enqueues full recompute and returns `meta.recomputeQueued = true` | 400, 401 |
| `GET /me/entitlements` | user · default | — | `Entitlements = { plan, limits: { integrations, historyMonths, aiGenerationsPerMonth, aiQuickPerMonth }, usage: { integrations } }` | 401 |
| `GET /me/usage` | user · default | `?month=YYYY-MM` (default current UTC month) | `{ month, generations: { used, limit, resetsAt }, quick: { used, limit }, tokens: { input, output, cacheRead }, estimatedCostUsd: number, byFeature: [{ feature, count, tokens }] }` | 400, 401 |
| `GET /me/export` | user · export (3/day) | — | **File** `application/json` attachment `devimpact-export-<date>.json`: `{ exportedAt, schemaVersion, user, settings, integrations (no tokens), repositories, pullRequests, reviews, commits, metricSnapshots, impactScores, documents (+versions), aiUsage, achievements, goals, digests }` (streamed) | 401, 429 |
| `DELETE /me` | user · destructive | `{ confirmEmail: string }` must equal account email | `202 { deleted: true }` — revokes GitHub tokens (best effort), deletes the user (cascade), Better Auth sessions removed | 400 (mismatch), 401, 429 |

`IntegrationSummary = Pick<IntegrationDto, 'id'|'provider'|'status'|'externalLogin'|'lastSuccessfulSyncAt'>`.

## 6. Integrations

| Method & path | Auth / rate | Request | Response `data` | Errors |
|---|---|---|---|---|
| `GET /integrations` | user · default | — | `IntegrationDto[]` | 401 |
| `GET /integrations/:id` | user · default | — | `IntegrationDto & { currentRun: SyncRunDto \| null }` | 401, 404 |
| `POST /integrations/github/connect` | user · default | `{ returnTo?: '/onboarding' \| '/settings/integrations' }` | `{ url: string, mode: 'install' \| 'authorize', expiresAt }` | 401, 403 `ENTITLEMENT_REQUIRED` (integration limit) |
| `POST /integrations/github/callback` | user · default | `{ code: string(1..200), state: string(1..1024), installationId?: string, setupAction?: 'install'\|'update'\|'request' }` | `201 { integration: IntegrationDto, syncRun: SyncRunDto }` (backfill queued). `setupAction='request'` (org approval pending) → `200 { integration, pendingApproval: true }` | 400 `OAUTH_STATE_INVALID` / `OAUTH_DENIED` / `VALIDATION_FAILED`, 401, 409 `INTEGRATION_ACCOUNT_IN_USE`, 502 |
| `POST /integrations/:id/reconnect` | user · default | — | `{ url, mode: 'authorize' }` (same as connect, bound to this integration) | 401, 404 |
| `DELETE /integrations/:id` | user · destructive | query `purgeData=true\|false` (default false) | `{ integrationId, status: 'disconnected', purged: boolean, tokenRevoked: boolean }` | 401, 404 |

Webhook-driven status changes (`needs_reauth`, `suspended`) are visible via `GET /integrations`
and `GET /sync/status`.

## 7. Repositories

| Method & path | Auth / rate | Request | Response `data` | Errors |
|---|---|---|---|---|
| `GET /repos` | user · default | `PageQuery & { integrationId?: Id, included?: boolean, accessible?: boolean, q?: string(≤100), sort?: 'fullName'\|'-lastActivityAt' }` | `RepositoryDto[]`, `meta: PageMeta (total)` | 400, 401 |
| `PATCH /repos/:id` | user · default | `{ included: boolean }` → sets `inclusionSource='user'`; enqueues `metrics.recompute` (full history) | `RepositoryDto` | 400, 401, 404 |
| `PATCH /repos` | user · default | `{ ids: Id[1..200], included: boolean }` | `{ updated: number }` | 400, 401 |
| `POST /repos/:id/purge` (S) | user · destructive | — | `{ deleted: { pullRequests, reviews, commits } }` (repo stays, `included=false`) | 401, 404 |

## 8. Sync

| Method & path | Auth / rate | Request | Response `data` | Errors |
|---|---|---|---|---|
| `POST /sync` | user · sync | `{ integrationId?: Id }` (default: the user's GitHub integration) | `202 { syncRun: SyncRunDto }` | 401, 404, 409 `SYNC_IN_PROGRESS` (returns current run in details), 409 `INTEGRATION_NEEDS_REAUTH`, 429 |
| `GET /sync/status` | user · default | `?integrationId=` | `{ integrationId, state: 'idle'\|'queued'\|'running'\|'waiting_rate_limit'\|'needs_reauth'\|'failed', currentRun: SyncRunDto \| null, lastRun: SyncRunDto \| null, lastSuccessfulAt, nextScheduledAt }` — **read from DB** | 401, 404 |
| `GET /sync/runs` | user · default | `PageQuery & { integrationId?: Id, status?: SyncStatus }` | `SyncRunDto[]`, `meta: PageMeta` | 400, 401 |
| `GET /sync/runs/:id` | user · default | — | `SyncRunDto` | 401, 404 |
| `GET /sync/stream` (S) | user · sse | `?runId=` · `Accept: text/event-stream` | SSE: `event: progress` `{ stage, progress, counts }`; `event: done` `SyncRunDto`; `event: error` `{ code, message }`; `: heartbeat` every 15 s | 401, 404 |

Polling contract (always available): `GET /sync/status` every 2 s while `state ∈ {queued, running}`,
every 30 s when `waiting_rate_limit`, stop otherwise.

## 9. Metrics

All metric endpoints are **read-only, never call the AI, never enqueue work**. `period` follows §3.4.

```ts
export const MetricValue = z.object({ key: MetricKey, label: z.string(), unit: z.enum(['count','hours','ratio','repos','days','weeks']),
  value: z.number().nullable(), n: z.number().int(), status: MetricStatus,
  previousValue: z.number().nullable(), delta: z.number().nullable(), deltaPct: z.number().nullable(),
  direction: z.enum(['higher_is_better','lower_is_better','neutral']), inScore: z.boolean(),
  evidence: z.array(Id).max(200), evidenceTruncated: z.boolean() });
export const MetricDefinition = z.object({ key: MetricKey, label: z.string(), section: z.enum(['delivery','quality','collaboration','ownership','consistency']),
  definition: z.string(), formula: z.string(), unit: MetricValue.shape.unit, minN: z.number().int(), goodRange: z.string(),
  caveats: z.array(z.string()), antiGaming: z.string().nullable(), inScore: z.boolean(), deferred: z.boolean() });
```

| Method & path | Request | Response `data` | Errors |
|---|---|---|---|
| `GET /metrics/definitions` | — | `{ metricsVersion, scoreVersion, metrics: MetricDefinition[], bands: [{ min, max, label }] }` | 401 |
| `GET /metrics/overview` | `?period=` | `{ period: ResolvedPeriod, previousPeriod: ResolvedPeriod, comparison: 'full'\|'same_elapsed', cards: MetricValue[] /* commits, prs_merged, prs_reviewed */, impact: { status, overall: number\|null, delta: number\|null, band: string\|null }, dataFreshness: { lastSuccessfulSyncAt, syncing: boolean } }` | 400, 401 |
| `GET /metrics/kpis` | `?period=` | `{ period, sections: [{ key, title, metrics: MetricValue[] }] /* order: delivery, quality, collaboration, ownership, consistency */, impactStatus }` | 400, 401 |
| `GET /metrics/timeseries` | `?metric=<MetricKey>&period=&interval=day\|week\|month` (or `from`,`to` LocalDate) | `{ metric, interval, unit, points: [{ start: LocalDate, end: LocalDate, value: number\|null, n: number }], timezone }` (≤ 400 points) | 400 (`interval` too fine for range), 401 |
| `GET /metrics/heatmap` | `?from=&to=` (≤ 366 days; default last 365) | `{ days: [{ date, count, commits, prsOpened, prsMerged, reviews }], max: number, timezone }` | 400, 401 |
| `GET /metrics/repos` | `?period=&limit=` | `{ repos: [{ repositoryId, fullName, commits, prsMerged, prsReviewed, firstContributionAt, lastContributionAt, twoWay: boolean }] }` | 400, 401 |

## 10. Impact

```ts
export const ImpactDto = z.object({ period: ResolvedPeriod, status: z.enum(['ok','insufficient_data']),
  scoreVersion: z.string(), overall: z.number().int().nullable(), band: z.string().nullable(),
  dimensions: z.array(z.object({ key: z.enum(['delivery','quality','collaboration','ownership']), label: z.string(),
    score: z.number().int().nullable(), weight: z.number(), available: z.boolean(),
    components: z.array(z.object({ metric: MetricKey, value: z.number().nullable(), n: z.number(),
      bandScore: z.number().nullable(), shrunkScore: z.number().nullable(), weight: z.number() })) })),
  explanation: z.string(), inputs: z.unknown() /* KPI_METHODOLOGY §6.6 */, computedAt: Timestamp,
  highlights: z.object({ documentId: Id, status: DocumentStatus }).nullable() });
```

| Method & path | Auth / rate | Request | Response `data` | Errors |
|---|---|---|---|---|
| `GET /impact` | user · default | `?period=` | `ImpactDto` (computed lazily, cached) | 400, 401 |
| `GET /impact/history` | user · default | `?periodType=month\|quarter&count=1..24` (default month, 12) | `{ points: [{ period: ResolvedPeriod, status, overall, dimensions: { delivery, quality, collaboration, ownership } }], scoreVersion }` | 400, 401 |
| `POST /impact/highlights` | user · ai | `{ period: PeriodSpec, regenerate?: boolean }` | `200/201 { document: DocumentSummary, content: ImpactNarrativeContent, cached: boolean }` (fast model, synchronous ≤ 20 s) | 400, 401, 402, 409 (score insufficient → `CONFLICT` with details `{ reason: 'insufficient_data' }`), 429, 502, 503 |

## 11. Activity

```ts
export const FeedItem = z.object({ id: z.string(), type: ActivityType, occurredAt: Timestamp,
  repo: z.object({ id: Id, fullName: z.string() }).nullable(), title: z.string(), url: z.url().nullable(),
  ref: EvidenceRef, meta: z.record(z.string(), z.unknown()) /* e.g. { number, state, additions, deletions, reviewState, comments } */ });
export const ActivityFilter = PageQuery.extend({ period: PeriodSpec.optional(), from: LocalDate.optional(), to: LocalDate.optional(),
  repoIds: z.array(Id).max(50).optional(), q: z.string().max(100).optional() });
```

| Method & path | Request | Response `data` | Errors |
|---|---|---|---|
| `GET /activity/feed` | `ActivityFilter & { types?: ActivityType[] }` (newest first) | `FeedItem[]`, `meta: PageMeta` | 400, 401 |
| `GET /activity/prs` | `ActivityFilter & { role: 'authored'\|'reviewed', state?: 'open'\|'merged'\|'closed', sort?: '-createdAt'\|'-mergedAt'\|'-changedLines' }` | `PullRequestListItem[]` = `{ id, ref, repo, number, title, url, state, isDraft, createdAt, readyAt, mergedAt, closedAt, additions, deletions, changedFiles, cycleTimeHours: number\|null, firstReviewHours: number\|null, reverted: boolean, myReviews?: { count, latestState } }` | 400, 401 |
| `GET /activity/prs/:id` | — | `PullRequestListItem & { body: string\|null (authored only), labels, reviewersCount, approvalsCount, changesRequestedCount, myReviews: ReviewItem[], revertedByUrl, achievementIds: Id[] }` | 401, 404 |
| `GET /activity/reviews` | `ActivityFilter & { state?: ReviewState }` | `ReviewItem[]` = `{ id, ref, pullRequest: { id, repo, number, title, url, authorLogin }, state, submittedAt, commentsCount, hasBody, turnaroundHours: number\|null }` | 400, 401 |
| `GET /activity/commits` | `ActivityFilter` | `CommitItem[]` = `{ id, ref, repo, sha, messageHeadline, authoredAt, additions, deletions, branch, associatedPrNumber, url }` | 400, 401 |
| `GET /activity/commits/:id` | — | `CommitItem & { messageBody }` | 401, 404 |
| `GET /activity/summary` | *deprecated* (`Deprecation: true`) until P10 | v1-compatible shape computed from v2 data (correct merged count) | removed in P10 |

## 12. Career

| Method & path | Request | Response `data` | Errors |
|---|---|---|---|
| `GET /career/timeline` | `?year=YYYY` (default current) | `{ years: number[] /* years with data, for the filter */, year, quarters: [{ quarter: 1..4, label, repos: [{ repositoryId, fullName, items: [{ type: 'pr_merged'\|'achievement'\|'review_cluster', id, ref, title, date, url, tags: string[] }] }], milestones: [{ kind: 'first_merged_pr_in_repo'\|'largest_merged_pr'\|'longest_active_week_streak'\|'achievement', date, title, refs: EvidenceRef[] }], totals: { prsMerged, prsReviewed, achievements } }] }` — items ≤ 50 per repo per quarter with `truncated` flag | 400, 401 |

Tags = PR labels (≤ 3) + achievement category. Review clusters group a quarter's reviews per repo
into one item ("Reviewed 14 PRs").

## 13. Documents & generation

### 13.1 Options per type
```ts
const Role = z.enum(['backend','frontend','fullstack','devops','manager']);
export const ResumeOptions = z.object({ type: z.literal('resume'), period: PeriodSpec, role: Role,
  format: z.enum(['bullets','narrative']).default('bullets'), length: z.enum(['short','standard']).default('standard'),
  jobDescription: z.string().max(8000).optional() });
export const AppraisalOptions = z.object({ type: z.literal('appraisal'), period: PeriodSpec /* month|quarter|half|year|custom */,
  selfReflection: z.string().max(4000).optional() });
export const PromotionOptions = z.object({ type: z.literal('promotion'), period: PeriodSpec.default(/* last 12 months */),
  currentRole: z.string().min(1).max(100), targetRole: z.string().min(1).max(100), ladderText: z.string().max(12000).optional() });
export const DocumentOptions = z.discriminatedUnion('type', [ResumeOptions, AppraisalOptions, PromotionOptions]);
export const DocumentSummary = z.object({ id: Id, type: DocumentType, title: z.string(), status: DocumentStatus,
  currentVersion: z.number().int(), period: ResolvedPeriod.nullable(), model: z.string(), citationCoverage: z.number().nullable(),
  createdAt: Timestamp, updatedAt: Timestamp });
```
Content schemas (`ResumeContent`, `AppraisalContent`, `PromotionContent`, `ImpactNarrativeContent`)
are defined by P08 in shared; every claim-bearing item has `citations: EvidenceRef[]` and optional
`flags: ('uncited'|'invalid_citation')[]`. Engine-filled sections (`metrics`, `supportingData`)
are `MetricValue[]`.

### 13.2 Endpoints

| Method & path | Auth / rate | Request | Response `data` | Errors |
|---|---|---|---|---|
| `GET /documents` | user · default | `PageQuery & { type?: DocumentType, q?: string(≤100), sort?: '-createdAt'\|'-updatedAt'\|'title' }` | `DocumentSummary[]`, `meta: PageMeta (total)` | 400, 401 |
| `POST /documents/preview-evidence` | user · default | `DocumentOptions` | `{ period, counts: { prsMerged, prsReviewed, commits, repos, achievements }, topEvidence: EvidenceItem[] (≤ 25), metrics: MetricValue[], estimatedQuotaCost: 1 }` (no AI) | 400, 401 |
| `POST /documents` | user · ai | `DocumentOptions & { regenerate?: boolean }` | Cache hit: `200 { document: DocumentSummary, cached: true }`. Else `201 { document: DocumentSummary (status 'pending'), streamUrl: '/api/documents/:id/stream' }` | 400, 401, 402 `QUOTA_EXCEEDED`, 409 (insufficient evidence: `CONFLICT` details `{ reason: 'no_evidence' }`), 429 |
| `GET /documents/:id` | user · default | `?version=` (default current) | `{ document: DocumentSummary & { options, evidenceRefs }, version: { number, source, createdAt, content } \| null }` | 401, 404 |
| `GET /documents/:id/stream` | user · sse | headers `Accept: text/event-stream`, optional `Last-Event-ID` | SSE §13.3 | 401, 404 |
| `POST /documents/:id/cancel` | user · default | — | `{ document: DocumentSummary }` (status `cancelled`) | 401, 404, 409 (already finished) |
| `PATCH /documents/:id` | user · default | `{ baseVersion: int, title?: string(1..200), content?: <type content schema> }` | `{ document, version }` (new version, source `user_edit`) | 400, 401, 404, 409 `VERSION_CONFLICT` / `GENERATION_IN_PROGRESS` |
| `GET /documents/:id/versions` | user · default | `PageQuery` | `[{ number, source, createdAt }]` | 401, 404 |
| `POST /documents/:id/versions/:n/restore` | user · default | — | `{ document, version }` (new version, source `restore`) | 401, 404, 409 |
| `POST /documents/:id/regenerate` | user · ai | `{ options?: Partial<DocumentOptions>, section?: string /* S: single section */ }` | `201 { document (status 'pending', next version), streamUrl }` | 400, 401, 402, 404, 409, 429 |
| `DELETE /documents/:id` | user · default | — | `{ deleted: true }` | 401, 404 |
| `GET /documents/:id/export` | user · export | `?format=md\|txt\|pdf\|docx&version=` | **File** with `Content-Disposition: attachment; filename="<type>-<period>-v<n>.<ext>"`; MIME `text/markdown`, `text/plain`, `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 400, 401, 404, 409 (document not ready) |

### 13.3 SSE event contract (`GET /documents/:id/stream`)
Each event has `id: <redis-stream-id>` (resumable with `Last-Event-ID`), `event:` and JSON `data:`.

| Event | `data` | Notes |
|---|---|---|
| `status` | `{ status: 'pending'\|'streaming', version }` | first event; repeated on state change |
| `section` | `{ key: string, index: number, content: unknown /* validated section */ }` | emitted when a top-level section/bullet is complete |
| `delta` | `{ key: string, text: string }` | optional incremental text for the section being written |
| `done` | `{ documentId, version, citationCoverage, flags: { uncited: number, invalid: number } }` | terminal; client refetches `GET /documents/:id` |
| `error` | `{ code: ErrorCode \| 'GENERATION_FAILED' \| 'OUTPUT_INVALID', message, retryable: boolean }` | terminal; no quota consumed |
| `cancelled` | `{ documentId }` | terminal |
| *comment* | `: heartbeat` every 15 s | keeps proxies open |

If the document is already `ready` when the stream is opened, the server sends `status` then `done`
immediately. Clients use a fetch-based SSE reader (EventSource cannot send `Authorization`).

## 14. AI utilities

| Method & path | Auth / rate | Request | Response `data` | Errors |
|---|---|---|---|---|
| `POST /ai/achievement-statement` | user · ai (quick quota) | `{ source: { kind: 'pull_request'\|'commit', id: Id } }` | `{ title: string(≤200), statement: string(≤1000), category: AchievementCategory, citations: EvidenceRef[], cached: boolean }` | 400, 401, 402, 404, 429, 502, 503 |

(v1 spec `enhanceCommitMessage` → this endpoint. Digest summaries are generated by the worker only.)

## 15. Achievements

```ts
export const AchievementInput = z.object({ title: z.string().min(1).max(200), description: z.string().max(5000).optional(),
  impact: z.string().max(1000).optional(), category: AchievementCategory, occurredOn: LocalDate,
  links: z.array(z.object({ url: z.url(), label: z.string().max(100).optional() })).max(10).default([]),
  evidence: z.array(z.object({ kind: z.enum(['pull_request','commit','review']), id: Id })).max(50).default([]),
  source: z.enum(['manual','from_activity','suggested']).default('manual') });
export const AchievementDto = AchievementInput.extend({ id: Id, ref: EvidenceRef, evidence: z.array(EvidenceItem),
  goalIds: z.array(Id), createdAt: Timestamp, updatedAt: Timestamp });
```

| Method & path | Request | Response `data` | Errors |
|---|---|---|---|
| `GET /achievements` | `PageQuery & { period?, category?, q? }` | `AchievementDto[]`, `meta (total)` | 400, 401 |
| `POST /achievements` | `AchievementInput` (evidence ids must belong to the user) | `201 AchievementDto`; enqueues `metrics.recompute` for `occurredOn` | 400, 401, 404 (evidence not found) |
| `GET /achievements/:id` | — | `AchievementDto` | 401, 404 |
| `PATCH /achievements/:id` | `AchievementInput.partial()` | `AchievementDto` | 400, 401, 404 |
| `DELETE /achievements/:id` | — | `{ deleted: true }` | 401, 404 |

## 16. Goals

```ts
export const GoalInput = z.object({ title: z.string().min(1).max(200), description: z.string().max(4000).optional(),
  startDate: LocalDate, targetDate: LocalDate.optional(), status: GoalStatus.default('active'),
  metricTarget: z.object({ metricKey: MetricKey, comparator: z.enum(['lte','gte']), targetValue: z.number() }).optional(),
  achievementIds: z.array(Id).max(100).default([]) });
export const GoalDto = GoalInput.extend({ id: Id, progress: z.object({ current: z.number().nullable(), target: z.number().nullable(),
  status: z.enum(['met','not_met','no_data','no_metric']), evaluatedPeriod: ResolvedPeriod.nullable() }),
  createdAt: Timestamp, updatedAt: Timestamp });
```
Progress: if `metricTarget` is set, `current` = the metric's value over the most recent complete
calendar month in the user's timezone (the current in-progress month if the goal started this
month); `met` when `current <comparator> targetValue` holds, `not_met` otherwise,
`no_data` when the metric is `insufficient_data`; without a target, `no_metric`.

| Method & path | Request | Response `data` | Errors |
|---|---|---|---|
| `GET /goals` | `PageQuery & { status? }` | `GoalDto[]`, `meta (total)` | 400, 401 |
| `POST /goals` | `GoalInput` | `201 GoalDto` | 400, 401, 404 (achievement not found) |
| `GET /goals/:id` | — | `GoalDto & { achievements: AchievementDto[] }` | 401, 404 |
| `PATCH /goals/:id` | `GoalInput.partial()` | `GoalDto` | 400, 401, 404 |
| `DELETE /goals/:id` | — | `{ deleted: true }` | 401, 404 |

## 17. Notifications

| Method & path | Auth / rate | Request | Response `data` | Errors |
|---|---|---|---|---|
| `POST /notifications/unsubscribe` | **public** · public | `{ token: string }` (HMAC-signed `{ userId, list: 'digest'\|'all', exp }`) | `{ unsubscribed: true, list }` | 400 (invalid/expired token) |
| `POST /notifications/digest/preview` (S) | user · default | — | `{ subject, html, text }` for the last complete week (no email sent) | 401 |

Digest preferences are part of `PATCH /me/settings`.

## 18. Webhooks

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| `POST /webhooks/github` | **public**, HMAC `X-Hub-Signature-256` over the raw body with `GITHUB_WEBHOOK_SECRET` | raw JSON; headers `X-GitHub-Event`, `X-GitHub-Delivery`, `X-GitHub-Hook-Installation-Target-ID` | `202 { accepted: true, duplicate: boolean }` within 1 s | 401 `WEBHOOK_SIGNATURE_INVALID`, 400 (missing headers), 413 (> 25 MB GitHub max is accepted; JSON limit raised for this route only) |

## 19. Health, docs, admin

| Method & path | Auth | Response |
|---|---|---|
| `GET /health` | public | Readiness (exists since P02): `{ status: 'ok'\|'degraded', checks: { database: 'ok'\|'fail', redis: 'ok'\|'fail' } }` — 503 if any fails. Used by compose healthchecks |
| `GET /health/live` | public | Liveness, no dependencies: `{ status: 'ok', version, uptimeSeconds }` (P05) |
| `GET /docs`, `GET /docs/openapi.json` | public, **non-production only** | Swagger UI / OpenAPI 3.1 generated from the Zod schemas |
| `GET /admin/queues` | admin allow-list (`ADMIN_USER_IDS`) | Bull Board (P14) |

## 20. v1 → v2 endpoint disposition

| v1 endpoint | Disposition | v2 replacement | Phase |
|---|---|---|---|
| `POST /auth/dev-login` | **Removed** | `POST /api/dev-login` on web (dev only) | P05 |
| `POST /auth/github`, `POST /auth/google` | **Removed** (stubs, API-03) | Better Auth `/api/auth/sign-in/social` | P05 |
| `GET /auth/me` | **Changed → alias**, deprecated | `GET /me` (alias kept until P09 removes old web code) | P05 → P09 |
| `GET /integrations` | **Kept, changed** (shape `IntegrationDto`) | same | P05/P06 |
| `POST /integrations/github/connect` | **Kept, changed** (GitHub App, `state`, `{url, mode}`) | same | P05 |
| `POST /integrations/github/callback` | **Kept, changed** (state required, installation id) | same | P05 |
| `DELETE /integrations/:id` | **Kept, changed** (`purgeData`, revoke, no silent cascade) | same | P05/P06 |
| `POST /sync/trigger` | **Renamed** | `POST /sync` (202) | P06 |
| `GET /sync/status` | **Kept, changed** (DB-backed, per integration) | same | P06 |
| `GET /activity/commits` | **Kept, changed** (validation, cursor pagination, repo filter) | same | P05 (validation) / P07 |
| `GET /activity/prs` | **Kept, changed** (`role` required; no stubs) | same | P07 |
| `GET /activity/summary` | **Deprecated → removed** | `GET /metrics/overview`, `/metrics/kpis` | P07 (deprecate), P10 (remove) |
| `POST /generate/resume` / `appraisal` / `promotion` | **Removed** | `POST /documents` (+ stream) | P08 |
| `GET /generate/impact-score` | **Removed** (side-effecting GET, API-04) | `GET /impact` (read-only) + `POST /impact/highlights` | P07 |
| `GET /documents` | **Kept, changed** (cursor pagination, summaries) | same | P08 |
| `GET /documents/:id` | **Kept, changed** (versioned content) | same | P08 |
| `DELETE /documents/:id` | **Kept** (typed 404) | same | P05/P08 |

P05 may keep transitional v1-shaped responses on endpoints whose new shape depends on later phases,
provided they use the v2 envelope and status codes.

## 21. PRD coverage check

| PRD feature(s) | Endpoints |
|---|---|
| F-01, F-02 | §4 (web auth, dev-login), `GET /me` |
| F-03, F-04 | `DELETE /me`, `GET /me/export` |
| F-05 | `GET/PATCH /me/settings` |
| F-06, F-07 | `GET /me/entitlements`, `GET /me/usage`, 402/403 errors |
| F-10, F-16, F-17 | §6 (connect, callback, reconnect, delete) |
| F-11 | §7 |
| F-12–F-15 | §8, `POST /webhooks/github` |
| F-18 | `GET /activity/prs?role=` |
| F-20, F-21, F-22 | `/metrics/overview`, `/metrics/timeseries`, `/metrics/heatmap` |
| F-23, F-25 | `/activity/feed`, `/activity/prs`, `/activity/reviews`, `/activity/commits` (+ detail) |
| F-24 | `/metrics/overview` + `/activity/feed` + `/me` (client-side rules defined in P04) |
| F-26, F-27 | `/metrics/kpis`, `/metrics/definitions` (evidence ids → activity detail) |
| F-28, F-29 | `/impact`, `/impact/history`, `POST /impact/highlights` |
| F-30 | `/career/timeline`, `/metrics/repos` |
| F-31 | `period` parameter on all metrics/activity endpoints |
| F-40–F-50 | §13 |
| F-51 | `POST /ai/achievement-statement` |
| F-60, F-61 | §15; achievements appear in `/activity/feed`, `/career/timeline`, document evidence |
| F-62 | §16 |
| F-63–F-65 | `PATCH /me/settings`, §17 |
| F-70–F-75 | UI only (no endpoints) |
| F-76 | `UserSettings.aiRedactPrivateRepos` via `/me/settings`, applied by the AI layer |
