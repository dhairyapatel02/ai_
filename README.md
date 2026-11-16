# DevImpact AI — Engineering Career Operating System

AI-powered platform that connects to your developer tools (GitHub first; GitLab and Jira later)
and uses Claude to turn engineering activity into resume bullet points, performance appraisals,
KPI dashboards, promotion packets and impact scores.

> **Status:** v0.1 → v2.0 rebuild in progress. The plan, decisions and progress live in
> [`docs/v2/`](docs/v2/README.md). Real authentication (Better Auth, GitHub/Google sign-in, JWTs to
> the API) landed in Phase 05; the UI is still the functional v0.1 one until Phase 09.

## Tech stack

| Layer    | Technology                                                                |
| -------- | ------------------------------------------------------------------------- |
| Frontend | Next.js 14 (App Router), Tailwind CSS, shadcn/ui                          |
| Backend  | NestJS 11 (REST API) + a separate BullMQ worker process                   |
| Database | PostgreSQL 16 + Prisma 7 (`pg` driver adapter, committed migrations)      |
| Queue    | Redis 7 + BullMQ                                                          |
| AI       | Anthropic Claude API                                                      |
| Shared   | `packages/shared` — Zod schemas and types used by API and web             |
| Tooling  | TypeScript (strict), ESLint 9, Prettier, Jest, Vitest, Playwright, Docker |

## Project structure

