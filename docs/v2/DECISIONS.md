# V2 Decision Log

Two kinds of entries:

- **PROPOSED** — the planner's recommended default. Phase 03 (Blueprint) confirms, amends or
  rejects each one, with the user's input where marked **USER DECISION**.
- **CONFIRMED** — binding. Later phases must follow it; changing it requires a new entry that
  supersedes the old one (never edit history silently).

Format: `D-NNN · Title · Status · Phase · Summary · Rationale · Consequences`.

---

## Proposed defaults (from planning, 2026-11-09)

### D-001 · Keep the monorepo shape and core stack · PROPOSED
Keep npm workspaces with `apps/web` (Next.js), `apps/api` (NestJS), `packages/shared`.
Add **Turborepo** only if build orchestration becomes painful (not required).
*Rationale:* the codebase is small (~4.5k LOC); a rewrite of the stack costs more than it saves.

### D-002 · Upgrade to current LTS / stable versions · PROPOSED
- Node **22 LTS** minimum (`engines`, Docker base `node:22-alpine`); Node 18 is EOL.
- Next.js → latest stable major (16.x at time of writing) + React 19; Tailwind v4; shadcn/ui via CLI.
- NestJS → 11.x; Prisma → latest stable; BullMQ latest; `@anthropic-ai/sdk` latest.
- Postgres 16, Redis 7 in compose.
*Rationale:* security patches (Next 14.2.3 CVEs), long support window. Done in P02 (backend
deps, patch-level Next) and P09 (Next major + UI stack).

### D-003 · Authentication architecture · PROPOSED · **USER DECISION in P03**
Recommended: **auth lives in the web app** using a maintained library (Better Auth or Auth.js v5)
with GitHub + Google sign-in, sessions stored in Postgres via Prisma. The web app calls the API
with a **short-lived signed JWT** (or session cookie on the same parent domain); NestJS verifies
it in a global `AuthGuard` and derives `userId` — the `x-user-id` header is removed.
`dev-login` survives only when `NODE_ENV=development && ENABLE_DEV_LOGIN=true`.
Alternative: auth owned by NestJS (Passport) issuing httpOnly cookies.

### D-004 · Sign-in identity vs. data-source integrations are separate · PROPOSED
"Sign in with GitHub" (identity, minimal scopes `read:user user:email`) is distinct from
"Connect GitHub as a data source" (scopes needed for private repo metadata). This allows Google
sign-in users to connect GitHub, and lets users connect multiple accounts later.
Evaluate **GitHub App** vs OAuth App for the data source in P03 (GitHub App gives fine-grained
repo selection, higher rate limits and webhooks per installation).

### D-005 · Tokens encrypted at rest · PROPOSED
AES-256-GCM envelope encryption for `accessToken`/`refreshToken` with a key from
`TOKEN_ENCRYPTION_KEY` (32-byte base64), key-version prefix for rotation. Never logged, never
returned by the API.

### D-006 · API conventions · PROPOSED
- Envelope: `{ success: true, data, meta? }` / `{ success: false, error: { code, message, details? } }`.
- Proper HTTP status codes via a global exception filter (`4xx/5xx`, not 200-with-error).
- Zod validation pipe using schemas from `packages/shared`.
- Cursor or page pagination with `limit` capped (max 100).
- OpenAPI document generated from the Zod schemas and published at `/api/docs` (non-prod).
- URI versioning not required for v2; keep `/api` prefix.

### D-007 · Deterministic metrics; AI only for narrative · PROPOSED · **USER DECISION in P03**
KPIs and the impact score are computed by a versioned, deterministic formula from stored data
(inspired by DORA/SPACE, adapted to individuals). Claude produces highlights, narratives,
suggestions and documents, each citing evidence IDs. Scores show "how this is calculated".
*Rationale:* reproducibility, fairness, explainability, cost.

### D-008 · Sync strategy · PROPOSED
- Separate **worker process** (`apps/api/src/worker.ts`) consuming BullMQ queues; API only enqueues.
- Prefer GitHub **GraphQL + Search** (`author:`, `reviewed-by:`) over iterating every repo.
- Incremental sync from a per-integration cursor (`lastSyncedAt`), scheduled every 24h via
  BullMQ repeatable jobs, plus **webhooks** (HMAC-verified) for near-real-time updates.
- `SyncRun` table persists status, counts, errors, duration.
- Octokit throttling + retry plugins; respect rate limits; never swallow errors silently.
- Reviewed-only PRs stored distinctly (never counted as authored PRs).

### D-009 · AI generation design · PROPOSED
- Model IDs from env: `ANTHROPIC_MODEL_DEFAULT` (current Sonnet-class) and
  `ANTHROPIC_MODEL_FAST` (current Haiku-class) — check the `claude-api` skill for current IDs.
- Structured output via tool use / JSON schema, validated with Zod; one repair retry.
- SSE streaming for long documents; documents saved as versioned drafts the user can edit.
- Cache key = hash(prompt version, model, normalized input evidence); reuse unless "regenerate".
- Retry only retryable errors (429, 5xx, overloaded) with exponential backoff + jitter.
- Track tokens/cost per generation; per-plan monthly quotas.
- Treat activity text as untrusted: delimit it, instruct the model to ignore instructions inside it.

### D-010 · Frontend data layer · PROPOSED
Typed API client generated from / validated by shared Zod schemas + **TanStack Query** for
caching, retries and polling. Server Components for shells; client components for interactive
widgets. Error boundaries (`error.tsx`) and skeletons (`loading.tsx`) per route.

### D-011 · Testing stack · PROPOSED
- API: **Jest** (Nest default) unit + integration (supertest against a real test Postgres).
- Web: **Vitest** + React Testing Library.
- E2E: **Playwright** (Chromium is pre-installed in the cloud container; run with `--trace off`).
- External APIs mocked with **MSW**/nock fixtures. Anthropic always mocked in tests.
- CI: GitHub Actions — lint, typecheck, unit, integration (service containers), build, E2E smoke.

### D-012 · Exports · PROPOSED
Markdown + copy-to-clipboard (all docs), **PDF** (server-side via headless Chromium or
`@react-pdf/renderer`), **DOCX** (`docx` npm package). Decide renderer in P03.

### D-013 · Hosting target · PROPOSED · **USER DECISION in P03 or P15**
Docker Compose for self-hosting (must work). Recommended managed setup: web on Vercel; API +
worker on Fly.io/Render/Railway; managed Postgres (Neon/Supabase/RDS) and Redis (Upstash/Redis
Cloud). Final pick in P15.

### D-014 · Product scope for v2.0 · PROPOSED · **USER DECISION in P03**
In scope: individual engineer experience end-to-end with GitHub, all document types, KPIs,
career timeline, achievements journal (manual wins), goals, weekly digest.
Stretch / v2.1: GitLab/Jira/Linear (P13), manager/team views, billing (Stripe).

---

## Confirmed decisions

_None yet — Phase 03 records confirmed decisions here._
