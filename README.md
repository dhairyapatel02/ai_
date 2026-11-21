# DevImpact AI — Engineering Career Operating System

AI-powered platform that connects to your developer tools (GitHub first; GitLab and Jira later)
and uses Claude to turn engineering activity into resume bullet points, performance appraisals,
KPI dashboards, promotion packets and impact scores.

> **Status:** v0.1 → v2.0 rebuild in progress. The plan, decisions and progress live in
> [`docs/v2/`](docs/v2/README.md). Real authentication (Better Auth, GitHub/Google sign-in, JWTs to
> the API) landed in Phase 05; Phase 09 rebuilt the web foundation (Next.js 16, design system, app
> shell, onboarding). The insight pages and document studio are rebuilt in Phases 10–11.

## Tech stack

| Layer    | Technology                                                                                |
| -------- | ----------------------------------------------------------------------------------------- |
| Frontend | Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, shadcn/ui, TanStack Query 5 |
| Backend  | NestJS 11 (REST API) + a separate BullMQ worker process                                   |
| Database | PostgreSQL 16 + Prisma 7 (`pg` driver adapter, committed migrations)                      |
| Queue    | Redis 7 + BullMQ                                                                          |
| AI       | Anthropic Claude API                                                                      |
| Shared   | `packages/shared` — Zod schemas and types used by API and web                             |
| Tooling  | TypeScript (strict), ESLint 9, Prettier, Jest, Vitest, Playwright, Docker                 |

## Project structure

```
.
├── apps/
│   ├── api/                 # NestJS API (src/main.ts) + queue worker (src/worker.ts)
│   │   ├── prisma/          # schema.prisma, migrations/, seed.ts
│   │   └── test/            # integration tests, factories, test helpers
│   └── web/                 # Next.js frontend (see "Web app" below)
├── packages/shared/         # Zod schemas, enums, types (built to dist/ on install)
├── e2e/                     # Playwright smoke tests
├── docs/v2/                 # v2 plan, audit, decisions, progress
├── .github/workflows/ci.yml # CI
└── docker-compose.yml
```

## Quick start (local development)

### Prerequisites

- **Node.js 22** (`nvm use` reads `.nvmrc`) and npm 10
- **Docker** (for Postgres + Redis), or local PostgreSQL 16 and Redis 7
- No GitHub or Anthropic account is needed to run the app with demo data. Add keys only to
  connect a real GitHub account or generate AI documents.

### 1. Install

```bash
git clone https://github.com/dhairyapatel02/ai_.git
cd ai_
npm ci
```

`npm ci` also builds `packages/shared` and generates the Prisma client (`scripts/postinstall.mjs`).

### 2. Configure

```bash
cp .env.example .env
```

Every variable is documented in [`.env.example`](.env.example). The defaults work with the
Docker services below and include **dev-only example secrets** (`BETTER_AUTH_SECRET`,
`TOKEN_ENCRYPTION_KEYS`, `OAUTH_STATE_SECRET`) so nothing else is needed locally; the API and web
app refuse to start with those values when `NODE_ENV=production`. The API, worker, Prisma CLI,
seed script and Next.js all read this **root** `.env` — you don't need to export it. Both apps exit
at startup with a readable message if a required variable is missing or malformed.

### 3. Start Postgres and Redis

```bash
docker compose up -d postgres redis
```

### 4. Create the schema and load demo data

```bash
npm run db:deploy
npm run db:seed
```

`db:deploy` applies the committed migrations in `apps/api/prisma/migrations`. `db:seed` creates the
demo account **`demo@devimpact.dev`** (Europe/London) with ~9 months of commits, pull requests,
reviews and generated documents, including the edge cases every KPI needs (draft PRs, a reverted
PR, drive-by reviews, merge commits, an excluded repository, a v0.1 stub), and computes its daily
metric snapshots (deterministic; safe to re-run). Impact scores are not seeded — `GET /api/impact`
computes them. To start over: `npm run db:reset` (drops all data, re-applies migrations, re-seeds).
`npm run db:seed:heavy` adds `heavy@devimpact.dev` (12 months, ~5k commits, ~1.1k PRs, ~1.7k
reviews) plus 20 filler users for performance work (`npm run perf:metrics`, see
[`docs/v2/blueprint/PERF_NOTES.md`](docs/v2/blueprint/PERF_NOTES.md)).

### 5. Run

```bash
npm run dev:api
```

```bash
npm run dev:web
```

