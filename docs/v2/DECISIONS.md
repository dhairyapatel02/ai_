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