```
.
├── apps/
│   ├── api/                 # NestJS API (src/main.ts) + queue worker (src/worker.ts)
│   │   ├── prisma/          # schema.prisma, migrations/, seed.ts
│   │   └── test/            # integration tests, factories, test helpers
│   └── web/                 # Next.js frontend
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
demo account **`demo@devimpact.dev`** with ~9 months of commits, pull requests, reviews, monthly
scores and generated documents (deterministic; safe to re-run). To start over:
`npm run db:reset` (drops all data, re-applies migrations, re-seeds).

### 5. Run

```bash
npm run dev:api
```

```bash
npm run dev:web
```

- Web: http://localhost:3000 — you land on `/sign-in`. With `ENABLE_DEV_LOGIN=true` (the
  `.env.example` default) click **Sign in as demo user (dev only)** to open the seeded demo account
  without any OAuth app. GitHub/Google buttons appear once their credentials are set
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
  `sync.fanout` (hourly job scheduler); `metrics` — `metrics.recompute` (consumer is a no-op until
  P07). Jobs carry ids only, never tokens. The worker (`node dist/worker.js`, or the API with
  `RUN_WORKER_IN_API=true`) consumes them and upserts the `sync-fanout` scheduler on boot.
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

| Command             | What it does                                                               |
| ------------------- | -------------------------------------------------------------------------- |
| `npm run check`     | Lint + format check + typecheck + unit tests + build (run before every PR) |
| `npm run lint`      | ESLint (flat config, type-aware) across all workspaces                     |
| `npm run format`    | Prettier write (`format:check` to verify)                                  |
| `npm run typecheck` | `tsc --noEmit` for api, web, shared and the E2E files                      |
| `npm test`          | Unit tests: API (Jest), web (Vitest + Testing Library), shared (Vitest)    |
| `npm run test:int`  | API integration tests against a real Postgres + Redis                      |
| `npm run test:e2e`  | Playwright smoke tests against the built apps                              |

**Integration tests** use the separate database in `DATABASE_URL_TEST` (default
`devimpact_test`; it is truncated between tests and migrated automatically). Create it once:

```bash
docker compose exec postgres createdb -U devimpact devimpact_test
```

```bash
npm run test:int
```

**E2E tests** need built apps and a migrated, seeded database. Playwright starts the API, the web
app in development mode on :3000 (`ENABLE_DEV_LOGIN=true`, build dir `.next-e2e`) and the
production web build on :3001 (to prove the dev login is a 404 there), or reuses servers already
running locally:

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

Tests never call the real GitHub or Anthropic APIs: `octokit` is stubbed in Jest, GitHub OAuth/REST
calls go to unroutable `*.github.invalid` hosts answered by a fake (`test/utils/fake-github.ts`),
and AI calls are mocked. **Authenticated API tests** use `bearer(userId)` from
`apps/api/test/utils/auth.ts`: `createTestApp()` starts a local JWKS server with a test key pair,
so the real JWT verification path runs. E2E tests sign in through `POST /api/dev-login`. Known v0.1 bugs are captured as `it.skip` / `it.todo` tests tagged with their issue ID from
[`docs/v2/audit/ISSUES.md`](docs/v2/audit/ISSUES.md); the phase that fixes a bug un-skips its test.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on pushes
to `main`:

1. **quality** — lint, format check, typecheck, unit tests, `npm audit` for API production deps
2. **integration** — API integration tests with Postgres 16 + Redis 7 service containers
3. **e2e** — build all workspaces, migrate + seed, Playwright smoke (report uploaded on failure)
4. **docker** — `docker compose build`, start the stack, wait for healthchecks, probe `/api/health`

## API endpoints

All routes are prefixed with `/api` and require `Authorization: Bearer <jwt>` except health and
the signature-gated GitHub webhook.
Responses use the envelope `{ success: true, data, meta? }` / `{ success: false, error: { code,
message, details?, requestId } }` with real HTTP status codes; the full contract (error codes,
rate-limit classes, pagination) is [`docs/v2/blueprint/API_CONTRACT_V2.md`](docs/v2/blueprint/API_CONTRACT_V2.md)
and the live schema is at `/api/docs` outside production.

| Method | Path                                       | Description                                         |
| ------ | ------------------------------------------ | --------------------------------------------------- |
| GET    | /api/health · /api/health/live             | Readiness (Postgres + Redis) · liveness (public)    |
| GET    | /api/me · /api/auth/me (deprecated)        | User, settings, entitlements, integrations          |
| PATCH  | /api/me · /api/me/settings                 | Update name · settings (IANA time zone, …)          |
| GET    | /api/me/settings · /api/me/entitlements    | Settings · plan limits                              |
| DELETE | /api/me                                    | Delete account and all data (`{ confirmEmail }`)    |
| GET    | /api/integrations · /:id                   | Integrations (never tokens)                         |
| POST   | /api/integrations/github/connect           | GitHub App install/authorize URL with signed state  |
| POST   | /api/integrations/github/callback          | Verify state, exchange code, store encrypted tokens |
| POST   | /api/integrations/:id/reconnect            | Authorize again                                     |
| DELETE | /api/integrations/:id?purgeData=           | Disconnect (revoke token; keep or purge data)       |
| POST   | /api/sync                                  | Queue a sync (202; 409 in progress / needs reauth)  |
| GET    | /api/sync/status · /sync/runs · /runs/:id  | DB-backed state, progress, history                  |
| GET    | /api/repos · PATCH /repos · /repos/:id     | Repositories; include/exclude (recomputes KPIs)     |
| POST   | /api/repos/:id/purge                       | Delete a repository's synced activity               |
| POST   | /api/webhooks/github                       | GitHub App webhook (public, HMAC, idempotent, 202)  |
| GET    | /api/activity/commits · /prs?role=         | Cursor-paginated activity (`authored`/`reviewed`)   |
| GET    | /api/activity/summary                      | Aggregated stats (deprecated → P07 metrics)         |
| POST   | /api/generate/{resume,appraisal,promotion} | v1 generators (AI rate limit; P08 → /documents)     |
| GET    | /api/generate/impact-score                 | Deprecated LLM score (P07 → /impact)                |
| GET    | /api/documents · /:id, DELETE /:id         | Generated documents                                 |

Web routes: `/api/auth/*` (Better Auth), `POST /api/dev-login` (development only), `GET /api/health`.

**Adding an endpoint:** define request/response Zod schemas in `packages/shared/src/api/`, use
them in the controller with `@ZodBody/@ZodQuery/@ZodParams` and `@ApiDoc`, take the user from
`@CurrentUser()` and scope every query by `userId`, throw `AppException` for expected failures,
pick a `@RateLimit()` class if not `default`, and add an integration test (the generated auth
test covers the 401 automatically).

## License

MIT
