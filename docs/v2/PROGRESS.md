# V2 Progress Tracker

Every phase session updates this file before opening its PR.

## Status

| # | Phase | Status | PR | Completed | Notes |
|---|---|---|---|---|---|
| 00 | Planning (this folder) | ✅ Done | — | 2026-11-09 | Baseline `ed6ed4f` confirmed; plan written |
| 01 | Audit & Discovery | ✅ Done | (this PR) | 2026-11-09 | 106 issues (🔴10 🟠34 🟡50 ⚪12); see `audit/` |
| 02 | Engineering Foundation & Stabilization | ✅ Done | #8 | 2026-11-09 | Green lint/typecheck/tests/build + CI, migrations, seed, worker, Docker |
| 03 | V2 Blueprint | ⏳ Not started | | | |
| 04 | UX/UI Design System & Prototype | ⏳ Not started | | | |
| 05 | Backend Platform | ⏳ Not started | | | |
| 06 | Sync Engine v2 | ⏳ Not started | | | |
| 07 | Metrics Engine & Impact Score v2 | ⏳ Not started | | | |
| 08 | AI Layer v2 | ⏳ Not started | | | |
| 09 | Frontend Foundation & App Shell | ⏳ Not started | | | |
| 10 | Frontend: Insights Pages | ⏳ Not started | | | |
| 11 | Frontend: AI Document Studio | ⏳ Not started | | | |
| 12 | Product Extensions | ⏳ Not started | | | |
| 13 | Additional Integrations (optional) | ⏳ Not started | | | |
| 14 | Hardening | ⏳ Not started | | | |
| 15 | Release v2.0.0 | ⏳ Not started | | | |

Status values: ⏳ Not started · 🚧 In progress · ✅ Done · ⏸ Deferred · ⛔ Blocked

## Phase log

<!--
Append one section per phase, newest last, using this template:

### Phase NN — <name> (YYYY-MM-DD)
**Branch / PR:** <branch> / <link>
**Summary:** 3–6 bullets of what changed.
**Deviations from the phase file:** what and why (or "none").
**Deferred items:** item → target phase.
**New issues found:** IDs added to audit/ISSUES.md.
**Handoff notes for next phase:** anything the next session must know
(commands, gotchas, env vars, seeded accounts, half-done work).
-->