- Web: http://localhost:3000 — you land on `/sign-in`. With `ENABLE_DEV_LOGIN=true` (the
  `.env.example` default) click **Sign in as demo@devimpact.dev** (the "Development only" box) to
  open the seeded demo account without any OAuth app. Accounts that haven't finished onboarding
  land on `/onboarding`. GitHub/Google buttons appear once their credentials are set
  ([Authentication setup](#authentication-setup)).
- API: http://localhost:4000/api — readiness `GET /api/health`, liveness `GET /api/health/live`,
  OpenAPI docs at http://localhost:4000/api/docs (not served in production).

The API needs the web app running to verify tokens (it fetches the public keys from
`${WEB_URL}/api/auth/jwks`).

By default the API also processes queue jobs (`RUN_WORKER_IN_API=true`). To run the worker as a
separate process like production does, set `RUN_WORKER_IN_API=false` and start:

```bash
npm run dev:worker
```

### Changing the database schema

Edit `apps/api/prisma/schema.prisma`, then create a migration and commit it:

```bash
npm run db:migrate -- --name describe_your_change
```

> Databases created with the old `prisma db push` flow can be baselined with
> `npx prisma migrate resolve --applied 20261109075145_init` (run in `apps/api`).

Prisma 7 notes: the connection URL lives in `apps/api/prisma.config.ts` (Migrate) and in the `pg`
driver adapter (runtime, `src/prisma/create-client.ts`), not in `schema.prisma`; `migrate dev` no
longer seeds or generates implicitly (`npm run db:seed`, `npm run db:generate`).

## Authentication setup

Sign-in and the GitHub data source are **two separate GitHub registrations** (ADR-0003, ADR-0004).
None of them is needed for local work on seed data (use the dev login).

**How it works.** Better Auth runs in the web app (`/api/auth/*`) with sessions in Postgres. The
browser gets a 15-minute EdDSA JWT from `GET /api/auth/token` and calls the API with
`Authorization: Bearer <jwt>`; the API verifies it against `${WEB_URL}/api/auth/jwks`. The API
has no cookies and ignores any `x-user-id` header.

### Sign in with GitHub (OAuth App)

1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App.
2. Homepage URL `http://localhost:3000`; **Authorization callback URL
   `http://localhost:3000/api/auth/callback/github`** (use your public `WEB_URL` in production).
3. Copy the client ID and generate a secret → `GITHUB_SIGNIN_CLIENT_ID`,
   `GITHUB_SIGNIN_CLIENT_SECRET`. Scopes requested: `read:user user:email` (identity only).

### Sign in with Google

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** (Web
   application); configure the consent screen (scopes `openid email profile`).
2. Authorized JavaScript origin `http://localhost:3000`; **authorized redirect URI
   `http://localhost:3000/api/auth/callback/google`**.
3. → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

Accounts with the same verified email are linked (GitHub ↔ Google), which also links existing
v0.1 users on their first sign-in.

### GitHub App (data source)

1. GitHub → Settings → Developer settings → **GitHub Apps** → New GitHub App.
2. **Callback URL `http://localhost:3000/integrations/github/callback`**; enable **"Request user
   authorization (OAuth) during installation"** and **"Expire user authorization tokens"**.
   Setup URL: same as the callback, with "Redirect on update" checked.
3. Webhook: **active**, URL `<public API URL>/api/webhooks/github`, content type
   `application/json`, a random secret (`openssl rand -hex 32`) → `GITHUB_WEBHOOK_SECRET`.
   Locally, forward deliveries (see [Local webhook forwarding](#local-webhook-forwarding)).
4. Repository permissions (all **read-only**): Metadata, Contents, Pull requests. No write
   permissions. Subscribe to events: **Pull request**, **Pull request review**, **Push**
   (`installation`, `installation_repositories` and `github_app_authorization` are always sent).
5. After creating: App ID → `GITHUB_APP_ID`; the slug from the public URL
   (`github.com/apps/<slug>`) → `GITHUB_APP_SLUG`; Client ID / a new client secret →
   `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET`; generate a private key (PEM) →
   `GITHUB_APP_PRIVATE_KEY` (or mount the file and set `GITHUB_APP_PRIVATE_KEY_FILE`). The key
   signs App JWTs for installation tokens (installation repository lists).

Then **Integrations → Connect** installs the app (or asks you to authorize it if it is already
installed). The connect `state` is HMAC-signed, single-use and expires after 10 minutes; tokens are
stored AES-256-GCM encrypted.

### How sync works

Implementation: `apps/api/src/sync/` (orchestrator, queues, scheduler, webhooks handler) and
`apps/api/src/providers/github/` (the `ActivityProvider` for GitHub). Design: ADR-0007.

- **Queues** (BullMQ, prefix `QUEUE_PREFIX`, default `devimpact`; `devimpact-test` in tests):
  `sync` — `sync.backfill`, `sync.incremental` (job id `sync-<integrationId>`, one run per
  integration, 3 attempts with exponential backoff), `sync.targeted` (webhooks, `sync-t-<deliveryId>`),
  `sync.fanout` (hourly job scheduler); `metrics` — `metrics.recompute`, `metrics.nightly` (see
  [How metrics work](#how-metrics-work)). Jobs carry ids only, never tokens. The worker
  (`node dist/worker.js`, or the API with `RUN_WORKER_IN_API=true`) consumes them and upserts the
  `sync-fanout` and `metrics-nightly` schedulers on boot.
- **Runs:** `POST /api/sync` (or connect/reconnect, the scheduler, a webhook) creates a `SyncRun`;
  `GET /api/sync/status`, `/sync/runs`, `/sync/runs/:id` read it from Postgres, so status
  survives a Redis restart. Poll `/sync/status` every 2 s while `queued`/`running` (30 s while
  `waiting_rate_limit`).
- **Stages:** prepare → repositories (installations + their repos) → authored PRs (GraphQL search
  `is:pr author:<login> updated:<range>`) → reviewed PRs (`reviewed-by:<login> -author:<login>`,
  the user's own reviews only) → commits (`contributionsCollection` finds repos with commits, then
  default-branch `history(author:)` batched 10 repos per request) → persist → rollups. Searches
  above 1,000 results split their window. Writes are idempotent batches per page.
- **Backfill** (first sync): the plan's history window (FREE 12 months), newest 30 days first —
  then `SyncRun.recentWindowCompletedAt` is set and metrics are queued so the dashboard can render —
  then month by month backwards. **Incremental** (every later sync): from the cursors
  (`Integration.syncCursor`, `Repository.commitCursor`) minus a 1-hour overlap; cursors advance
  only after the run committed.
- **Budget:** the ADR-0007 reference fixture (50 repos × 300 commits, 600 authored + 900 reviewed
  PRs, 12 months) takes **119 requests / ~680 GraphQL points** (budget ≤ 250 / 2,500; v0.1 made
  8,732 calls for 30 × 200). Asserted by `test/integration/sync-budget.int-spec.ts`.
- **Rate limits:** `@octokit/plugin-throttling` + `plugin-retry`, one Octokit per job. When the
  remaining budget drops below `SYNC_RATE_LIMIT_MIN_REMAINING` (200) the run checkpoints, becomes
  `waiting_rate_limit` with `resumeAt`, and the same job is delayed until GitHub's reset.
- **Repositories:** repos with your activity are included by default, installation-only repos are
  not; `PATCH /api/repos/:id` (`inclusionSource=user`) is never overridden. Excluded repos are
  never fetched or counted; their stored data stays until `POST /api/repos/:id/purge`.
- **Tokens:** user tokens (8 h) are refreshed 10 minutes before expiry or after a 401, under a row
  lock (refresh tokens rotate). A rejected refresh or `github_app_authorization.revoked` sets the
  integration to `needs_reauth`: tokens dropped, data kept, schedule paused, `POST /sync` → 409.
- **Schedule:** the hourly fan-out queues every `active` integration whose daily slot
  (`scheduleSlotMinute`, hash of the id) falls in that hour, delayed to its minute.
  Inspect: `npx tsx apps/api/prisma/scripts/inspect-sync-schedule.ts`.
- **Webhooks** (`POST /api/webhooks/github`, public, raw body ≤ 25 MB): HMAC-SHA256 over the raw
  bytes (timing-safe, 401 otherwise), idempotent per `X-GitHub-Delivery` (`webhook_deliveries`),
  202 within milliseconds; the worker refetches only the affected PR (`pull_request`,
  `pull_request_review`), commits (`push` to the default branch) or repo access (`installation*`: existing rows only, then a
  user-token sync discovers newly granted repos).
- **Not captured (v2.0):** commits that never reach the default branch, issues (Jira/Linear are
  v2.1), other people's review comments (aggregates only), PR bodies of reviewed PRs.

### How metrics work

Implementation: `apps/api/src/metrics/`; spec: [`KPI_METHODOLOGY.md`](docs/v2/blueprint/KPI_METHODOLOGY.md)
(`metrics@2.0.0`, `impact@2.0.0`), ADR-0008. Period utilities and the metric catalogue live in
`packages/shared` (`periods/`, `metrics/catalogue.ts`) and are shared with the web app.

- **Deterministic, no AI.** Every number is a pure function of stored rows, the period and the
  user's time zone (`metric-definitions.ts`, `impact.ts`). No metrics/impact endpoint calls
  Anthropic or enqueues work; AI highlights are an explicit `POST /impact/highlights` (see below).
- **What counts:** included repositories only; authored PRs (`isAuthoredByUser`, no v0.1 stubs);
  your reviews on others' PRs; default-branch commits without merge commits. Durations are
  business hours in your time zone (weekends excluded).
- **Periods:** `?period=month:2026-10 | quarter:2026-Q4 | half:2026-H2 | year:2026 |
custom:2026-10-01..2026-11-15` (7–366 days), inclusive local dates in `UserSettings.timezone`;
  default = your default period type containing today. Invalid ranges → `400 INVALID_PERIOD`.
- **Storage:** `metric_snapshots` = additive daily counters for charts (heatmap, count
  timeseries); `impact_scores` = lazily computed period metrics + score per (user, period,
  `scoreVersion`), with all inputs (`inputs`, reproducible without the DB) and the explanation.
  Medians and ratios always come from the fact tables.
- **Recompute:** sync, webhooks, repository inclusion and time-zone changes call
  `MetricsQueueService.enqueueRecompute({ userId, from, to, reason })`; ranges are merged per user in
  Redis and one delayed job per user is debounced (30 s; 1 s for user-initiated changes). The job
  rewrites the affected snapshot days in one transaction and deletes cached scores whose period
  overlaps. `metrics.nightly` (02:30 UTC) recomputes the last 35 days of every active user and the
  full history of users without snapshots. Manual: `npm run metrics:recompute [-- <email>]`.

### AI configuration

Implementation: `apps/api/src/ai/` (client, structured output, event streams, queue),
`src/prompts/` (versioned prompts), `src/evidence/` (deterministic evidence + citation verifier),
`src/documents/` (API, worker generation, quick actions), `src/usage/` (usage + quotas). Spec:
[ADR-0009](docs/v2/blueprint/adr/ADR-0009-ai-generation.md), KPI_METHODOLOGY §7–§8.

| Variable                                           | Default                                | Purpose                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                | —                                      | Without it the app runs; generation answers `503 UPSTREAM_UNAVAILABLE { reason: 'not_configured' }` (cache hits still work)                          |
| `ANTHROPIC_BASE_URL`                               | Anthropic                              | Test mode: point at a mock (`npm run ai:mock --workspace=apps/api`, port 4010; `AI_MOCK_CHUNK` / `AI_MOCK_DELAY_MS` slow its stream)                 |
| `ANTHROPIC_MODEL_DEFAULT` / `ANTHROPIC_MODEL_FAST` | `claude-opus-5-5` / `claude-haiku-5-5` | Documents (resume, appraisal, promotion) / quick actions (highlights, achievement statements, digest summary, repair). Model ids live only in config |
| `AI_EFFORT_DEFAULT` / `AI_EFFORT_FAST`             | `medium` / `low`                       | `output_config.effort` (thinking is adaptive)                                                                                                        |
| `AI_FALLBACKS_ENABLED`                             | `true`                                 | Server-side refusal fallback on the default tier                                                                                                     |
| `AI_TIMEOUT_MS` / `AI_QUICK_TIMEOUT_MS`            | 180000 / 20000                         | Per-attempt timeouts (documents / quick actions)                                                                                                     |
| `AI_MAX_RETRIES` / `AI_RETRY_BASE_MS`              | 2 / 1000                               | Retries for 429/5xx/overloaded/connection only, exponential backoff + jitter, never after output streamed                                            |
| `AI_WORKER_CONCURRENCY`                            | 4                                      | Parallel `ai` jobs per worker process                                                                                                                |
| `AI_STREAM_TTL_SECONDS`                            | 3600                                   | Retention of a document's Redis event stream (SSE resume window)                                                                                     |
| `ENTITLEMENTS_JSON`                                | —                                      | Plan-limit overrides, e.g. `{"FREE":{"aiGenerationsPerMonth":30}}`                                                                                   |
| `AI_PRICES_JSON`                                   | —                                      | Price-table overrides (US$/1M tokens) for cost estimates                                                                                             |

- **How a document is made:** `POST /api/documents` validates the options, resolves the period in
  your time zone, builds a deterministic evidence pack (ranked PRs, reviews, commits, engine
  metrics; private repo names replaced when `aiRedactPrivateRepos` is on) and computes `inputHash`.
  Same hash → the existing document (`200`, no quota). Otherwise a `pending` document is created and
  an `ai.generate` job runs in the worker: streamed structured output (`output_config.format` from
  the Zod schema) → Zod validation → at most one repair call → citation verification (refs outside
  your evidence are removed and flagged, uncited claims flagged) → engine sections merged (metrics
  are never written by the model) → `DocumentVersion` + `AiUsage`. Events go to a Redis Stream that
  `GET /api/documents/:id/stream` relays as SSE (`status`, `section`, `delta`, `done`/`error`/
  `cancelled`, resumable with `Last-Event-ID`). Quick actions (`ai.quick`) are awaited ≤ 20 s.
- **Queue:** `ai` under `QUEUE_PREFIX` (job ids `ai-<documentId>-<version>`), consumed by the worker
  (`npm run dev:worker`) or by the API when `RUN_WORKER_IN_API=true`.
- **Quotas (PRD §6):** per UTC month — FREE 15 generations (create + regenerate) and 100 quick
  actions; PRO 150 / 1,000. Cache hits, failures, cancellations and repair calls never count;
  generations in flight do. Exceeded → `402 QUOTA_EXCEEDED { feature, used, limit, resetsAt }`.
  `GET /api/me/usage?month=YYYY-MM` reports usage, tokens and estimated cost.
- **Adding a prompt version:** copy `apps/api/src/prompts/<name>.vN.ts` to `<name>.v(N+1).ts`, bump
  `version`, edit, point `PROMPTS` in `src/prompts/index.ts` at it, then refresh the eval
  recordings (`npm run eval:live -- --record` with a key, or `npm run eval:record --workspace=apps/api`)
  — `npm test` fails while recordings are for an older version. The version is part of `inputHash`,
  so new requests miss the cache; existing documents keep their stored `promptVersion`.
- **Evals:** `apps/api/test/evals/` — 7 personas × 6 generators replay recorded responses through the
  real pipeline in `npm test` (schema, citations resolve to the user's records, numbers traceable,
  sections, lengths, banned phrases, prompt-injection and redaction checks, plus negative controls).
  `npm run eval:live` (needs `ANTHROPIC_API_KEY`) runs them against the real API and writes
  [`docs/v2/evals/REPORT.md`](docs/v2/evals/REPORT.md).

### Document exports

`GET /api/documents/:id/export?format=md|txt|pdf|docx&version=&citations=true|false`
([ADR-0012](docs/v2/blueprint/adr/ADR-0012-exports.md), D-027). One export-blocks IR
(`packages/shared/src/documents/export.ts`, also used by the web's Copy as Markdown / plain text)
feeds four renderers in `apps/api/src/exports/`: Markdown and plain text (escaped, numbered evidence
notes), **PDF** with `@react-pdf/renderer` (A4, Letter for `America/*` time zones) and **DOCX** with
`docx` (Word heading styles). PDF fonts are Instrument Sans and JetBrains Mono from the
`@fontsource/*` API dependencies, read from `node_modules` at render time — no network access, and
they ship in the Docker image with the other production dependencies. Filenames are
`<type>-<period>-v<N>.<ext>` (e.g. `appraisal-2026-H2-v1.pdf`); resume exports omit citations
unless `citations=true`. Exports use the `export` rate class: 30 per hour per user
(`RATE_LIMIT_EXPORT_PER_HOUR`).

### Local webhook forwarding

GitHub cannot reach `localhost`. Either:

```bash
npx smee-client --url https://smee.io/<your-channel> --target http://localhost:4000/api/webhooks/github
```

(set the App's webhook URL to the smee channel), or with the GitHub CLI extension
(`gh extension install cli/gh-webhook`; repository-level hooks only):

```bash
gh webhook forward --repo=<owner>/<repo> --events=pull_request,pull_request_review,push --url=http://localhost:4000/api/webhooks/github --secret="$GITHUB_WEBHOOK_SECRET"
```

**Replay a delivery locally:** GitHub App settings → Advanced → Recent deliveries → Redeliver
(a redelivery keeps its `X-GitHub-Delivery`, so DevImpact acknowledges it as a duplicate; delete the
row from `webhook_deliveries` first to process it again). Or sign a payload yourself:

```bash
BODY=$(cat apps/api/test/fixtures/github/webhooks/pull_request.edited.json)
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" -hex | sed 's/^.* //')"
curl -i -X POST http://localhost:4000/api/webhooks/github -H 'content-type: application/json' -H 'x-github-event: pull_request' -H "x-github-delivery: $(uuidgen)" -H "x-hub-signature-256: $SIG" --data "$BODY"
```

### Secrets and key rotation

- `BETTER_AUTH_SECRET` — `openssl rand -base64 32`. It also encrypts the JWT signing keys in the
  `jwks` table: after changing it, delete those rows (`DELETE FROM jwks;`) so a new key pair is
  generated, and sign in again.
- `OAUTH_STATE_SECRET` — `openssl rand -base64 48`.
- `GITHUB_WEBHOOK_SECRET` — `openssl rand -hex 32`; rotate on GitHub and in the env together
  (deliveries signed with the old secret are rejected).
- `TOKEN_ENCRYPTION_KEYS` / `TOKEN_ENCRYPTION_ACTIVE_KEY` — `openssl rand -base64 32` per key.
  **Rotation:** add the new key (`1:<old>,2:<new>`), set `TOKEN_ENCRYPTION_ACTIVE_KEY=2`, deploy,
  run `npx tsx apps/api/prisma/scripts/reencrypt-tokens.ts`, then remove the old key.

## Full stack with Docker

```bash
docker compose up --build
```

Starts postgres, redis, api (applies migrations on start), worker and web; every service has a
healthcheck (`docker compose ps`). `.env` is optional here — compose sets the connection settings
and **compose-local default secrets** so the stack starts; they are public, so set real
`BETTER_AUTH_SECRET`, `TOKEN_ENCRYPTION_KEYS` and `OAUTH_STATE_SECRET` in `.env` before exposing
the stack anywhere. The web image is a production build, so the dev login is off: configure GitHub
or Google sign-in to log in. Seed the containerised database from your machine with
`npm run db:seed` (it uses `localhost:5432`). Behind a registry rate limit, pass a mirror:
`docker compose build --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-alpine`.

## Quality checks and tests

| Command                | What it does                                                                  |
| ---------------------- | ----------------------------------------------------------------------------- |
| `npm run check`        | Lint + format + tokens + typecheck + unit tests + build (run before every PR) |
| `npm run check:tokens` | WCAG contrast of every token pair + app/docs `tokens.css` in sync             |
| `npm run lint`         | ESLint (flat config, type-aware) across all workspaces                        |
| `npm run format`       | Prettier write (`format:check` to verify)                                     |
| `npm run typecheck`    | `tsc --noEmit` for api, web, shared and the E2E files                         |
| `npm test`             | Unit tests: API (Jest), web (Vitest + Testing Library), shared (Vitest)       |
| `npm run test:int`     | API integration tests against a real Postgres + Redis                         |
| `npm run test:e2e`     | Playwright smoke tests against the built apps                                 |
| `npm run eval`         | Mocked AI evals only (also part of `npm test`); `eval:live` = real API        |

**Integration tests** use the separate database in `DATABASE_URL_TEST` (default
`devimpact_test`; it is truncated between tests and migrated automatically). Create it once:

```bash
docker compose exec postgres createdb -U devimpact devimpact_test
```

```bash
npm run test:int
```

**E2E tests** need built apps and a migrated, seeded database. Playwright starts the API, the web
app in development mode on :3000 (`ENABLE_DEV_LOGIN=true`; Next 16 keeps dev output in
`.next/dev`, next to the production build) and the production web build on :3001 (to prove the dev
login is a 404 there), or reuses servers already running locally. The suites cover sign-in,
onboarding (GitHub App round trip intercepted in the browser), the shell at 1440/768/390 px, theme
persistence, the ⌘K palette, the period picker, the P10 insight journey (dashboard → KPI explain
drawer → activity filter + item drawer → career year + print view → Sync now → progress →
completion, with the sync intercepted in the browser), the P11 document studio (resume generate →
stream → edit → autosave version → restore → MD/PDF/DOCX downloads → library → delete; appraisal
and promotion; leaving mid-stream and coming back) and axe-core (0 serious/critical) on the shell,
sign-in, onboarding, every insight page and every document page in light/dark at 1440 and 390 px.
Documents are generated against the fake Anthropic API, which Playwright starts on :4010
(`npm run ai:mock`, slowed with `AI_MOCK_CHUNK=6 AI_MOCK_DELAY_MS=25` so streaming is visible):

```bash
npm run build && npm run db:deploy && npm run db:seed
```

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

Traces are off by default; re-run a failing test with `npx playwright test --trace on` to debug.
Playwright starts the API with `RATE_LIMIT_DEFAULT_PER_MINUTE=3000` (the axe loops exceed the
production 300 requests/min), `RATE_LIMIT_EXPORT_PER_HOUR=1000` and
`ANTHROPIC_BASE_URL=http://127.0.0.1:4010 ANTHROPIC_API_KEY=mock`; set them yourself when reusing an
API you started (a reused `next dev` also needs the placeholder `GITHUB_SIGNIN_*` / `GOOGLE_*` ids
from `playwright.config.ts` for the sign-in test).
Regenerate the screenshots (2× DPR, light/dark, desktop/mobile) with
`SCREENSHOTS=1 npm run test:e2e -- e2e/screenshots.spec.ts` (Phase 09 → `docs/v2/screenshots/p09/`)
, `SCREENSHOTS=1 npm run test:e2e -- e2e/screenshots-p10.spec.ts` (insight pages →
`docs/v2/screenshots/p10/`) and `SCREENSHOTS=1 npm run test:e2e -- e2e/screenshots-p11.spec.ts`
(document studio + exported PDF first pages via `pdftoppm` → `docs/v2/screenshots/p11/`).

Tests never call the real GitHub or Anthropic APIs: `octokit` is stubbed in Jest, GitHub OAuth/REST
calls go to unroutable `*.github.invalid` hosts answered by a fake (`test/utils/fake-github.ts`),
and AI calls go to an in-process fake Messages API (`test/utils/fake-anthropic.ts`, via
`ANTHROPIC_BASE_URL`; the test env points at a closed port by default) consumed by an in-process `ai`
worker (`test/utils/ai-worker.ts`). **Authenticated API tests** use `bearer(userId)` from
`apps/api/test/utils/auth.ts`: `createTestApp()` starts a local JWKS server with a test key pair,
so the real JWT verification path runs. E2E tests sign in through `POST /api/dev-login`. Known v0.1 bugs are captured as `it.skip` / `it.todo` tests tagged with their issue ID from
[`docs/v2/audit/ISSUES.md`](docs/v2/audit/ISSUES.md); the phase that fixes a bug un-skips its test.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on pushes
to `main`:

1. **quality** — lint, format check, design-token contrast, typecheck, unit tests, `npm audit` for
   API and web production deps
2. **integration** — API integration tests with Postgres 16 + Redis 7 service containers
3. **e2e** — build all workspaces, migrate + seed, Playwright smoke (report uploaded on failure)
4. **docker** — `docker compose build`, start the stack, wait for healthchecks, probe `/api/health`

## Web app (`apps/web`)

**Stack (exact pins, D-025):** Next.js 16.4.6 (Turbopack, `src/proxy.ts`), React 19.3.1, Tailwind
CSS 4.3.5 (CSS-first, tokens in `src/styles/tokens.css`), shadcn/ui new-york-v4 sources in
`src/components/ui`, TanStack Query 5.108, next-themes 0.4.6, Better Auth 1.7.25, Vitest 5.1.

```
apps/web/src/
├── app/
│   ├── (auth)/sign-in           # S1 — public
│   ├── (onboarding)/onboarding  # S2–S5 wizard (connect, pending, repositories, sync)
│   ├── (system)/integrations/github/callback
│   ├── (app)/…                  # signed-in pages inside the AppShell (loading/error/not-found):
│   │                            # dashboard, activity, kpis (+ impact), career, settings/integrations,
│   │                            # documents (library, new/{appraisal,promotion,resume}, [id] viewer) …
│   ├── (print)/career/print     # S10 print view (server-rendered, no shell)
│   ├── not-found.tsx, global-error.tsx, providers.tsx, layout.tsx, globals.css
├── components/
│   ├── ui/                      # shadcn primitives adapted to the tokens (DESIGN_SYSTEM §5.1)
│   ├── states/                  # PageHeader, StatCard, DeltaText, ChartCard, EmptyState, ErrorState,
│   │                            # Banner, skeletons, DataTable, InfoPopover, ConfirmDialog
│   ├── shell/                   # AppShell, sidebar, top bar, mobile nav, period picker, sync status, ⌘K
│   ├── charts/                  # Recharts plots (loaded with next/dynamic), tooltip, chart table
│   ├── documents/               # DocumentRenderer, DocumentEditor (next/dynamic), ResumeBullets,
│   │                            # StreamingStatus, VersionList, RenameDialog, StatusBadge
│   └── *.tsx                    # ImpactScoreCard, ActivityHeatmap, ActivityChart, Sparkline, MetricRow,
│                                # ExplainDrawer, ItemDrawer, FeedItemRow, NextStepCard, DateRangePicker, …
├── hooks/                       # useEventStream (fetch SSE), useDocumentStream, useMediaQuery, useIsMobile
├── lib/api/                     # apiClient, ApiError, query keys + client, hooks, SSE reader, server client
├── lib/period.ts                # global `?period=` URL state (shared period utils)
├── lib/url-state.ts             # other URL state (`?item=`, `?metric=`, `?type=`, `?repo=`, `?q=`, `?year=`)
├── lib/charts.ts                # chart helpers: interval, bucketing, ticks, number formats, aria summaries
└── proxy.ts                     # optimistic route protection (session cookie)
```

**Rules:** components never call `fetch` (ESLint `no-restricted-syntax`; use `apiClient` + TanStack
Query), never `alert()`, never Tailwind palette colours (tokens only, UX-11); every view has loading,
empty, error and success states.

**Charts (P10, D-026):** Recharts through the shadcn `chart` container and the chart tokens only —
fixed series colours (Commits `--chart-1`, PRs merged `--chart-2`, Reviews `--chart-3`, single
series `--chart-5`), every chart in a `role="img"` wrapper with an `aria-label` summary from
`lib/charts.ts` and a "View as table" toggle, plots loaded with `next/dynamic` behind a skeleton of
the same height. Turbopack bundles `@devimpact/shared` from its ESM source (`next.config.js`
`turbopack.resolveAlias`), so unused schemas tree-shake out of the client.

**Document studio (P11, D-027):** library, studios and the viewer/editor live under
`app/(app)/documents/`; hooks in `lib/api/document-hooks.ts`, streaming in
`hooks/use-document-stream.ts` (SSE with `Last-Event-ID` resume, then polling), copy in
`lib/documents.ts`. The editor is structured per-claim fields (citations stay attached), loaded with
`next/dynamic` only in edit mode.

**View tests** mock `@/lib/api/browser` with `test/api-mock.tsx` (route table → the real hooks and
Zod schemas) and use responses captured from the seeded demo user in `test/fixtures-p10/` and
`test/fixtures-p11/`.

### Adding a page

1. **Route:** `src/app/(app)/<route>/page.tsx` — a Server Component exporting `metadata` and
   rendering a client view (`<route>-view.tsx`). Add the route to `NAV_GROUPS` / `routeMeta` in
   `src/components/shell/nav-config.ts` (title, breadcrumb parent, `period: true` if the data
   depends on the global period).
2. **Query hook:** add a key to `qk` (`src/lib/api/query-keys.ts`, domain first) and a hook next to
   the others (`src/lib/api/metrics-hooks.ts` style) that calls
   `apiClient.get(path, { schema: <shared Zod schema>, query, signal })`.
3. **States:** loading → `PageSkeleton`/`CardSkeleton`; error → `ErrorState` (retry + request ID);
   empty → `EmptyState` (what's missing + one action); period pages wrap content in
   `<PeriodGate>` (designed `INVALID_PERIOD` state) and show `<SyncBanner />`.
4. **Tests:** Vitest for logic/components; Playwright + axe for new critical flows.

## API endpoints

All routes are prefixed with `/api` and require `Authorization: Bearer <jwt>` except health and
the signature-gated GitHub webhook.
Responses use the envelope `{ success: true, data, meta? }` / `{ success: false, error: { code,
message, details?, requestId } }` with real HTTP status codes; the full contract (error codes,
rate-limit classes, pagination) is [`docs/v2/blueprint/API_CONTRACT_V2.md`](docs/v2/blueprint/API_CONTRACT_V2.md)
and the live schema is at `/api/docs` outside production.

| Method | Path                                            | Description                                            |
| ------ | ----------------------------------------------- | ------------------------------------------------------ |
| GET    | /api/health · /api/health/live                  | Readiness (Postgres + Redis) · liveness (public)       |
| GET    | /api/me · /api/auth/me (deprecated)             | User, settings, entitlements, integrations             |
| PATCH  | /api/me · /api/me/settings                      | Update name · settings (IANA time zone, …)             |
| GET    | /api/me/settings · /api/me/entitlements         | Settings · plan limits                                 |
| DELETE | /api/me                                         | Delete account and all data (`{ confirmEmail }`)       |
| GET    | /api/integrations · /:id                        | Integrations (never tokens)                            |
| POST   | /api/integrations/github/connect                | GitHub App install/authorize URL with signed state     |
| POST   | /api/integrations/github/callback               | Verify state, exchange code, store encrypted tokens    |
| POST   | /api/integrations/:id/reconnect                 | Authorize again                                        |
| DELETE | /api/integrations/:id?purgeData=                | Disconnect (revoke token; keep or purge data)          |
| POST   | /api/sync                                       | Queue a sync (202; 409 in progress / needs reauth)     |
| GET    | /api/sync/status · /sync/runs · /runs/:id       | DB-backed state, progress, history                     |
| GET    | /api/repos · PATCH /repos · /repos/:id          | Repositories; include/exclude (recomputes KPIs)        |
| POST   | /api/repos/:id/purge                            | Delete a repository's synced activity                  |
| POST   | /api/webhooks/github                            | GitHub App webhook (public, HMAC, idempotent, 202)     |
| GET    | /api/metrics/definitions                        | Metric catalogue, versions, score bands (cacheable)    |
| GET    | /api/metrics/overview?period=                   | Stat cards with deltas, impact summary, freshness      |
| GET    | /api/metrics/kpis?period=                       | Five KPI sections (value, n, status, delta, evidence)  |
| GET    | /api/metrics/timeseries?metric=&interval=       | One metric per day/week/month (`period` or `from/to`)  |
| GET    | /api/metrics/heatmap?from=&to=                  | Daily activity counts (≤ 366 days)                     |
| GET    | /api/metrics/repos · /trends · /evidence        | Per-repo contributions · N-period trends · evidence    |
| GET    | /api/impact?period= · /impact/history           | Deterministic impact score `impact@2.0.0` + history    |
| GET    | /api/career/timeline?year=                      | The year by quarter (merged PRs, reviews, milestones)  |
| GET    | /api/activity/feed                              | Unified feed (commits, PR events, reviews)             |
| GET    | /api/activity/prs?role= · /prs/:id              | Authored or reviewed PRs (cycle time, my reviews)      |
| GET    | /api/activity/reviews · /commits · /commits/:id | Reviews (turnaround) · commits                         |
| GET    | /api/me/usage?month=                            | AI usage vs monthly quota, tokens, estimated cost      |
| POST   | /api/impact/highlights                          | AI narrative for a period's score (fast, cached; ai)   |
| GET    | /api/documents?type=&q=&sort=&status=           | Document library (cursor pagination)                   |
| POST   | /api/documents/preview-evidence                 | Evidence + engine metrics a document would use (no AI) |
| POST   | /api/documents                                  | Create (200 cache hit / 201 pending + streamUrl; ai)   |
| GET    | /api/documents/:id?version= · /:id/stream       | Document + version + cited evidence · SSE events       |
| PATCH  | /api/documents/:id                              | Edit title/content (new version; 409 stale)            |
| POST   | /api/documents/:id/regenerate · /cancel         | Next version or one section (ai) · cancel              |
| GET    | /api/documents/:id/versions · POST …/:n/restore | Version history · restore                              |
| GET    | /api/documents/:id/export?format=&version=      | Download md / txt / pdf / docx (export, 30/h)          |
| DELETE | /api/documents/:id                              | Delete document and versions                           |
| POST   | /api/ai/achievement-statement                   | Statement for one of your PRs/commits (fast; ai)       |

Web routes: `/api/auth/*` (Better Auth), `POST /api/dev-login` (development only), `GET /api/health`.

**Adding an endpoint:** define request/response Zod schemas in `packages/shared/src/api/`, use
them in the controller with `@ZodBody/@ZodQuery/@ZodParams` and `@ApiDoc`, take the user from
`@CurrentUser()` and scope every query by `userId`, throw `AppException` for expected failures,
pick a `@RateLimit()` class if not `default`, and add an integration test (the generated auth
test covers the 401 automatically).

## License

MIT
