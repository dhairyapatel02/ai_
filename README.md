# DevImpact AI — Engineering Career Operating System

AI-powered platform that connects to your developer tools (GitHub first; GitLab and Jira later)
and uses Claude to turn engineering activity into resume bullet points, performance appraisals,
KPI dashboards, promotion packets and impact scores.

> **Status:** v0.1 → v2.0 rebuild in progress. The plan, decisions and progress live in
> [`docs/v2/`](docs/v2/README.md). Authentication is still a development stub (`x-user-id`
> header + dev-login) until Phase 05 — do not deploy publicly.

## Tech stack

| Layer    | Technology                                                                |
| -------- | ------------------------------------------------------------------------- |
| Frontend | Next.js 14 (App Router), Tailwind CSS, shadcn/ui                          |
| Backend  | NestJS 11 (REST API) + a separate BullMQ worker process                   |
| Database | PostgreSQL 16 + Prisma 6 (committed migrations)                           |
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
Docker services below. The API, worker, Prisma CLI, seed script and Next.js all read this **root**
`.env` — you don't need to export it. The API exits at startup with a readable message if a
required variable (`DATABASE_URL`, `REDIS_URL`) is missing or malformed.

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

- Web: http://localhost:3000 — with `NEXT_PUBLIC_DEV_LOGIN_EMAIL=demo@devimpact.dev` (the
  `.env.example` default) the dev auto-login opens the seeded demo account. If you visited before,
  clear `localStorage.devimpact_user_id` in the browser.
- API: http://localhost:4000/api — health check at `GET /api/health`.

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

## Full stack with Docker

```bash
docker compose up --build
```

Starts postgres, redis, api (applies migrations on start), worker and web; every service has a
healthcheck (`docker compose ps`). `.env` is optional here — compose sets the connection settings.
Seed the containerised database from your machine with `npm run db:seed` (it uses
`localhost:5432`). To bake the demo login into the web image, export
`NEXT_PUBLIC_DEV_LOGIN_EMAIL=demo@devimpact.dev` before building. Behind a registry rate limit, pass
a mirror: `docker compose build --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-alpine`.

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

**E2E tests** need built apps and a migrated, seeded database. Playwright starts the API and web
servers itself (or reuses ones already running locally):

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

Tests never call the real GitHub or Anthropic APIs: `octokit` is stubbed in Jest and AI calls are
mocked. Known v0.1 bugs are captured as `it.skip` / `it.todo` tests tagged with their issue ID from
[`docs/v2/audit/ISSUES.md`](docs/v2/audit/ISSUES.md); the phase that fixes a bug un-skips its test.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on pushes
to `main`:

1. **quality** — lint, format check, typecheck, unit tests, `npm audit` for API production deps
2. **integration** — API integration tests with Postgres 16 + Redis 7 service containers
3. **e2e** — build all workspaces, migrate + seed, Playwright smoke (report uploaded on failure)
4. **docker** — `docker compose build`, start the stack, wait for healthchecks, probe `/api/health`

## API endpoints

All routes are prefixed with `/api`. Until Phase 05 the caller is identified by the `x-user-id`
header.

| Method | Path                              | Description                       |
| ------ | --------------------------------- | --------------------------------- |
| GET    | /api/health                       | Postgres + Redis health (200/503) |
| POST   | /api/auth/dev-login               | Development login (stub)          |
| GET    | /api/auth/me                      | Current user profile              |
| GET    | /api/integrations                 | List connected integrations       |
| POST   | /api/integrations/github/connect  | Start GitHub OAuth                |
| POST   | /api/integrations/github/callback | Exchange the OAuth code           |
| DELETE | /api/integrations/:id             | Disconnect integration            |
| POST   | /api/sync/trigger                 | Queue a GitHub sync               |
| GET    | /api/sync/status                  | Sync job status                   |
| GET    | /api/activity/commits             | Paginated commits                 |
| GET    | /api/activity/prs                 | Pull requests                     |
| GET    | /api/activity/summary             | Aggregated stats                  |
| POST   | /api/generate/resume              | Generate resume bullets           |
| POST   | /api/generate/appraisal           | Generate appraisal report         |
| POST   | /api/generate/promotion           | Generate promotion packet         |
| GET    | /api/generate/impact-score        | Calculate impact score            |
| GET    | /api/documents                    | List generated documents          |
| GET    | /api/documents/:id                | Get document                      |
| DELETE | /api/documents/:id                | Delete document                   |

## License

MIT