### Phase 00 — Planning (2026-11-09)
**Summary:**
- Inspected all branches; the latest is the default branch `devin/1780303918-devimpact-ai-scaffold`
  at `ed6ed4f` (PRs #2, #3 merged into it; PR #1 → `init-branch` still open).
- Installed deps and ran typecheck/build: typecheck green, API builds, **web build fails**
  (Suspense boundary on `/connect/callback`), no worker entry, no lint config, no tests.
- Reviewed every source file; preliminary findings recorded in `00-CONTEXT.md §5`.
- Wrote the 15-phase plan in `docs/v2/`.

**Handoff notes for Phase 01:**
- Human must first do the one-time branching step in `README.md#branching-protocol`.
- `docker`, `psql`, `redis-server` and PostgreSQL 16 binaries exist in the cloud container.
  If Docker daemon is unavailable, run Postgres/Redis directly (see P01 task list).
- Delete `apps/*/tsconfig.tsbuildinfo` before building or `tsc` may emit nothing.

### Phase 01 — Audit & Discovery (2026-11-09)
**Branch / PR:** `claude/nifty-meitner-g23wt8` → `main` / PR "Phase 01: Audit & Discovery"
(integration branch `main` existed at `1cde043` = baseline `ed6ed4f` + planning docs).

**Summary:**
- Read every source file; wrote `audit/ARCHITECTURE_CURRENT.md` (component diagram, module table,
  ERD with field notes, 6 sequence diagrams, route map, env inventory, build/dependency audit; all
  Mermaid blocks validated with mermaid 11).
- Ran the stack: Postgres/Redis via compose, API + web dev servers, root build/typecheck/lint,
  Docker images (with sandbox-only CA/proxy injection). Recorded verbatim logs in `audit/logs/`.
- 87 API probes (≥ 3 per endpoint, incl. impersonation and destructive cross-tenant deletes) with a
  mock Anthropic server capturing real prompts → `audit/API_TEST_RESULTS.md`.
- Playwright: 12 routes × {1440, 390} × {seeded, empty, API down} + interaction pass + Nielsen
  heuristic review → `audit/UI_TEST_RESULTS.md`, 77 screenshots.
- Executed the real `SyncProcessor` against a fake GitHub: proved the reviewed-PR stub bug,
  silent loss on rate limits, and measured 8,732 GitHub calls for 30 repos × 200 commits.
- `audit/SPEC_GAP_MATRIX.md` (125 spec items: ✅42 🟡34 ❌21 ⚠️28), `audit/ISSUES.md` (106 issues,
  stable IDs, target phases; all 42 preliminary findings verified — 9 amended, 0 refuted),
  `audit/AUDIT_REPORT.md` (owner summary, top 10 risks, keep-vs-rewrite, effort outlook).
- Refreshed `00-CONTEXT.md` §4–§5.

**Deviations from the phase file:**
- `docker compose up --build` could not be run as-is in the cloud container (Docker Hub 429, and
  build containers have no route to the npm registry). Images were built from throw-away copies of
  the Dockerfiles that only add the sandbox CA/proxy (kept in the session scratchpad, not committed),
  iterating past each real defect to find the next one. Every defect found is a real issue
  (OPS-01/02/03/04/05/06/09/12/14).
- Empty-state screenshots were taken with the mock Anthropic server running, so the empty
  dashboard shows the mock's score (72). The behaviour shown (auto-generating a score for an empty
  month) is real; the number is the mock's. Noted in `UI_TEST_RESULTS.md`.
- No code fixes were made. `apps/*/tsconfig.tsbuildinfo` were regenerated by builds locally and
  restored before committing; `git diff --stat` touches only `docs/v2/`.

**Deferred items:** none.

**New issues found:** 46 issues not covered by the preliminary list — notably OPS-01 (Dockerfiles miss
`tsconfig.base.json`), OPS-02 (API crashes on Node 18, ESM-only octokit), OPS-07 (README quick
start broken), BUG-14 (resume page shows an empty card), BUG-02 (OAuth code posted 3×), BUG-03
(`dev:api` emits nothing after a build), SEC-05 (`repo` write scope), SEC-12 (internal error
leaks), AI-07 (mislabeled prompt metrics), UX-02/04/05. Full list: `audit/ISSUES.md`.

**Handoff notes for next phases:**
- *Exact commands that got the stack running (cloud container):*
  ```bash
  dockerd > /tmp/dockerd.log 2>&1 &          # daemon is not started by default
  docker compose up -d postgres redis
  cp .env.example .env                       # dummy GitHub/Anthropic values are fine
  set -a; . ./.env; set +a                   # REQUIRED: Prisma CLI and Nest don't read the root .env (OPS-07)
  npm ci
  (cd apps/api && npx prisma generate && npx prisma db push)
  rm -f apps/api/tsconfig.tsbuildinfo        # REQUIRED before dev:api after any build (BUG-03)
  npm run dev:api                            # :4000
  env -u PORT NEXT_PUBLIC_API_URL=http://localhost:4000/api npm run dev:web   # unset PORT or next binds 4000 (OPS-08)
  node docs/v2/audit/scripts/seed-fixture.ts # test data (Alice + Bob)
  ```
  Optional AI without a key: `node docs/v2/audit/scripts/mock-anthropic.mjs 4010` and start the API
  with `ANTHROPIC_BASE_URL=http://localhost:4010`.
- *Local-only hacks used (not committed):* manual `dockerd`; `docker compose -p devimpact` (dir name
  `ai_` makes an invalid image tag, OPS-09); `mirror.gcr.io/library/node:18-alpine` retagged
  (Docker Hub 429); Dockerfile copies with CA/proxy injection; deleting `tsconfig.tsbuildinfo`.
