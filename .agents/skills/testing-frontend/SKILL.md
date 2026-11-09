---
name: testing-devimpact-frontend
description: Run and test the DevImpact AI stack locally (API, worker, web) with seeded demo data. Use when verifying UI pages, API wiring, or running the unit/integration/E2E suites.
---

# Testing DevImpact AI locally

All commands run from the repo root. Requires Node 22 (`.nvmrc`). The root `.env` is read
automatically by the API, worker, Prisma CLI, seed script and Next.js — never export it.

## One-time setup

```bash
npm ci                                  # also builds packages/shared + generates Prisma client
cp .env.example .env                    # defaults work; no GitHub/Anthropic keys needed
docker compose up -d postgres redis     # cloud container: start `dockerd` first, or use local pg/redis
npm run db:deploy                       # apply committed migrations
npm run db:seed                         # demo@devimpact.dev with ~9 months of data
```

Cloud-container notes: Docker's daemon is not running by default (`dockerd > /tmp/dockerd.log 2>&1 &`)
and Docker Hub may rate-limit; PostgreSQL 16 and `redis-server` are also installed natively
(`pg_ctlcluster 16 main start`, `redis-server --daemonize yes`; create role/db `devimpact` with
password `devimpact_password` plus `devimpact_test`).

## Run the apps

```bash
npm run dev:api      # http://localhost:4000/api  (GET /api/health)
npm run dev:web      # http://localhost:3000
```

`NEXT_PUBLIC_DEV_LOGIN_EMAIL=demo@devimpact.dev` (default in `.env.example`) makes the auto
dev-login open the seeded account. Reset the browser identity with
`localStorage.removeItem('devimpact_user_id')`.

Optional AI without a key: `node docs/v2/audit/scripts/mock-anthropic.mjs 4010` and set
`ANTHROPIC_BASE_URL=http://localhost:4010` in `.env`.

## Test suites

```bash
npm run check        # lint + format:check + typecheck + unit tests + build
npm run test:int     # API integration tests (needs Postgres + Redis, uses DATABASE_URL_TEST)
npm run test:e2e     # Playwright smoke; needs `npm run build`, migrated + seeded DB
```

Playwright: Chromium is pre-installed in the cloud container and `@playwright/test` is pinned to
match it — don't run `playwright install` there. Traces are off by default (`--trace on` to debug).

## Expected UI with the seeded demo account

| Path        | Expect                                                                     |
| ----------- | -------------------------------------------------------------------------- |
| /dashboard  | Non-zero "Commits This Month", "PRs Merged", "Reviews Done"; impact ~60–85 |
| /kpis       | Non-zero productivity/collaboration numbers                                |
| /career     | Timeline grouped by quarter across 5 repos                                 |
| /connect    | GitHub shown as connected (placeholder token — Sync will fail)             |
| /resume etc | Generation fails without `ANTHROPIC_API_KEY` (or use the mock server)      |

## Gotchas

- Known v0.1 behaviour bugs are tracked in `docs/v2/audit/ISSUES.md` (e.g. no real auth until P05).
- Ports: API 4000 (`API_PORT`), web 3000 (`next dev --port`). Kill leftovers with
  `pkill -f next-server; pkill -f dist/main.js`.
- `prisma migrate reset` asks AI agents for explicit user consent; drop/recreate the scratch
  database with `psql` and run `npm run db:deploy` instead when working autonomously.
