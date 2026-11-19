# V2 Decision Log

Two kinds of entries:

- **PROPOSED** — the planner's recommended default. Phase 03 (Blueprint) confirms, amends or
  rejects each one, with the user's input where marked **USER DECISION**.
- **CONFIRMED** — binding. Later phases must follow it; changing it requires a new entry that
  supersedes the old one (never edit history silently).

Format: `D-NNN · Title · Status · Phase · Summary · Rationale · Consequences`.

---

## Proposed defaults (from planning, 2026-11-09)

> Kept verbatim as history. Phase 03 resolved every entry; the binding versions are under
> [Confirmed decisions](#confirmed-decisions).

### D-001 · Keep the monorepo shape and core stack · PROPOSED → **CONFIRMED** (see Confirmed decisions)
Keep npm workspaces with `apps/web` (Next.js), `apps/api` (NestJS), `packages/shared`.
Add **Turborepo** only if build orchestration becomes painful (not required).
*Rationale:* the codebase is small (~4.5k LOC); a rewrite of the stack costs more than it saves.

### D-002 · Upgrade to current LTS / stable versions · PROPOSED → **AMENDED** (see Confirmed decisions)
- Node **22 LTS** minimum (`engines`, Docker base `node:22-alpine`); Node 18 is EOL.
- Next.js → latest stable major (16.x at time of writing) + React 19; Tailwind v4; shadcn/ui via CLI.
- NestJS → 11.x; Prisma → latest stable; BullMQ latest; `@anthropic-ai/sdk` latest.
- Postgres 16, Redis 7 in compose.
*Rationale:* security patches (Next 14.2.3 CVEs), long support window. Done in P02 (backend
deps, patch-level Next) and P09 (Next major + UI stack).

### D-003 · Authentication architecture · PROPOSED · **USER DECISION in P03** → **CONFIRMED** (user: Better Auth)
Recommended: **auth lives in the web app** using a maintained library (Better Auth or Auth.js v5)
with GitHub + Google sign-in, sessions stored in Postgres via Prisma. The web app calls the API
with a **short-lived signed JWT** (or session cookie on the same parent domain); NestJS verifies
it in a global `AuthGuard` and derives `userId` — the `x-user-id` header is removed.
`dev-login` survives only when `NODE_ENV=development && ENABLE_DEV_LOGIN=true`.
Alternative: auth owned by NestJS (Passport) issuing httpOnly cookies.

### D-004 · Sign-in identity vs. data-source integrations are separate · PROPOSED → **CONFIRMED** (user: GitHub App)
"Sign in with GitHub" (identity, minimal scopes `read:user user:email`) is distinct from
"Connect GitHub as a data source" (scopes needed for private repo metadata). This allows Google
sign-in users to connect GitHub, and lets users connect multiple accounts later.
Evaluate **GitHub App** vs OAuth App for the data source in P03 (GitHub App gives fine-grained
repo selection, higher rate limits and webhooks per installation).

### D-005 · Tokens encrypted at rest · PROPOSED → **AMENDED**
AES-256-GCM envelope encryption for `accessToken`/`refreshToken` with a key from
`TOKEN_ENCRYPTION_KEY` (32-byte base64), key-version prefix for rotation. Never logged, never
returned by the API.

### D-006 · API conventions · PROPOSED → **AMENDED**
- Envelope: `{ success: true, data, meta? }` / `{ success: false, error: { code, message, details? } }`.
- Proper HTTP status codes via a global exception filter (`4xx/5xx`, not 200-with-error).
- Zod validation pipe using schemas from `packages/shared`.
- Cursor or page pagination with `limit` capped (max 100).
- OpenAPI document generated from the Zod schemas and published at `/api/docs` (non-prod).
- URI versioning not required for v2; keep `/api` prefix.

### D-007 · Deterministic metrics; AI only for narrative · PROPOSED · **USER DECISION in P03** → **CONFIRMED** (user: deterministic, overall + dimensions)
KPIs and the impact score are computed by a versioned, deterministic formula from stored data
(inspired by DORA/SPACE, adapted to individuals). Claude produces highlights, narratives,
suggestions and documents, each citing evidence IDs. Scores show "how this is calculated".
*Rationale:* reproducibility, fairness, explainability, cost.

### D-008 · Sync strategy · PROPOSED → **AMENDED**
- Separate **worker process** (`apps/api/src/worker.ts`) consuming BullMQ queues; API only enqueues.
- Prefer GitHub **GraphQL + Search** (`author:`, `reviewed-by:`) over iterating every repo.
- Incremental sync from a per-integration cursor (`lastSyncedAt`), scheduled every 24h via
  BullMQ repeatable jobs, plus **webhooks** (HMAC-verified) for near-real-time updates.
- `SyncRun` table persists status, counts, errors, duration.
- Octokit throttling + retry plugins; respect rate limits; never swallow errors silently.
- Reviewed-only PRs stored distinctly (never counted as authored PRs).

### D-009 · AI generation design · PROPOSED → **AMENDED**
- Model IDs from env: `ANTHROPIC_MODEL_DEFAULT` (current Sonnet-class) and
  `ANTHROPIC_MODEL_FAST` (current Haiku-class) — check the `claude-api` skill for current IDs.
- Structured output via tool use / JSON schema, validated with Zod; one repair retry.
- SSE streaming for long documents; documents saved as versioned drafts the user can edit.
- Cache key = hash(prompt version, model, normalized input evidence); reuse unless "regenerate".
- Retry only retryable errors (429, 5xx, overloaded) with exponential backoff + jitter.
- Track tokens/cost per generation; per-plan monthly quotas.
- Treat activity text as untrusted: delimit it, instruct the model to ignore instructions inside it.

### D-010 · Frontend data layer · PROPOSED → **AMENDED**
Typed API client generated from / validated by shared Zod schemas + **TanStack Query** for
caching, retries and polling. Server Components for shells; client components for interactive
widgets. Error boundaries (`error.tsx`) and skeletons (`loading.tsx`) per route.

### D-011 · Testing stack · PROPOSED → **CONFIRMED**
- API: **Jest** (Nest default) unit + integration (supertest against a real test Postgres).
- Web: **Vitest** + React Testing Library.
- E2E: **Playwright** (Chromium is pre-installed in the cloud container; run with `--trace off`).
- External APIs mocked with **MSW**/nock fixtures. Anthropic always mocked in tests.
- CI: GitHub Actions — lint, typecheck, unit, integration (service containers), build, E2E smoke.

### D-012 · Exports · PROPOSED → **CONFIRMED** (renderer decided)
Markdown + copy-to-clipboard (all docs), **PDF** (server-side via headless Chromium or
`@react-pdf/renderer`), **DOCX** (`docx` npm package). Decide renderer in P03.

### D-013 · Hosting target · PROPOSED · **USER DECISION in P03 or P15** → **DEFERRED to P15** (user)
Docker Compose for self-hosting (must work). Recommended managed setup: web on Vercel; API +
worker on Fly.io/Render/Railway; managed Postgres (Neon/Supabase/RDS) and Redis (Upstash/Redis
Cloud). Final pick in P15.

### D-014 · Product scope for v2.0 · PROPOSED · **USER DECISION in P03** → **CONFIRMED** (user: individual only)
In scope: individual engineer experience end-to-end with GitHub, all document types, KPIs,
career timeline, achievements journal (manual wins), goals, weekly digest.
Stretch / v2.1: GitLab/Jira/Linear (P13), manager/team views, billing (Stripe).

---


## Confirmed decisions

Recorded by Phase 03 on 2026-11-09. User answers were collected in two rounds of structured
questions (7 questions); every answer matched the recommended option. Full reasoning in the linked ADRs.

> Numbering: Phase 02 merged first and used D-015 and D-016 (see *Implementation decisions* below),
> so the new decisions from Phase 03 are D-017 to D-019.

### D-001 · Monorepo & tooling · CONFIRMED · P03
**Summary:** npm workspaces (`apps/web`, `apps/api` with HTTP + worker entries, `packages/shared`);
`shared` is the single source of Zod schemas, enums, period utils and metric metadata; no Turborepo.
**Rationale:** small codebase; drift comes from unused `shared`, not tooling.
**Consequences:** build order via scripts; revisit Turborepo if CI > 10 min.
**ADR:** [ADR-0001](blueprint/adr/ADR-0001-monorepo-and-tooling.md)

### D-002 · Runtime & framework versions · AMENDED · P03
**Summary:** Node 22 LTS; NestJS 11; latest Prisma major; Zod 4; latest BullMQ, octokit,
`@anthropic-ai/sdk` 1.x; ESLint flat config; Postgres 16 / Redis 7. Next.js patched to 14.2.x in
P02, upgraded to 16.x + React 19 + Tailwind v4 in P09. *Amendment:* explicit Zod 4 / Prisma-major /
TypeScript 5.x targets and exact pinning for auth, Prisma and the Anthropic SDK. P02 applied the
backend part with pins recorded in D-015 (Prisma 6.19, SDK 0.24 kept); remaining majors → DEBT-10.
**ADR:** [ADR-0002](blueprint/adr/ADR-0002-runtime-and-framework-versions.md)

### D-003 · Authentication · CONFIRMED · P03 · **USER DECISION**
**User answer:** "Better Auth in web (Recommended)".
**Summary:** Better Auth in `apps/web` (GitHub OAuth App + Google, Prisma adapter, encrypted OAuth
tokens, account linking by verified email). JWT plugin issues 15-minute EdDSA tokens; NestJS
`AuthGuard` verifies via JWKS; `x-user-id` removed. Dev login only via web `/api/dev-login` when
`NODE_ENV !== 'production' && ENABLE_DEV_LOGIN === 'true'`.
**ADR:** [ADR-0003](blueprint/adr/ADR-0003-authentication.md)

### D-004 · GitHub data source · CONFIRMED · P03 · **USER DECISION**
**User answer:** "GitHub App (Recommended)".
**Summary:** Sign-in (OAuth App, identity scopes) is separate from the data source, a read-only
GitHub App (Metadata, Contents, Pull requests; webhooks; expiring user tokens with refresh).
v0.1 OAuth integrations migrate to `NEEDS_REAUTH`.
**ADR:** [ADR-0004](blueprint/adr/ADR-0004-github-data-source.md)

### D-005 · Token encryption · AMENDED · P03
**Summary:** AES-256-GCM, format `v<n>.<iv>.<ct>.<tag>`, AAD bound to integration + field,
`TOKEN_ENCRYPTION_KEYS` list + `TOKEN_ENCRYPTION_ACTIVE_KEY`. *Amendment:* legacy plaintext tokens
are dropped rather than encrypted (unusable with the GitHub App).
**ADR:** [ADR-0005](blueprint/adr/ADR-0005-token-encryption.md)

### D-006 · API conventions · AMENDED · P03
**Summary:** D-006 envelope + status codes, Zod pipe from `shared`, OpenAPI at `/api/docs`
(non-prod), no URI versioning. *Amendments:* cursor pagination by default; one `period` grammar
(`month:|quarter:|half:|year:|custom:`); fixed error-code list; rate-limit classes; SSE rules.
**ADR:** [ADR-0006](blueprint/adr/ADR-0006-api-conventions.md) · Contract: [API_CONTRACT_V2](blueprint/API_CONTRACT_V2.md)

### D-007 · Deterministic metrics & impact score · CONFIRMED · P03 · **USER DECISION**
**User answer:** "Deterministic, overall + dimensions (Recommended)".
**Summary:** `metrics@2.0.0` catalogue and `impact@2.0.0`: overall 0–100 plus Delivery (30 %),
Quality (25 %), Collaboration (30 %), Ownership (15 %); absolute bands with saturation, k = 3
shrinkage, minimum-data thresholds, stored inputs and explanation. The LLM never produces numbers.
**ADR:** [ADR-0008](blueprint/adr/ADR-0008-metrics-engine-and-impact-score.md) · Spec: [KPI_METHODOLOGY](blueprint/KPI_METHODOLOGY.md)

### D-008 · Sync strategy · AMENDED · P03
**Summary:** worker process; GraphQL search (`author:` / `reviewed-by:`), `contributionsCollection`
for repo discovery and per-repo `history` for commits; cursors; newest-30-days-first backfill;
24 h jittered schedule; GitHub App webhooks; `SyncRun` persistence; rate-limit reschedule.
*Amendments:* repo discovery via contributions (not the REST repo list), budget **≤ 250 requests**
for the P06 reference fixture, status independent of Redis.
**ADR:** [ADR-0007](blueprint/adr/ADR-0007-sync-strategy.md)

### D-009 · AI generation · AMENDED · P03
**Summary:** model IDs from env — `ANTHROPIC_MODEL_DEFAULT=claude-opus-5-5`,
`ANTHROPIC_MODEL_FAST=claude-haiku-5-5`; structured output via `output_config.format` + Zod + one
repair; generation runs in the worker and streams through Redis Streams to an SSE relay; inputHash
cache; deterministic EvidenceBuilder + citation verification; retry only retryable errors; refusal
fallback; `AiUsage` + per-plan quotas. *Amendments:* default tier is the current Opus (quality
first, configurable; P08 evals may switch to `claude-sonnet-5-5`); worker execution instead of
in-request streaming.
**ADR:** [ADR-0009](blueprint/adr/ADR-0009-ai-generation.md)

### D-010 · Frontend data layer · AMENDED · P03
**Summary:** typed `apiClient` on shared Zod schemas + TanStack Query, RSC prefetch, route-level
`loading`/`error`. *Amendments:* Bearer-JWT client with token refresh; fetch-based SSE (no
`EventSource`); global period in the URL.
**ADR:** [ADR-0010](blueprint/adr/ADR-0010-frontend-data-layer.md)

### D-011 · Testing stack · CONFIRMED · P03
**Summary:** Jest + supertest (API, real Postgres/Redis), Vitest + RTL (web, shared), Playwright +
axe (E2E), MSW GitHub fixtures, mock Anthropic via `ANTHROPIC_BASE_URL`, evals, GitHub Actions CI.
**ADR:** [ADR-0011](blueprint/adr/ADR-0011-testing-strategy.md)

### D-012 · Exports · CONFIRMED · P03
**Summary:** Markdown/plain text serializer, PDF via `@react-pdf/renderer`, DOCX via `docx`, from one
export-blocks IR; `GET /documents/:id/export`.
**ADR:** [ADR-0012](blueprint/adr/ADR-0012-exports.md)

### D-013 · Hosting · DEFERRED to P15 · P03 · **USER DECISION**
**User answer:** "Decide in P15 (Recommended)".
**Summary:** platform-neutral constraints are binding now (Compose always works; stateless web/api/
worker images; Postgres 16 + Redis 7; env-only config; SSE-capable proxy). Final platform chosen in P15.
**ADR:** [ADR-0013](blueprint/adr/ADR-0013-hosting.md)

### D-014 · Product scope v2.0 · CONFIRMED · P03 · **USER DECISION**
**User answer:** "Individual only (Recommended)".
**Summary:** individual engineer end-to-end on GitHub (PRD §5). Manager/team views, Stripe billing,
share links → v2.1. FREE/PRO plans enforced without billing.
**ADR:** [ADR-0014](blueprint/adr/ADR-0014-product-scope-v2.md) · [PRD](blueprint/PRD.md)

### D-017 · Brand / visual direction · CONFIRMED · P03 · **USER DECISION**
**User answer:** "Calm, professional, Linear-like (Recommended)".
**Summary:** neutral surfaces, one restrained accent, crisp typography, dense-but-airy data views,
subtle motion; credible in front of a manager. Binding input for P04's design system.
**Consequences:** P04 tokens/prototype follow this direction; celebratory/gamified patterns are avoided (consistent with the fairness principle).

### D-018 · Additional integrations out of v2.0 · CONFIRMED · P03 · **USER DECISION**
**User answer:** "Out — v2.1 (Recommended)".
**Summary:** Phase 13 (GitLab, Jira, Linear) is skipped for v2.0 and moved to the v2.1 roadmap.
P06 still builds the `ActivityProvider` abstraction. Issue metrics (`issues_completed`,
`story_points_completed`) are specified but deferred. ISSUES GAP-10 → won't fix in v2.0.
**ADR:** [ADR-0014](blueprint/adr/ADR-0014-product-scope-v2.md)

### D-019 · Time zones and period semantics · CONFIRMED · P03
**Summary:** every user has an IANA timezone (default UTC, prefilled at onboarding); periods are
inclusive local-date ranges mapped to half-open UTC instants; ISO weeks (Monday start); business
hours exclude Saturday/Sunday; AI quotas reset on UTC calendar months.
**Rationale:** fixes BUG-05/06; one shared implementation for API and web.
**Spec:** [KPI_METHODOLOGY §2.4–2.5](blueprint/KPI_METHODOLOGY.md#24-periods-and-time-zones)

---

## Implementation decisions (appended by phases)

### D-015 · P02 dependency versions · APPLIED (P02)
Within D-002, P02 pinned: Node 22, **NestJS 11** (not 12), **Prisma 6.19** (not 7/8),
TypeScript 5.9, ESLint 9, zod 4.6, Next 14.2.35, BullMQ 5.81; `@anthropic-ai/sdk` stays 0.24 (P08).
*Rationale:* the phase allows only behaviour-preserving majors. Prisma 7+ requires driver adapters,
`prisma.config.ts` datasource config and an ESM client — best done with data model v2 (P05/P06).
NestJS 12 appeared after the plan was written. typescript-eslint supports TS < 6.1; ESLint 10
removed APIs the Next 14 plugin uses. Tracked as DEBT-10.
*Consequences:* later phases upgrade from these baselines; zod 4 API (`z.iso.*`, `z.url()`, `error`
param) is the standard in `packages/shared`.

### D-016 · Monorepo tooling conventions · APPLIED (P02)
- One root ESLint flat config (`typescript-eslint` strict-type-checked + stylistic, `import-x/order`,
  Next + react-hooks for web, Prettier last). Disables need a reason comment.
- Each workspace has `tsconfig.json` (typecheck/lint/tests, no emit) and, where it emits,
  `tsconfig.build.json`. API compiles with `module: nodenext` (typed ESM-only deps such as octokit,
  CommonJS output via Node 22 `require(esm)`).
- `packages/shared` emits CommonJS + `.d.ts` to `dist/`; `scripts/postinstall.mjs` builds it and
  generates the Prisma client after every install.
- Config: one root `.env` read by API, worker, Prisma CLI, seed and Next.js (`next.config.js` loads
  it); Zod env schemas in `apps/api/src/config/env.ts` and `apps/web/src/env.ts`. Redis via
  `REDIS_URL`, API port `API_PORT`, web origin `WEB_URL`.
- Tests: API Jest (`*.spec.ts` unit, `test/integration/*.int-spec.ts` integration against
  `DATABASE_URL_TEST`), web/shared Vitest, Playwright in `e2e/`. Known bugs are `it.skip`/`it.todo`
  tagged with issue IDs.
- Processes: `src/main.ts` (HTTP) and `src/worker.ts` (queues). `RUN_WORKER_IN_API` (default true)
  controls whether the API also runs processors; compose runs a dedicated worker.

### D-020 · v2.0 UX, design system and prototype approved · CONFIRMED · P04 · **USER DECISION**
**User answer:** "Approve as-is (Recommended)" (2026-11-16, after reviewing the clickable prototype,
version 2: https://claude.ai/artifact/7sRsUMg2VuwC1A5J4m9xFB).
**Summary:** `design/IA.md`, `FLOWS.md`, `DESIGN_SYSTEM.md`, `tokens.css` and `SCREENS.md` are binding
for P09–P12. Key choices: grouped sidebar (Overview / Create / Settings) with a mobile bottom bar +
drawer; global period in the URL (`?period=`); calm Linear-like tokens (cool slate neutrals, one
indigo accent `#4351c8` / `#8d97f2`, Instrument Sans + JetBrains Mono for evidence refs); deltas are
descriptive (neutral ink + arrow) and semantic colour is reserved for system state; validated
3-series chart palette and indigo heat ramp; evidence chips on every AI claim; designed loading /
empty / partial / error / success states for every screen; WCAG 2.2 AA spec (39/39 token contrast
pairs, axe 0 violations on the prototype).
**Consequences:** P09 imports `design/tokens.css`, installs the shadcn components listed in
DESIGN_SYSTEM §11 and builds the custom components in §5.2. Routes in IA.md replace the provisional
ones (TRACEABILITY updated). Additive API amendments A-1…A-5 (API_CONTRACT_V2 §22) are owned by
P06–P08. Changing a token value, route or state pattern later needs a new decision entry.

### D-021 · P05 implementation choices (auth, platform) · APPLIED (P05)
Within D-003/D-005/D-006 and ADR-0003–0006, Phase 05 chose:
- **Versions:** Better Auth **1.7.25** (exact pin; schema reconciled with `npx auth@1.7.25 generate`,
  the CLI package that replaced the deprecated `@better-auth/cli`); `jose` 6 for JWKS verification;
  `@nestjs/throttler` 6, `nestjs-pino` 4, `helmet` 8. **Prisma stays 6.19** (Better Auth supports it;
  pinned exact): the Prisma 7 major (driver adapters, ESM client) moves to P06 with the activity v2
  migrations (DEBT-10).
- **Ids:** Better Auth `advanced.database.generateId: false`, so users/sessions/accounts/jwks get
  Prisma `cuid()` ids like every other table (`Id` schema = cuid shape, without zod's deprecated `z.cuid()`).
- **Columns:** new tables and new columns use snake_case `@map`; existing v0.1 camelCase columns
  (`users."createdAt"`, `integrations."userId"`…) are not renamed in P05.
- **Throttler storage:** a small Lua-based Redis `ThrottlerStorage` (fixed window, key
  `devimpact:rl:<window>:<user|ip>`) instead of a third-party storage package; rate-limit classes are
  route metadata (`@RateLimit('ai')`), keyed per user after the AuthGuard (guard order is explicit in
  `AppModule`). Headers `RateLimit-*` and `Retry-After`.
- **OpenAPI:** generated from controller metadata (`@ZodBody/@ZodQuery/@ZodParams/@ApiDoc`) with
  zod 4's `z.toJSONSchema`; Swagger UI served from `swagger-ui-dist` (no CDN, no inline script).
- **Dev login:** never creates users; signs in an existing (seeded) user by setting a fresh random
  password on a `credential` account per call and calling Better Auth's email sign-in server-side
  (email/password enabled only with dev login, sign-up disabled); same-origin check; the session
  token is never echoed in the body.
- **E2E:** dev login is impossible in a production build by design, so signed-in E2E flows run
  against `next dev` (`NEXT_DIST_DIR=.next-e2e`) while a production server on :3001 proves the 404.
- **Secrets:** `.env.example` ships labelled dev-only secrets that both apps refuse when
  `NODE_ENV=production`; Docker Compose uses separate public compose-local defaults (overridable from
  `.env`) so `docker compose up` works without setup — documented as unsafe for exposed deployments.
- **Transitional v1 endpoints** (`/sync/trigger`, `/generate/*`, `/activity/summary`) keep v1 data
  shapes but use the v2 envelope, status codes, validation and rate classes; `POST /integrations/github/callback`
  returns `syncRun: null` (+ `returnTo`) until `SyncRun` exists (P06); the callback body also accepts
  `error`/`errorDescription` (denied consent) and omits `code` for `setupAction=request` (additive).
*Consequences:* later backend phases follow the "adding an endpoint" pattern in the root README; P06
owns the Prisma major, token refresh and `SyncRun`; P09 replaces the functional sign-in/auth-context.

### D-022 · P06 implementation choices (sync engine, Prisma 7) · APPLIED (P06)
Within D-004/D-005/D-008 and ADR-0004/0007, Phase 06 chose:
- **Prisma 7.10.1** (DEBT-10): the latest *stable* major — `latest` on npm is 8.0.0-rc and Better Auth
  1.7.25's Prisma adapter accepts `^5 || ^6 || ^7`. Pinned exact in api and web. Queries go through the
  `pg` driver adapter (`@prisma/adapter-pg`, `src/prisma/create-client.ts`); the datasource URL moved to
  `prisma.config.ts`. The `prisma-client-js` generator is kept (still supported in 7) so no import paths
  change; the ESM `prisma-client` generator can follow with Next 16 (P09). `prisma` and `@prisma/client`
  are also root devDependencies: without them npm 10 nested a copy per workspace (two generated
  clients). `pg` is an API devDependency for the migration test.
- **Octokit:** `@octokit/core` + `@octokit/plugin-throttling` + `@octokit/plugin-retry` directly (the
  `octokit` meta-package is dropped). One instance per job; tokens injected per request (refresh-safe);
  primary rate limits are never slept on inside a job (checkpoint + delayed job instead). The throttling
  plugin paces POSTs — GraphQL included — 1 s apart, keyed **per integration** (`throttle.id`), not
  globally; `GITHUB_THROTTLING=false` disables pacing (tests only). Jest transpiles the ESM packages
  like `jose` (no stub), and tests intercept `fetch` with an in-process fake GitHub (REST + the exact
  GraphQL documents) instead of MSW — the pattern P05 established (`test/utils/fake-github.ts`).
- **Fetch shape:** commit history is fetched for up to 10 repositories per GraphQL request (aliases),
  so the call count follows commit pages, not repositories. Backfill = newest 30 days, then calendar-
  month slices backwards for every stage. Reference fixture: 119 requests / ~680 points (budget 250 /
  2,500).
- **Job ids** `sync-<integrationId>` / `sync-t-<deliveryId>`: BullMQ custom ids cannot contain `:`.
  Uniqueness of active runs is also enforced in Postgres (row lock + active-run check); a queued/
  running run whose job vanished for > 2 minutes is reaped so Redis loss never blocks syncing.
- **Rate classes:** `sync` (6/hour) is enforced **per integration** inside `SyncService` (the
  integration is only known after the body is resolved), so the guard skips that class; `webhook` is
  a no-window class (never throttled).
- **Repository inclusion:** PR searches cannot be filtered by repository, so PRs/reviews of excluded
  repos are still stored but every read filters `repository.included`; commits of excluded or
  inaccessible repos are never fetched. Re-including a repo makes the next incremental run fetch its
  missing history (stale `commitCursor`).
- **Legacy data (P06-2/3):** stub detection keeps the blueprint's title/state/review rules but replaces
  `body IS NULL` (the P01 fixture's stubs carry a marker body) with the stricter
  `title = 'PR #' || number AND mergedAt IS NULL`. v0.1 reviews stored on *another* user's PR (P02 demo
  seed) get a reviewer-owned copy of that PR (`is_authored_by_user = false`, no body), so every review
  points at its owner's row (ARCHITECTURE_V2 §12).
- **Webhooks:** the API parses the event into a normalised `ProviderWebhookEvent` (job payload, no raw
  body); unhandled events are stored as `IGNORED` without a job; targeted work is recorded as `TARGETED`
  sync runs (visible in `/sync/runs`, excluded from `/sync/status` current/last run). Installation
  events use an **installation token** (App JWT, `GITHUB_APP_PRIVATE_KEY[_FILE]`) only to refresh
  repositories a user already has, then queue a sync that lists new repositories with that user's own
  token — an installation's full repo list is not filtered by what each linked user may see (security
  review).
- **Token lifecycle:** refresh 10 minutes before expiry or after a 401, under `SELECT … FOR UPDATE` on
  the integration row; on refusal (or `github_app_authorization.revoked`) the integration becomes
  `NEEDS_REAUTH` with tokens dropped and data kept.
- **API details (additive):** `GET /activity/prs?role=` defaults to `authored` (the contract marks it
  required; P07 may make it required); `GET /repos` uses an opaque offset cursor because its default sort
  is by name; webhooks answer 202 for duplicates too (`duplicate: true`); `GET /sync/stream` (Should) is
  not built — the polling contract is complete (P10 decides).
*Consequences:* P07 consumes `metrics.recompute { userId, from, to, reason }` and reads only
`isAuthoredByUser`, `legacyStub = false` and `repository.included` rows; P09 can move to the ESM Prisma
generator; P14 adds the retention jobs (`SyncRun`, `WebhookDelivery`) and Bull Board.

### D-023 · P07 implementation choices (metrics engine, impact score) · APPLIED (P07)
Within D-007/D-019 and ADR-0008, KPI_METHODOLOGY `metrics@2.0.0` / `impact@2.0.0` (formulas,
thresholds, anchors, weights and rounding unchanged), Phase 07 chose:
- **Samples with unknown data:** PRs whose size GitHub did not report (`additions`/`deletions`
  null, legacy rows) are left out of `small_pr_ratio` and `pr_size_median_lines` (their `n` counts
  sized PRs); PRs with a null `changesRequestedCount` are left out of `first_pass_approval_rate`.
  Caveat text added to the catalogue. Reviews on v0.1 `legacyStub` PRs never count.
- **Evidence ids (§7):** counts → the counted records; medians → the sample; ratios → the
  numerator (e.g. reverted PRs); reviewed PRs → the first review in the period (`REV-` refs);
  repository/day/week metrics → one representative (newest) record per repo/day/week. Newest
  first, capped at 200, `evidenceTruncated` flag.
- **In-progress periods (§2.4):** `ResolvedPeriod.endDate` = today (display and data window),
  `periodDays` = full calendar length; deltas compare the same elapsed days of the previous period
  (`comparison: 'same_elapsed'`, clipped to the shorter month). Cache rows are keyed by the
  displayed end, so an in-progress period gets a new row per day (old rows are invalidated by
  recomputes / retention in P14).
- **Insufficient scores (§5):** overall and dimension scores and component band/shrunk scores
  are `null`; component values and `n` stay visible. The explanation is the §5 copy + version.
- **Impact cache:** `ImpactScore` lookups also match the user's current time zone; a time-zone
  change deletes the user's scores and other-zone snapshots synchronously (PATCH `/me/settings`,
  `meta.recomputeQueued`) and queues a full-history recompute. Concurrent misses tolerate the
  unique-key race (P2002 → keep the other row; identical inputs).
- **Recompute queue:** `enqueueRecompute` merges `[from, to]` per user in Redis
  (`devimpact:metrics-pending:<prefix>:<userId>`, Lua min/max) and adds one delayed job per user
  with BullMQ deduplication in debounce mode (`id metrics-<userId>`, `extend` + `replace`; 30 s,
  1 s for `timezone`/`repository_inclusion`); the consumer unions job + pending ranges and
  drains new ranges (≤ 5 rounds). Reasons extended with `timezone`, `nightly`, `manual`.
  `metrics.nightly` = BullMQ job scheduler `metrics-nightly` `30 2 * * *` UTC: last 35 days of
  every user with an ACTIVE integration, full history for users without snapshots.
- **Snapshots:** only days with a counted event are stored (reads fill zeros); heatmap `count` =
  commits + PRs opened + reviews (the `active_days` contributions); `reviewComments` =
  Σ (comments + body); `achievements` stays 0 until P12.
- **Timeseries:** count metrics (`commits`, `prs_opened`, `prs_merged`, `active_days`) from
  snapshots; every other metric (incl. distinct `prs_reviewed`) from one fact load per request,
  computed per bucket; ISO-week / calendar-month buckets clipped to the range; ≤ 400 points
  (`VALIDATION_FAILED` on `query.interval` otherwise); future days are clipped to today.
- **Activity (§11):** lists and the feed exclude merge commits (same `CM` set as the metrics);
  `GET /activity/prs` now requires `role`; `sort=-changedLines` uses an opaque offset cursor;
  feed item ids are `<type>:<rowId>` (`meta.recordId` = the row id). Deprecated
  `/activity/summary`: `totalPRs` = PRs **merged** in the range, `impactScore: null`,
  `Deprecation`, `Sunset: Mon, 01 Mar 2027 00:00:00 GMT` and `Link` to `/metrics/overview`.
- **Additive contract fields** (API_CONTRACT_V2 allows them): `KpisResponse.previousPeriod/
  comparison/metricsVersion`; `MetricDefinition.direction`; `ImpactDto` component
  `effectiveWeight/available`; history points `band/scoreVersion`; heatmap `from/to/total/
  activeDays`; repos `period/total`; evidence `meta.truncated`; PR items `isAuthoredByUser/
  authorLogin`; career `timezone`, quarter `inProgress`, repo `truncated/totalItems`, review
  cluster `count`. `ImpactDto.highlights` is always `null` until P08 (typed hook).
- **Removed:** `GET /generate/impact-score`, `AIService.calculateImpactScore` and the
  `calculate-impact` prompt (AI-01, API-04). v1 generators take appraisal/promotion ranges as local
  dates in the user's time zone (BUG-06).
- **Values on the wire** are full precision (hours, ratios); only the UI rounds (§2.6).
*Consequences:* P08 reads `ImpactScore.inputs` (metrics, evidence ids) for prompts and adds
`POST /impact/highlights`; P10 builds S6–S10 on these endpoints and removes `/activity/summary`;
P12 fills `achievements` in snapshots, feed and timeline; P14 adds retention for old/in-progress
score rows and the fixes logged as DATA-12/PERF-06.

### D-024 · P08 implementation choices (AI layer) · APPLIED (P08)
Within D-009/D-007/D-019 and ADR-0009 (models, structured output, worker + Redis Streams, quotas
unchanged), Phase 08 chose:
- **SDK & client:** `@anthropic-ai/sdk` **1.9.0** (exact pin, DEBT-10). One `AiClient` on
  `client.beta.messages.stream(...).finalMessage()` (the beta surface carries the server-side
  refusal `fallbacks: "default"` + beta `server-side-fallback-2026-07-01`, sent on the default tier
  only — Haiku has no server-side fallback). `thinking: { type: 'adaptive' }`, explicit
  `output_config.effort` (`AI_EFFORT_DEFAULT=medium`, `AI_EFFORT_FAST=low`) and
  `output_config.format` from `zodOutputFormat(schema)`. SDK `maxRetries: 0`; our loop retries
  only 429/5xx/529/connection/408/409, with full-jitter exponential backoff, honouring
  `retry-after`, and **never after text has streamed** (no duplicated output). HTTP status decides
  the class; error `type` only for mid-stream errors without a status.
- **Model tiers:** documents on `ANTHROPIC_MODEL_DEFAULT` (`claude-opus-5-5`); impact highlights,
  achievement statements, digest summaries **and the repair call** on `ANTHROPIC_MODEL_FAST`
  (`claude-haiku-5-5`) — API_CONTRACT_V2 §10 / ARCHITECTURE_V2 §8 (fast highlights) win over the
  ADR line listing highlights under the default tier. No Opus/Sonnet switch without a live eval (AI-10).
- **Prompts:** model outputs are small, flat schemas (no ids, flags or metrics); `toContent` adds
  item ids (`b1`, `kc1`…) and engine sections; stored content schemas live in
  `packages/shared/src/api/documents.ts` (`CONTENT_SCHEMAS`). Evidence goes to the model as JSON in
  `<evidence>` with `<`, `>`, `&` \u-escaped (the closing tag can never appear inside), control/bidi
  characters stripped, per-field caps. The repair prompt is `repair.v1`.
- **Evidence:** pure `buildEvidencePack` (ranking: merged, size band capped above 1,000 lines,
  reviewers, changes requested, commits, tags such as incident/performance/security, description;
  reverted −3) with caps 40 PRs / 15 reviews (one per reviewed PR) / 10 commits (not already
  covered by a selected PR) / 20 achievements; smaller caps for quick actions. Evidence versions for
  `inputHash` use stable fields (`updatedAtRemote`/`mergedAt`, review `submittedAt`, commit
  `authoredAt`), not `syncedAt`, so a sync without changes keeps the cache. Metric lists use catalogue
  order (JSONB round-trips reorder keys). Redaction (F-76): private repos become `private/repo-N`
  in names **and refs** sent to the model; the verifier maps alias refs back to real refs.
- **Documents:** `POST /documents` returns `200 { cached: true }` for an existing READY *or
  in-flight* document with the same hash (no duplicate parallel generations); 409 `no_evidence`
  when the pack is empty. Regenerate keeps the document id and writes the next version; a section
  regenerate runs the full prompt and merges one section (AI-12). User edits keep engine sections
  from the base version, re-verify citations against `evidenceRefs`, and update the last
  `user_edit` version in place within 30 s (autosave). Legacy imports are read-only (409
  `legacy_document`). Library default lists studio types + impact narratives; achievement and
  digest documents only with `?type=`. Additive contract fields: `DocumentSummary.errorCode`,
  `HighlightsResponse.evidence`, `CreateDocumentResponse.cached/streamUrl` on both 200 and 201.
- **Schema (P08-1):** as DATA_MODEL_V2 plus `flags_uncited` / `flags_invalid` columns (A-5 badges
  without loading content); legacy rows imported as `{ legacy: true, raw }` v1 versions
  (`prompt_id = 'legacy'`, `input_hash = 'legacy:'||id`, period from `dateRange`). A `KPI` row would
  make the enum cast fail loudly rather than be dropped.
- **Streams & SSE:** stream key `devimpact:doc-events:<QUEUE_PREFIX>:<id>` (MAXLEN ~2000, TTL
  `AI_STREAM_TTL_SECONDS`), cancel flag `devimpact:doc-cancel:…` polled every 500 ms by the worker;
  dedicated ioredis connections without `keyPrefix` (blocking XREAD). The API writes the first
  `status: pending` event at creation; deltas are coalesced (≥ 250 ms) to stay under MAXLEN.
  A finished document (or an expired stream) is answered with `status` + its terminal event from
  the database. `sse` rate class = Redis counter (10 concurrent per user) in the stream service; a
  connection is capped at 15 minutes (clients resume with `Last-Event-ID`).
- **Queue:** `ai` queue, job ids `ai-<documentId>-<version>`, attempts 1 (retries live in the client);
  quick actions are `ai.quick` jobs awaited with `QueueEvents` (quick timeout + 2 s) — the same
  `DocumentGenerationService` runs both, without stream events for quick types. Digest summaries
  are generated in-process by `DigestSummaryService.summarize(userId, weekStart)` (worker-only,
  returns `null` instead of failing the digest).
- **Quotas:** counted from `AiUsage.countsTowardQuota` (successful primary call of a successful
  generation) per UTC month, plus generations currently pending/streaming. `ENTITLEMENTS_JSON` is
  validated at startup and merged per plan by `limitsFor()`.
- **Tests & evals:** an in-process fake Messages API (`test/utils/fake-anthropic.ts`, SSE like the
  real API) behind `ANTHROPIC_BASE_URL`, so the real SDK path is exercised; integration tests run an
  in-process BullMQ worker. Evals (7 personas × 6 generators) run in `npm test` from committed
  recordings; without a key in P08 the recordings are **synthetic** (deterministic reference writer)
  and negative controls prove each check fails on bad output. `npm run eval:live` writes
  `docs/v2/evals/REPORT.md`.
*Consequences:* P11 consumes the SSE contract and document endpoints (PROGRESS P08 handoff); P12
binds `ACHIEVEMENT_SOURCE`, calls `DigestSummaryService` and builds the plan/usage page on
`/me/usage`; P14 runs the live eval (AI-10/11), adds `AiUsage`/stream retention (OPS-18) and cost
dashboards.

### D-025 · P09 implementation choices (frontend foundation) · APPLIED (P09)
Within D-002/D-010/D-020, ADR-0003 and ADR-0010, Phase 09 chose:
- **Versions (exact pins, checked on npm 2026-11-18):** Next.js **16.4.6** (latest stable major;
  `latest` on npm), React / React DOM **19.3.1**, `@types/react(-dom)` 19.3.0, Tailwind CSS +
  `@tailwindcss/postcss` **4.3.5**, `tw-animate-css` 1.4.0, `@tanstack/react-query` **5.108.0**,
  `next-themes` 0.4.6, `radix-ui` 1.8.1, `cmdk` 1.1.1, `sonner` 2.0.8, `lucide-react` 1.74.0,
  `react-day-picker` 9.14.0 (shadcn calendar targets v9, not v10), `react-hook-form` 7.92.0,
  `@hookform/resolvers` 7.0.7, `recharts` 3.11.0, `tailwind-merge` 3.7.0, `vitest` **5.1.0** (web +
  shared), `@vitejs/plugin-react` 6.3.0 (Vite 8, `resolve.tsconfigPaths` replaces
  `vite-tsconfig-paths`), `@next/eslint-plugin-next` 16.4.6 (flat config, no `@eslint/compat`),
  `@axe-core/playwright` 4.14.0. **Better Auth 1.7.25 is kept:** its peer ranges already allow
  `next ^16`, `react ^19` and `vitest ^5`. Root `overrides` pin `react`, `react-dom` and
  `@types/react(-dom)` because stale lockfile entries otherwise hoisted React 18 next to React 19.
- **Upgrade path:** official codemods `middleware-to-proxy` (`src/proxy.ts`, Node runtime) and
  `next-async-request-api` (async `searchParams`), then manual changes from the bundled Next 16
  guide (`node_modules/next/dist/docs`; nextjs.org is not reachable from the sandbox):
  `experimental.outputFileTracingRoot` → `outputFileTracingRoot`, `turbopack.root`, no `eslint`
  key, error boundaries use `retry()`. `next typegen` runs before `tsc`. `AGENTS.md`, which
  `next dev` writes, is committed so the tree stays clean.
- **E2E dev server:** `NEXT_DIST_DIR=.next-e2e` (D-021) is no longer used. Next 16 writes dev output
  to `.next/dev`, separate from the production build. Its dev log inside a custom distDir also
  started an endless Fast Refresh reload loop. Placeholder GitHub/Google client ids make the
  sign-in page render its provider buttons. No test follows them.
- **shadcn/ui:** `ui.shadcn.com` is unreachable from the sandbox, so the CLI cannot fetch the
  registry. The new-york-v4 sources of every component in DESIGN_SYSTEM §11 were taken from the
  shadcn-ui/ui GitHub repository (`apps/v4/registry/new-york-v4/ui`) and adapted to the tokens:
  radius by role, the single global focus ring (2 px `--ring` + 2 px offset instead of shadcn's
  3 px ring), `surface` controls and 16 px inputs below 768 px. Button and badge variants follow
  DESIGN_SYSTEM §5.1. `components.json` is committed, so `npx shadcn add` works when the registry
  is reachable (DEBT-13). The custom sidebar implements IA §3 breakpoints (≥ 1024 / 768–1023 /
  < 768); the shadcn `sidebar` primitive switches at 768 px, so it is installed but not used.
- **Tokens:** `docs/v2/design/tokens.css` is copied byte-for-byte to `apps/web/src/styles/tokens.css`
  (Prettier-ignored). `npm run check:tokens` (CI) runs the contrast checker against the app copy
  and `cmp`s the two files. Fonts come from `next/font/google` as `--font-instrument-sans` /
  `--font-jetbrains-mono`, mapped onto the token `--font-sans` / `--font-mono`.
- **Data layer:** `createApiClient` (`src/lib/api/client.ts`) is shared by the browser client
  (`browser.ts`: in-memory JWT from `getApiToken()`, one refresh on 401, then
  `/sign-in?callbackUrl=…&reason=session_expired`) and a server client (`server.ts`:
  `auth.api.getToken` + `API_INTERNAL_URL`). Responses are validated with the shared Zod
  schemas. A mismatch is a typed `INVALID_RESPONSE`. `ApiError` adds `NETWORK_ERROR` /
  `INVALID_RESPONSE` to `ERROR_CODES`. Queries retry at most twice, and only on network/5xx errors.
  `staleTime` is 30 s and window-focus refetch is off. The `(app)` layout prefetches `/me` on the
  server and hydrates it (PERF-04).
- **Period:** when the URL has no `?period=`, the API param is omitted and the query key uses
  `'default'` (no waterfall behind `/me`; the API applies the same default). The picker label
  resolves the default on the client with `periodSpecContaining(defaultPeriodType,
  todayIn(timezone))`.
- **Lint guards:** `no-alert`, plus a `no-restricted-syntax` ban on `fetch()` outside `lib/api`,
  `auth-client.ts`, route handlers and tests, and on Tailwind palette colour classes (UX-11). The
  vendored `components/ui` relaxes 7 type-aware rules for upstream idioms.
- **Routes:** interim pages moved to their IA routes, with temporary redirects in `next.config.js`
  (`/connect` → `/settings/integrations`, `/settings` → `/settings/profile`, `/resume|/appraisal|
  /promotion` → `/documents/new/*`). `ConnectReturnTo` drops `/connect`. IA destinations owned by
  P10–P12 render a "Not available yet" placeholder, so navigation is complete and no link 404s.
  The GitHub callback lives in a minimal `(system)` group.
- **Onboarding specifics:** `/` and `/onboarding` redirect on the server from `GET /me`. Each step
  saves `onboardingStep`. Step 1 prefills the browser time zone **only when the stored time zone
  is still the default `UTC`**, so an explicit choice is never overwritten. When GitHub is
  already connected, step 1 shows "GitHub connected as @login · Continue" instead of
  auto-skipping (Back from step 2 stays usable). "Finish later" leaves the step saved. The
  callback remembers the starting page in `sessionStorage` so errors land on the right page with
  a designed banner (`?error=denied|expired|in_use|entitlement|upstream|failed`).
*Consequences:* P10–P12 replace the placeholder pages and interim views with the designed screens
using the catalogue in `components/states` and `lib/api` (README → "Adding a page"); P11 builds
on `useEventStream` + `parseDocumentEvent`; the redirects and placeholders are removed when the
designed pages ship.

### D-026 · P10 implementation choices (insight pages) · APPLIED (P10)
Within D-007/D-010/D-020/D-025, SCREENS S6–S10/S19 and ADR-0010, Phase 10 chose:
- **"Turn into achievement" before P12:** the item drawer calls `POST /ai/achievement-statement`
  (authored PRs and own commits only; fast model, quick quota) and shows the drafted title,
  statement, category and cited refs with **Copy statement** and the line "Saving achievements
  arrives with the Achievements page." Nothing is saved (there is no achievements endpoint yet).
  402 shows "Quick AI actions used up for this month — they reset on <date>"; 503 "The AI service is
  busy". P12 replaces the copy step with the pre-filled S17 dialog.
- **Charts:** Recharts 3.11 through the shadcn `ChartContainer`, always with the chart tokens and the
  fixed assignment (Commits `--chart-1`, PRs merged `--chart-2`, Reviews `--chart-3`, single series
  `--chart-5`, sparklines `--chart-muted` + accent end dot). Stacked segments use a custom shape (4 px
  rounded top on the top segment only, 2 px surface gap); the impact line has a fixed 0–100 axis with
  ticks at 40/60/80 and gaps for insufficient months. Every plot sits in a `role="img"` wrapper whose
  `aria-label` comes from `lib/charts.ts`; tooltips are `aria-hidden`; every chart has a
  "View as table". Recharts accessibility layer is off (charts are not keyboard-interactive per
  DESIGN_SYSTEM §10; the table is the accessible path). Sparklines are plain SVG (no Recharts).
  Plots load with `next/dynamic` behind a skeleton of the same height (no layout shift).
- **Activity chart data:** the dashboard chart buckets the per-day `/metrics/heatmap` series
  client-side (day ≤ 45 days, ISO week ≤ 200, calendar month above), reusing the 12-month heatmap
  response when the period lies inside it (one request instead of three timeseries calls); older
  periods fetch their own range.
- **Explain drawer chart:** `GET /metrics/timeseries?interval=month&period=custom:<6 months>`
  (first day of the month five months before the period end → period end).
- **URL state:** drawers open from `?item=` (`<type>:<rowId>`, reviews
  `review:<reviewId>:<pullRequestId>` because review details come from `GET /activity/prs/:id`) and
  `?metric=`; filters `?type=` / `?repo=` / `?q=` (debounced, `replace`); career `?year=`. Deep-linked
  sheets open only after hydration (Radix marks siblings `aria-hidden` on open).
- **Next step:** rules 1–3, 5 and 7 of S6; rules 4 (achievements) and 6 (goals) wait for P12
  (GAP-16). "Not now" stores `{ rule: expiry }` in `localStorage` (`devimpact.nextStep.dismissed.v1`)
  for 7 days. The appraisal rule counts merged/reviewed from `/metrics/overview?period=half:…` only
  when it applies.
- **KPIs:** no impact donut — the approved S8 design (section scores with weights, header link
  "Impact score N") replaces the phase file's donut (D-020 design wins).
- **Dashboard performance:** `dashboard/page.tsx` prefetches overview, impact, 12-month heatmap,
  sync status, integrations, recent activity and the appraisal/resume lists on the server in parallel
  and hydrates them; each panel subscribes to its own query; `dashboard/loading.tsx` mirrors the
  measured layout. Turbopack aliases `@devimpact/shared` to its ESM source
  (`turbopack.resolveAlias`) and the package declares `"sideEffects": false`; the API keeps the
  CommonJS `dist/` (PERF-07).
- **Rate limit for E2E:** the `default` class window reads `RATE_LIMIT_DEFAULT_PER_MINUTE`
  (default 300, API_CONTRACT_V2 §1.1 unchanged); only the Playwright API server raises it.
- **Dev server:** `experimental.mcpServer: false` (its log file triggered a Turbopack reload loop);
  the shared-source alias is skipped in `next dev` (`PHASE_DEVELOPMENT_SERVER`). E2E helper
  `waitForHydration()` replaces "stat card visible" as the hydration signal.
- **Sync progress** stays on the polling contract (GAP-11 → P14); a global `SyncToaster` in the shell
  announces "Sync finished — N new items." once per run the user watched.
- **Seed:** demo repositories get `lastActivityAt` from their newest PR/review/commit, two GitHub App
  installations (personal + `acme`) and a three-run sync history (initial backfill, a partial run with
  a per-repository error, a succeeded run).
*Consequences:* P11 reuses `ChartCard`/`ChartTable`, the drawers' URL pattern and `useHydrated`; P12
binds "Turn into achievement" to the S17 dialog, adds Next step rules 4/6 and achievements to the
feed/timeline; P14 adds `/activity/feed` totals (GAP-14), PR ids on review evidence (GAP-15), the
shared `exports` map (PERF-07) and, if needed, `/sync/stream` (GAP-11).