- *Issue counts:* 🔴 10 · 🟠 34 · 🟡 50 · ⚪ 12 (106).
- *P02 must prioritise:* OPS-01/02/03/04/05/06 (Docker on Node 22, worker entry, migrations),
  BUG-01, BUG-03 + DEBT-04, OPS-07/08/09/10 (env loading/validation, compose name, ports),
  DEBT-01/02/03/05, SEC-09 patch (`next@14.2.35`) and SEC-10 backend upgrades. Recommended cheap
  hotfixes in files P02 touches anyway: BUG-14 (resume response shape) and BUG-02 (callback runs
  once; same file as BUG-01).
- *P03 must decide:* auth stack (D-003, unblocks SEC-01/02/GAP-06); data model for authored vs
  reviewed PRs and sync runs (DATA-01, DATA-06, DATA-10); GitHub App vs OAuth App scopes (SEC-05);
  deterministic KPI/impact methodology to replace the LLM score (AI-01, UX-06).
- `octokit`'s bundled throttling plugin waits 60 s when `retry-after` is `0`/missing — mocks in
  future sync tests should send a non-zero `retry-after` or disable throttling.

### Phase 02 — Engineering Foundation & Stabilization (2026-11-09)
**Branch / PR:** `claude/beautiful-ride-etq7qo` → `main` / #8

**Summary:**
- Repo hygiene: untracked `tsconfig.tsbuildinfo`, committed the initial Prisma migration, `.nvmrc`,
  `.editorconfig`, Prettier (+ tailwind plugin) with a separate `chore: format` commit.
- Dependencies: Node 22, NestJS 11, Prisma 6.19, Next 14.2.35, next-auth 4.24.15, zod 4.6, TS 5.9,
  BullMQ 5.81; unused deps pruned; API prod `npm audit` clean (D-015).
- Tooling: root ESLint 9 flat config (strict-type-checked), API `strict: true`, buildable
  `packages/shared` (CommonJS + d.ts) used by both apps; `npm run check`.
- Runtime: Zod env schemas (API fail-fast, web), root `.env` loaded everywhere, `REDIS_URL`,
  `API_PORT`, `WEB_URL`; `src/worker.ts` + `RUN_WORKER_IN_API`; `GET /api/health`.
- Fixes: BUG-01 (Suspense), BUG-02 (single OAuth exchange), BUG-14 (resume bullets array via
  shared schema); Docker images on Node 22 with `npm ci`, migrations on start, standalone web;
  compose with project name, healthchecks for every service and a real worker.
- Tests + CI: API Jest unit (21) + integration (10, real Postgres/Redis), web Vitest (19),
  shared Vitest (5), Playwright smoke (1); GitHub Actions jobs quality / integration / e2e / docker.
- Deterministic seed (`demo@devimpact.dev`), README and testing skill rewritten.

**Deviations from the phase file:**
- NestJS 11 / Prisma 6 instead of "latest" (12 / 8-rc) — see D-015 and DEBT-10.
- ESLint uses `@next/eslint-plugin-next` directly (wrapped with `@eslint/compat`) instead of the
  legacy `eslint-config-next` preset, which doesn't support flat config on ESLint 9. Next's
  build-time lint is disabled; the root `npm run lint` covers web.
- `npm run check` also runs `format:check`. Integration and E2E tests are separate commands
  (they need Postgres/Redis and built apps) and run in their own CI jobs.
- Added (small, dev-only) `NEXT_PUBLIC_DEV_LOGIN_EMAIL` so the seeded demo is visible in the UI
  without hand-editing `localStorage`; removed with dev-login in P05.
- Added a global `EmptyBodyInterceptor`: Express 5 (NestJS 11) leaves `req.body` undefined for
  unparsed bodies, which changed probe AUTH-4; the interceptor restores v0.1 behaviour until P05.
- Docker verification in the cloud container used throw-away Dockerfile copies that inject the
  sandbox CA/proxy as build args (build containers can't reach npm otherwise) and
  `mirror.gcr.io` base images retagged locally; then `docker compose up --no-build --wait` →
  all 5 services healthy, `/api/health` 200, worker consumed a sync job. The CI `docker` job runs
  the real `docker compose build` + `up --wait`. `apk add openssl` was dropped (base image ships
  libssl3; Alpine repos are also blocked in the sandbox).
- `prisma migrate reset` refuses to run for AI agents without explicit user consent. The
  acceptance check "reset → seed" was verified equivalently: drop/create database with `psql`,
  `prisma migrate deploy`, `prisma db seed` (twice: identical counts, idempotent).

**Behaviour check (P01 API probes re-run):** `docs/v2/audit/logs/api-probes-p02.jsonl` — same
87 probes, same fixture, mock Anthropic: **83 identical, 0 status changes**, 4 body diffs, all
explained: GEN-R1/R7/R8 (resume `bullets` is now the array — BUG-14 fix); GEN-2 (Prisma error
still leaked, SEC-12, but the path now points at `dist/` because the probe ran the built API
instead of `nest start --watch`).

**Deferred items:**
- Remaining Next 14 advisories (SEC-09) → P09 major upgrade. Web `npm audit` gate in CI → P09.
- Newer majors (DEBT-10) → P05–P14. Resume page bundle size (PERF-05) → P09.
- Full migration of API/web contracts to `packages/shared` (DEBT-01) → P05/P09.

**New issues found:** PERF-05, DEBT-10 (added to `audit/ISSUES.md`).

**Handoff notes for next phases:**
- *Commands (repo root):* `npm ci` · `npm run check` · `npm run test:int` · `npm run test:e2e`
  (after `npm run build && npm run db:deploy && npm run db:seed`) · `npm run dev:api` /
  `dev:web` / `dev:worker` · `npm run db:migrate -- --name x` · `npm run db:reset`.
- *Seeded account:* `demo@devimpact.dev` (+ `teammate@devimpact.dev`, whose PRs the demo user
  reviews — the seed never stores reviewed PRs as the demo user's PRs). ~417 commits, ~63
  authored PRs, ~69 reviews, 28 issues, 6 placeholder monthly impact scores, 3 documents; counts
  are deterministic relative to the run date.
- *Skipped/todo tests (un-skip when fixed):* DATA-01, BUG-09 (`sync.processor.spec.ts`);
  AI-04, AI-05 (`ai.service.spec.ts`) — skipped; DATA-04, AI-02, BUG-06, DATA-02 — todo.
  `activity.int-spec.ts` characterises SEC-01 (200 + error body without `x-user-id`): update it in P05.
- *Test plumbing:* `createTestApp(override?)` in `apps/api/test/utils/app.ts`, factories in
  `test/utils/factories.ts`, `resetDatabase()` truncates every table. `octokit` (ESM-only) is mapped
  to a throwing stub in Jest — mock `GitHubService` in tests. Unit tests pin `TZ=UTC`.
- *Env:* see `.env.example`. New: `API_PORT`, `WEB_URL`, `RUN_WORKER_IN_API`,
  `WORKER_HEARTBEAT_FILE`, `DATABASE_URL_TEST`, `NEXT_PUBLIC_DEV_LOGIN_EMAIL`. Removed: `PORT`,
  `REDIS_HOST/PORT` from the example (`PORT`/`NEXTAUTH_URL` still accepted as fallbacks).
- *Cloud container:* Postgres 16 + Redis run natively (`pg_ctlcluster 16 main start`,
  `redis-server --daemonize yes --dir /tmp`); roles/dbs `devimpact`, `devimpact_test` must be
  created once. Playwright is pinned to 1.63.0 to match the pre-installed Chromium.
- *CI timing:* see the PR's first CI run (jobs run in parallel; docker job is the slowest).

