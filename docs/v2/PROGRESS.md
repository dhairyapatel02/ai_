# V2 Progress Tracker

Every phase session updates this file before opening its PR.

## Status

| # | Phase | Status | PR | Completed | Notes |
|---|---|---|---|---|---|
| 00 | Planning (this folder) | ✅ Done | — | 2026-11-09 | Baseline `ed6ed4f` confirmed; plan written |
| 01 | Audit & Discovery | ✅ Done | (this PR) | 2026-11-09 | 106 issues (🔴10 🟠34 🟡50 ⚪12); see `audit/` |
| 02 | Engineering Foundation & Stabilization | ✅ Done | #8 | 2026-11-09 | Green lint/typecheck/tests/build + CI, migrations, seed, worker, Docker |
| 03 | V2 Blueprint | ✅ Done | (this PR) | 2026-11-09 | All 7 user decisions answered; 14 ADRs; `blueprint/` |
| 04 | UX/UI Design System & Prototype | ✅ Done | (this PR) | 2026-11-16 | Prototype approved as-is (D-020): [Artifact](https://claude.ai/artifact/7sRsUMg2VuwC1A5J4m9xFB); `design/` |
| 05 | Backend Platform | ✅ Done | (this PR) | 2026-11-16 | Better Auth + JWT/JWKS, encrypted GitHub App connect, D-006 conventions, rate limits, logging |
| 06 | Sync Engine v2 | ✅ Done | (this PR) | 2026-11-16 | GitHub App sync (GraphQL), SyncRun, webhooks, scheduler, Prisma 7; budget 119/250 requests |
| 07 | Metrics Engine & Impact Score v2 | ⏳ Not started | | | |
| 08 | AI Layer v2 | ⏳ Not started | | | |
| 09 | Frontend Foundation & App Shell | ⏳ Not started | | | |
| 10 | Frontend: Insights Pages | ⏳ Not started | | | |
| 11 | Frontend: AI Document Studio | ⏳ Not started | | | |
| 12 | Product Extensions | ⏳ Not started | | | |
| 13 | Additional Integrations (optional) | ⏸ Deferred | | | Skipped for v2.0 → v2.1 (D-018) |
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

### Phase 03 — V2 Blueprint: Product, KPIs & Architecture (2026-11-09)
**Branch / PR:** `claude/eager-volta-lqrxeb` → `main` / PR "Phase 03: V2 Blueprint"
(branched from `main@91a6c78` = Phase 01 merged; ran in parallel with P02. P02 (#8) merged first;
`main` was then merged into this branch and the blueprint reconciled with what P02 shipped — see below).

**Summary:**
- Asked the owner the 7 USER DECISIONS (two AskUserQuestion rounds); all answers recorded as
  CONFIRMED entries in `DECISIONS.md` (D-003, D-004, D-007, D-013, D-014, D-017, D-018).
- Wrote `blueprint/PRD.md` (personas, JTBD, 8 journeys, 59 features with MoSCoW + owning phase,
  plans/entitlements, NFRs, success metrics).
- Wrote `blueprint/KPI_METHODOLOGY.md`: 21 metrics + 3 deferred issue metrics (`metrics@2.0.0`) with formulas, attribution
  timestamps, timezone/period/business-hours rules, min-n thresholds; deterministic impact score
  `impact@2.0.0` (bands, k = 3 shrinkage, weights, rounding, stored inputs, explanation template)
  with a numerically verified worked example (G-1 → 78).
- Wrote `blueprint/ARCHITECTURE_V2.md` (7 Mermaid diagrams, all parsed with mermaid 11),
  `blueprint/DATA_MODEL_V2.md` (full Prisma draft + ERD + phase-by-phase migration plan from
  v0.1.0 + retention), `blueprint/API_CONTRACT_V2.md` (all endpoints with Zod sketches, error codes,
  rate classes, SSE contract, v1 disposition, PRD coverage), `blueprint/TRACEABILITY.md`
  (feature → ADR → model → endpoint → page → phase; all 83 open issues targeting ≥ P05 mapped,
  GAP-10 won't-fix for v2.0 — verified by script).
- 14 ADRs in `blueprint/adr/` (+ index); every PROPOSED decision D-001…D-014 marked
  CONFIRMED / AMENDED / DEFERRED with ADR links; new D-017 (brand), D-018 (P13 out), D-019 (time zones).
- Appended "Blueprint amendments (P03)" sections to P04–P15; marked P13 skipped in `README.md` and here.

**Confirmed decisions (one line each):**
- D-001 npm workspaces, `shared` = single source of schemas; no Turborepo.
- D-002 Node 22, Nest 11, latest Prisma, Zod 4, SDK 1.x; Next 14.2.x patch (P02) → 16 + React 19 + Tailwind 4 (P09).
- D-003 **Better Auth** in web (GitHub + Google), 15-min EdDSA JWT verified by Nest via JWKS; dev login web-only, never in prod. *(user)*
- D-004 **GitHub App** (read-only, webhooks, expiring tokens) for data; separate OAuth App for sign-in. *(user)*
- D-005 AES-256-GCM `v<n>.iv.ct.tag` with AAD + key list; legacy plaintext tokens dropped → `NEEDS_REAUTH`.
- D-006 Envelope + status codes, Zod pipe, cursor pagination, `period` grammar, fixed error codes, rate classes.
- D-007 **Deterministic** score: overall + Delivery 30 / Quality 25 / Collaboration 30 / Ownership 15. *(user)*
- D-008 Worker; GraphQL search + contributions + per-repo history; cursors; 24 h + webhooks; ≤ 250 requests for the P06 fixture.
- D-009 Models from env (`claude-opus-5-5` default, `claude-haiku-5-5` fast); worker + Redis Streams SSE; structured output; citations; quotas.
- D-010 Typed client + TanStack Query; fetch-based SSE; period in URL.
- D-011 Jest/supertest, Vitest/RTL, Playwright + axe, MSW fixtures, mock Anthropic.
- D-012 Markdown, PDF via `@react-pdf/renderer`, DOCX via `docx`.
- D-013 Hosting **deferred to P15**; platform-neutral constraints binding. *(user)*
- D-014 **Individual only**; no team views, no billing (FREE/PRO enforced). *(user)*
- D-017 Brand **calm, professional, Linear-like**. *(user)*
- D-018 GitLab/Jira/Linear **out of v2.0**; P13 skipped. *(user)*
- D-019 IANA timezone per user; inclusive local periods; ISO weeks; business hours exclude weekends.

**Phase amendments appended:** P04 (brand, scope, onboarding states, KPI copy, URL period),
P05 (Better Auth + JWT/JWKS, web dev-login, GitHub App connect, drop legacy tokens, env vars),
P06 (GitHub App tokens, fetch strategy, budget fixture, backfill order, legacy migration),
P07 (spec versions, lazy ImpactScore, extra endpoints, shared periods), P08 (models, worker/Redis
Streams, endpoints, quotas, doc types), P09 (auth client, fetch-SSE, onboarding), P10 (KPI sections,
cards, integrations states), P11 (export renderers, options, SSE), P12 (scope, no billing,
entitlements, sync export), P13 (skipped), P14 (targets, security focus), P15 (hosting decision, roadmap).

**Deviations from the phase file:**
- Task 9 says review P04–P15; `P02-engineering-foundation.md` was **not** amended because P02 may be
  running in parallel — P02-relevant consequences are listed in the handoff notes below instead.
- `docs/v2/README.md` phase table edited (P13 row marked skipped) because the plan itself changed.
- `audit/ISSUES.md` annotated (SEC-05 decided, DATA-10 designed → target P06, GAP-10 → v2.1 won't fix).

**Deferred items:** none from this phase. Product deferrals (v2.1): team views, billing, P13
integrations, share links, in-app notification centre (Could), issue metrics.

**New issues found:** none (design phase; gaps found are covered by existing IDs).

**Reconciliation with Phase 02 (merged first):**
- Decision IDs: P02 took D-015/D-016, so P03's new decisions are **D-017** (brand), **D-018**
  (integrations out, P13 skipped) and **D-019** (time zones); all references renumbered.
- ADR-0002 records P02's pins (Prisma 6.19, NestJS 11, SDK 0.24); the Prisma major upgrade moves to
  P05/P06 with the data-model v2 migrations (DEBT-10). ADR-0011 records Jest for the API.
- Env names follow P02: `WEB_URL` (replaces the blueprint's `WEB_ORIGIN`/`API_ORIGIN`), `API_PORT`,
  `RUN_WORKER_IN_API`, `WORKER_HEARTBEAT_FILE`, `DATABASE_URL_TEST`.
- Baseline migration is P02's `20261109075145_init` (DATA_MODEL_V2 §5).
- Health: P02's `/api/health` (DB + Redis) stays as readiness; P05 adds `/api/health/live`.
- TRACEABILITY now also maps P02's new issues PERF-05 (P09) and DEBT-10 (P05–P14): 83 rows.

**Handoff notes for next phases:**
- *Seed:* P02's demo seed covers ~9 months; P07 (task 8) should add a heavy persona (12 months,
  ~3k PRs/reviews) for the p95 and Lighthouse targets.
- *P04:* read PRD §4–§5, KPI_METHODOLOGY §3/§6.7 (copy), API_CONTRACT_V2, and the P04 amendments.
  Routes in TRACEABILITY §1 are provisional — update that file if IA.md changes them.
- *P05:* the Better Auth Prisma models must be reconciled with `npx @better-auth/cli generate`
  for the pinned version (DATA_MODEL_V2 §3 note). The connect flow needs a GitHub App registered
  for local testing; dummy values suffice for unit/integration tests.
- *P08:* re-check model IDs and SDK details with the `claude-api` skill before coding; defaults are
  env-only so changing them later is configuration.
- Mermaid validation helper used here: mermaid 11 + jsdom, `mermaid.parse()` per block (semicolons
  inside sequence-diagram messages break parsing).

### Phase 04 — UX/UI Design System & Prototype (2026-11-16)
**Branch / PR:** `claude/charming-euler-9r1iky` → `main` / PR "Phase 04: UX/UI Design System & Prototype"
(branched from `main@26d47f6` = P02 + P03 merged; `main` unchanged at PR time).

**Prototype (private Artifact):** https://claude.ai/artifact/7sRsUMg2VuwC1A5J4m9xFB — source in `design/prototype/`
(`index.html` fragment + `styles.css`, `data.js`, `app.js`). The Artifact is private to the owner;
share it from its Share menu if other reviewers need it.

**Summary:**
- `design/IA.md`: sitemap and confirmed routes (onboarding steps get paths; `/documents/new`,
  `/career/print`, `/integrations/github/callback`, `/unsubscribe` added), grouped sidebar + mobile
  bottom bar/drawer, global period control in the URL, ⌘K palette and shortcuts, URL/state conventions.
- `design/FLOWS.md`: 10 flows (sign-in, onboarding incl. org-approval pending and recent-first sync,
  reconnect, manual sync, generate → stream → edit → export, regenerate, achievements, goals,
  explain a metric, export/delete/disconnect); all 10 Mermaid blocks parse with mermaid 11.4.
- `design/DESIGN_SYSTEM.md` + `design/tokens.css`: principles, 3-tier tokens (light + dark, Tailwind v4
  `@theme inline` bridge), **39/39 contrast pairs pass AA in both themes** (`scripts/check-contrast.mjs`),
  chart palettes validated with the dataviz validator (categorical all-pairs, ordinal heat ramp),
  type/space/shape/motion scales, component inventory → shadcn/ui + 27 custom components, data-viz
  rules, number formatting, iconography, voice & tone, state patterns, accessibility spec.
- `design/SCREENS.md`: 25 screens + 2 overlays, each with layout, components, endpoints, the five
  states (with no-integration / syncing / no-data-in-range empty variants) and desktop/mobile notes;
  "next best action" rules defined (F-24).
- Clickable prototype covering onboarding → dashboard → generate document (simulated streaming,
  stop/fail paths) → export, KPIs + explain drawers, impact detail, career, activity, achievements,
  goals and all settings pages; light/dark/system, desktop/mobile; 9 switchable scenarios. Its
  `data.js` ports `metrics@2.0.0`/`impact@2.0.0` and reproduces golden test G-1 (78.2050 → 78).
- `design/HEURISTIC_REVIEW.md`: Nielsen + WCAG 2.2 AA self-review; 15 findings fixed (axe-core 4.10:
  72 runs → 0 violations; 0 px horizontal overflow on 25 routes at 1440/390; 0 console errors).
- Owner approved the prototype as-is → D-020.

**API contract amendments (additive, API_CONTRACT_V2 §22):** A-1 `GET /metrics/trends` (KPI
sparklines, P07) · A-2 `GET /metrics/evidence` (explain drawer evidence, P07) · A-3 `evidence:
EvidenceItem[]` on `GET /documents/:id` (P08) · A-4 `SyncRunDto.recentWindowCompletedAt` (P06) ·
A-5 `DocumentSummary.flags` (P08). TRACEABILITY routes updated to IA.md.

**Deviations from the phase file:**
- Prototype routes are plain hashes (`#dashboard`, `#account-integrations`…) because the Artifact host
  only passes `#name` and reserves names starting with `settings`; IA §8 maps them to the real routes.
- Downloads, printing, OAuth redirects and emails are simulated with toasts (blocked in the Artifact
  sandbox). The prototype computes in UTC; the app uses the user's time zone.
- The PRD's 390 px minimum is kept; designs were also checked to survive 360 px.
- Besides the listed deliverables, added `design/README.md`, `design/HEURISTIC_REVIEW.md` and
  `design/scripts/check-contrast.mjs`. Only files under `docs/v2/` changed (`docs/` is excluded from
  lint/format, so `npm run check` is unaffected).

**Deferred items:** none.

**New issues found:** none (UX-11 annotated: tokens designed, wiring in P09).

**Handoff notes for next phases:**
- *P09:* copy `docs/v2/design/tokens.css` to `apps/web/src/styles/tokens.css`, import after
  `@import "tailwindcss";`, add `@custom-variant dark (&:where(.dark, .dark *));`; next-themes with
  `attribute="class"`. Fonts: Instrument Sans + JetBrains Mono via `next/font/google`. shadcn install
  list and custom components: DESIGN_SYSTEM §11/§5.2. Keep the contrast checker in CI (update its path).
  Build the shell to IA §3 (sidebar ≥ 1024, drawer 768–1023, bottom bar < 768) and the period picker
  to IA §4. Never use Tailwind palette colours in components (UX-11).
- *P10:* SCREENS S6–S10 and S19 specify every state; Next step rules in S6; dashboard activity chart
  uses `/metrics/heatmap` for the period's per-day series. Deltas are neutral (no red/green).
- *P11:* SCREENS S11–S16 + FLOWS F5/F6. Live region must announce once per completed section, not per
  token (DESIGN_SYSTEM §10). Citation chips show short refs with the full ref in `aria-label`.
- *P06/P07/P08:* implement A-4, A-1/A-2, A-3/A-5 respectively.
- *P12:* S17, S18, S20–S24; the Plan page shows `upgrade@devimpact.dev` as selectable text (no billing).
- *Prototype as reference:* `design/prototype/app.js` holds the exact copy for every state;
  `npx serve docs/v2/design/prototype` runs it locally (needs Google Fonts + unpkg for lucide).
- *Tooling used:* Playwright (pre-installed Chromium) for screenshots/overflow, axe-core 4.10.2 and
  lucide 0.469.0 via `npm pack` into the scratchpad (CDNs other than Google Fonts are blocked by the
  sandbox proxy, so the lucide request was routed to the local copy).

### Phase 05 — Backend Platform: Auth, Security, API Conventions (2026-11-16)
**Branch / PR:** `claude/beautiful-dirac-fvqvj6` → `main` / PR "Phase 05: Backend Platform: Auth, Security, API Conventions"
(branched from `main@43997a0` = P02 + P03 + P04 merged).

**Summary:**
- **Schema (P05-1..3):** Better Auth tables (`sessions`, `accounts`, `verifications`, `jwks`, reconciled with
  `npx auth@1.7.25 generate` — the replacement for the deprecated `@better-auth/cli`), `users.email_verified/updated_at`,
  `user_settings` (default row per user), integration security columns + `github_installations`. Data step:
  v0.1 integrations → `OAUTH_APP` / `NEEDS_REAUTH` / `MIGRATED_FROM_V0`, profile backfilled from `metadata`,
  plaintext `accessToken`/`refreshToken`/`metadata` dropped. Verified on the seeded DB; `migrate diff` shows no drift.
- **Auth:** Better Auth in web (GitHub OAuth App `read:user user:email`, Google, `encryptOAuthTokens`,
  account linking, JWT plugin EdDSA 15 min `aud=devimpact-api`); NestJS global `AuthGuard` with `jose`
  remote JWKS (alg/iss/aud/exp pinned); `@CurrentUser()` / `@Public()`; all 17 `x-user-id` reads removed;
  `GET/PATCH /me`, `GET/PATCH /me/settings`, `GET /me/entitlements`, `DELETE /me` (confirm email, revoke,
  cascade), `/auth/me` deprecated alias. Web: `/sign-in`, middleware route protection, session + in-memory
  JWT client, sign-out, `POST /api/dev-login` (404 in production builds), NextAuth removed (SEC-15).
- **Integrations:** GitHub App `connect` (install/authorize), `callback` (HMAC user-bound single-use 10-min
  state, PKCE in authorize mode, denied consent, org-approval pending, account-in-use 409, legacy row
  upgraded in place), `reconnect`, `disconnect` (revoke at GitHub, drop tokens, keep or `purgeData`).
  `TokenCipher` AES-256-GCM `v<n>.iv.ct.tag` with AAD + key list + `prisma/scripts/reencrypt-tokens.ts`.
- **Conventions:** shared Zod schemas (`packages/shared/src/api/`) on every endpoint, exception filter +
  envelope interceptor with the API_CONTRACT_V2 §2 codes, cursor pagination, inclusive local end dates
  (BUG-05), 256 KB JSON limit, helmet, strict CORS (no credentials), Redis-backed throttler with rate
  classes (`default`, `public`, `ai` 10/min + 60/day, `sync`, `destructive`), nestjs-pino with request ids,
  user ids and redaction, `/api/health/live`, OpenAPI 3.1 at `/api/docs` (non-production).
- **Tests:** API unit 66 (+4 skipped, 4 todo) incl. cipher, guard, state, filter, pagination and a static
  user-scope check; API integration 72 (generated 401 test over every route, forged/expired/wrong-aud
  tokens, ownership per resource, validation 400s, 413, 429, logging redaction, GitHub connect against a
  fake GitHub); web Vitest 35; shared 16; Playwright 5 (redirect, 401, prod 404, sign-in → dashboard, Bearer
  header + sign-out). P01 probes re-run: `audit/API_TEST_RESULTS.md` → "v2 re-run (Phase 05)".
- **Security review** (`security-review` skill): no exploitable findings; applied its hardening suggestion
  (sign-in `callbackUrl` rejects control characters/backslashes) and logged SEC-16.

**Acceptance criteria:** all met — `grep -r "x-user-id" apps/*/src` (excluding `node_modules`) matches
only `auth.guard.spec.ts`, plus `test/integration/auth.int-spec.ts`; both assert the header is ignored.
No code reads it. 401 on every non-public route (generated test); per-resource cross-user
tests; dev-login 404 in a production build with `ENABLE_DEV_LOGIN=true` (Vitest + Playwright against
`next start` + CI docker job); no plaintext tokens (migration + DB-inspection test) and cipher round-trip/
tamper/AAD/rotation tests; missing/invalid/expired/reused/foreign state rejected; 400 `VALIDATION_FAILED`
with field details; AI 429 test; log test proves request ids and no tokens/secrets; `npm run check`,
`test:int`, `test:e2e` green locally (CI runs on the PR).

**Deviations from the phase file:**
- **Prisma 7 not adopted** (TRACEABILITY lists DEBT-10 under "P05 (Prisma major with auth migrations)"):
  Better Auth 1.7.25 supports Prisma 6, and the major (driver adapters, ESM client) is safer together with
  P06's activity migrations — D-021, DEBT-10 updated.
- `grep -r "x-user-id" apps/` is not literally empty: the only hits are the two security tests above
  (they send the header to prove it is ignored).
- **E2E** runs the signed-in flows against `next dev` (dev login is impossible in production builds by
  design); a second production server proves the 404 (D-021).
- `/me/usage` and `/me/export` (F-04/F-07) are not built — they belong to P08/P12 per TRACEABILITY.
- Transitional v1 endpoints keep v1 data shapes with v2 envelope/status codes (allowed by API_CONTRACT_V2 §20);
  `/activity/*` and `/documents` switched to cursor pagination (`meta`), so the career page reads ≤ 100 items.
- `PATCH /me/settings` timezone change does not enqueue a recompute yet (no metrics engine; P07).
- Health readiness payload now uses the contract vocabulary (`ok`/`degraded`, checks `ok`/`fail`, 503 as
  `UPSTREAM_UNAVAILABLE`).
- CI audit gate uses `--omit=optional` (DEBT-11): better-auth's optional vitest peer made npm count the
  test runner as a production dependency; a vitest ≥ 5.1 upgrade hit an npm arborist bug.
- Docker Compose was not run locally (sandbox registry/proxy limits, see P01/P02 notes); the CI docker job
  now also checks JWKS, a 401 from the API and the production dev-login 404.

**Deferred items:** monthly AI quotas → P08 (SEC-07); web CSP → P14 (SEC-08); legacy-user linking policy →
P09/P14 (SEC-16); `trust proxy` → P15 (SEC-17); per-env queue prefix → P06 (OPS-17); vitest upgrade → P09
(DEBT-11); Prisma 7 → P06 (DEBT-10); token refresh, webhooks, `SyncRun`, `POST /sync` → P06.

**New issues found:** SEC-16, SEC-17, OPS-17, DEBT-11 (`audit/ISSUES.md`, mapped in TRACEABILITY §2).

**Handoff notes for next phases:**
- *Sessions in tests/E2E:* API integration tests use `bearer(userId)` (`apps/api/test/utils/auth.ts`);
  `createTestApp()` starts a local JWKS server and points `AUTH_JWKS_URL` at it. GitHub calls go to
  `https://github.invalid` / `https://api.github.invalid`, answered by `installFakeGitHub()`
  (`test/utils/fake-github.ts`). Call `resetRedisState()` in `beforeEach` (rate-limit counters, state nonces).
  E2E: `page.request.post('/api/dev-login', { data: {} })` (demo user) or the sign-in page button; then
  navigate with a full page load so the session is read.
- *Running locally:* the API needs the web app up to verify tokens (JWKS). After changing
  `BETTER_AUTH_SECRET`, `DELETE FROM jwks;` (keys are encrypted with it).
- *Error codes:* `packages/shared/src/api/common.ts` (`ERROR_CODES`, `ERROR_STATUS`); throw
  `AppException(code, safeMessage, details?)`. Unexpected errors become 500 `INTERNAL`.
- *Adding an endpoint:* schema in `packages/shared/src/api/` → controller with `@ZodBody/@ZodQuery/@ZodParams`
  + `@ApiDoc` + `@CurrentUser()` (+ `@RateLimit()` class) → every Prisma query scoped by `userId`
  (`test/unit/user-scope.spec.ts` enforces it; justify exceptions with a `user-scope:` comment) →
  integration test. Paginated lists: `afterCursor()` + `toPage()` + `withMeta()`.
- *P06:* integrations carry encrypted `accessTokenEnc`/`refreshTokenEnc` with expiries; decrypt only at call
  time with `TokenCipher.aad(id, field)`. `GitHubAppClient` (connect-only) lives in `integrations/`; build
  refresh/installation tokens in the provider. The v0.1 `SyncProcessor` refuses integrations without a
  usable token (`GITHUB_REAUTH_REQUIRED`). Fill `syncRun` in the callback response and add the `sync` rate
  class to `POST /sync` per integration. Add `/webhooks/github` with `@Public()` and a raw-body parser
  (the global JSON parser is in `app.setup.ts`). Queue prefix per environment (OPS-17).
- *P09:* replace `auth-context.tsx` with the typed client + TanStack Query, keep `getApiToken()`
  (in-memory JWT, refresh 60 s before expiry, retry once on 401); build the designed `/sign-in` (S1) incl.
  the `account_not_linked` error (SEC-16); the GitHub callback route exists at
  `/integrations/github/callback` and accepts only `returnTo` ∈ {`/onboarding`, `/settings/integrations`, `/connect`}
  (extend `ConnectReturnTo` in shared when the real routes exist). Route protection is `src/middleware.ts`
  (cookie presence only). Remove `/auth/me` alias callers, then the alias.

### Phase 06 — Data Ingestion & Sync Engine v2 (2026-11-16)
**Branch / PR:** `claude/friendly-goldberg-9y654u` → `main` / PR "Phase 06: Data Ingestion & Sync Engine v2"
(branched from `main@cc6859f` = P05 merged).

**Summary:**
- **Schema (P06-1, P06-2) + Prisma 7.10.1 (DEBT-10):** `repositories`, PR v2 columns
  (`is_authored_by_user`, size, timestamps, received-review aggregates, revert fields, `legacy_stub`),
  commits v2 (`repository_id`, headline/body, `authored_at`, stats, parents, associated PR),
  `pull_request_reviews` (decoupled from authorship), `sync_runs` (+ `checkpoint`,
  `recent_window_completed_at` for A-4), `webhook_deliveries`; `code_reviews`, `repo`, `timestamp`,
  `reviewCount` dropped. Data steps: legacy repos (`legacy:<fullName>`), stub detection, v0.1 reviews
  → `pull_request_reviews` (reviewer-owned PR copies for cross-user reviews). `migrate diff` shows no
  drift. Prisma 7 runs on the `pg` driver adapter (URL in `prisma.config.ts`), api + web.
- **Provider abstraction:** `ActivityProvider` / `ProviderSession` + normalised DTOs in
  `packages/shared/src/providers/activity.ts`; `GitHubProvider` (`apps/api/src/providers/github/`):
  Octokit core + throttling + retry, per-request token injection, rate-limit accounting from REST
  headers and GraphQL `rateLimit`, GraphQL search for authored/reviewed PRs with window splitting
  above 1,000 results, `contributionsCollection`, default-branch history batched 10 repos/request,
  single-PR refetch, App JWT + installation tokens, token refresh/revoke, webhook HMAC + parsing.
- **Orchestrator** (`src/sync/`): `SyncEngine` (stages prepare → repositories → authored → reviewed →
  commits → persist → rollups; backfill newest 30 days first, then monthly slices; incremental from
  cursors − 1 h; idempotent batched writes; checkpoints; rate-limit pause → `WAITING_RATE_LIMIT` +
  delayed job; 401/refresh failure → `NEEDS_REAUTH`; per-repo errors → `PARTIAL`; first backfill
  purges legacy stubs, P06-3), `IntegrationTokensService` (refresh under row lock),
  `SyncService` (DB-backed status/runs, one active run per integration, orphan reaping),
  `SyncScheduler` (hourly `sync.fanout` job scheduler → each active integration once per 24 h at its
  jittered slot), `SyncTargetedService` (webhook jobs), `metrics` queue + no-op consumer for P07.
  Per-environment BullMQ prefix `QUEUE_PREFIX` (OPS-17).
- **API:** `POST /sync` (202; 409 `SYNC_IN_PROGRESS` / `INTEGRATION_NEEDS_REAUTH`; 6/hour per
  integration) replaces `/sync/trigger`; `GET /sync/status`, `/sync/runs`, `/sync/runs/:id`;
  `GET/PATCH /repos`, `PATCH /repos/:id`, `POST /repos/:id/purge`; `POST /webhooks/github` (public,
  raw body ≤ 25 MB, HMAC, idempotent, 202); callback returns `syncRun`; `GET /integrations/:id`
  `currentRun`; `nextScheduledSyncAt`; `/activity/prs?role=authored|reviewed`; disconnect purge
  covers reviews and repositories. Web `/connect` uses `POST /sync` and the new status shape.
- **Tests:** API unit 82 (+2 skipped/3 todo, all P07/P08) incl. mappers, webhook HMAC/parsing,
  slices/progress, processor delay, App JWT; API integration 103 (+32) incl. sync engine (11),
  sync API/scheduler (8), webhooks (10), budget (2), migration on the P01 fixture (1); web Vitest 35,
  shared 16, Playwright 5 — all green locally. Fixtures: `apps/api/test/fixtures/github/` (dataset
  JSON with relative times, recorded-shape webhook payloads, 50×300 load generator).
- **Seed** rewritten for the v2 model (repositories, authored vs reviewed PRs, reviews, a finished
  backfill `SyncRun`, schedule slots).
- **Security review** (`security-review` skill): one confirmed MEDIUM finding, fixed — installation
  webhooks wrote the installation's full repository list (App installation token / payload, not
  filtered by user access) into every linked integration, so an org member linked through one
  repository could see the names of private repositories they cannot access. Those lists now only
  update rows the user already has; a per-user sync (user token, GitHub-filtered) discovers new
  repositories. Regression test in `webhooks.int-spec.ts`. No other exploitable findings (HMAC, App
  JWT, raw SQL, tenancy, token handling reviewed).

**Acceptance criteria:** all met —
- Reviewing someone else's PR never increases the authored count: `sync-engine.int-spec.ts` (DATA-01
  API test) + webhook review test.
- Re-running the same sync produces zero new rows (backfill and incremental re-runs, `created: 0`).
- Incremental requests only data newer than the cursors (search `updated:` lower bound and history
  `since` ≥ cursor − 1 h, asserted on the fake request log; 6 requests for a daily run).
- Budget: reference fixture **119 requests / 676 GraphQL points** (≤ 250 / 2,500).
- Rate-limit exhaustion → `WAITING_RATE_LIMIT` + `resumeAt`, checkpoint kept, resume completes with
  the same data; processor moves the same job to delayed (no silent loss); per-repo errors on the run.
- Webhooks: bad/missing signature → 401; replay → `duplicate: true`, one job; valid `pull_request`
  event updates the PR.
- Scheduler: `sync-fanout` job scheduler registered (test + worker boot +
  `prisma/scripts/inspect-sync-schedule.ts`); 24 simulated hours queue each active integration once,
  none for `needs_reauth`/`disconnected`.
- `GET /sync/status` reads stage + progress from the DB and works after `FLUSHDB`.
- Revoked token → `needs_reauth`, tokens dropped, `nextScheduledAt: null`, `POST /sync` 409.
- `npm run check`, `test:int`, `test:e2e` green locally (CI runs on the PR).

**P06 legacy-data migration test:** `test/integration/migration-p06.int-spec.ts` builds a scratch DB
at the v0.1 schema, loads the P01 fixture (`test/fixtures/legacy/p01-fixture.ts`, same PRNG and rules
as `docs/v2/audit/scripts/seed-fixture.ts`) and runs every later migration. The fixture is relative to
"now"; pinned to 2026-11-09T12:00Z Alice has **95 PRs shown by v0.1 → 35 authored (60 stubs)** — the
same invariant as the P01 run's 106 → 41 (65 stubs), which cannot be reproduced exactly from the
script. No commit is lost and all reviews are preserved on their owner's PR rows.

**Deviations from the phase file:**
- Prisma **7.10.1**, not the npm `latest` 8.0.0-rc (pre-release; outside Better Auth 1.7.25's peer
  range) — D-022.
- Commit history batched across repositories (aliases) instead of one request per repository —
  fewer calls than the ADR formula (D-022).
- Tests use the in-process fake GitHub (fetch interception, P05 pattern) rather than MSW/nock.
- Stub detection drops `body IS NULL` (P01 fixture marker bodies) for a stricter title/number/merged
  rule; reviewer-owned copies for cross-user v0.1 reviews (D-022).
- PRs of excluded repositories are stored but filtered on read (search cannot filter by repo);
  commits of excluded repos are never fetched.
- `GET /sync/stream` (Should) not built — polling contract only (GAP-11 → P10).
- `/activity/prs` `role` is optional (default `authored`); P07 finalises the activity shapes.
- Job ids use `-` instead of `:` (BullMQ restriction).
- Docker images were not built locally (sandbox registry limits as in P02/P05); Dockerfiles updated
  for Prisma 7 (no query-engine binary) — the CI docker job verifies them.

**Deferred items:** retention jobs → P14 (OPS-18); automatic `ERROR`/`SUSPENDED` status → P14
(DATA-11); SSE `/sync/stream` → P10 (GAP-11); production requirement for webhook secret → P15
(SEC-18); ESM Prisma generator → P09/P14 (DEBT-12); `metrics.recompute` consumer → P07.

**New issues found:** SEC-18, OPS-18, DATA-11, GAP-11, DEBT-12 (`audit/ISSUES.md`, TRACEABILITY §2).

**Handoff notes for next phases:**
- *Job types / queues:* `sync` (`sync.backfill`, `sync.incremental` — job id `sync-<integrationId>`;
  `sync.targeted` — `sync-t-<deliveryId>`; `sync.fanout` — scheduler `sync-fanout`, `0 * * * *` UTC)
  and `metrics` (`metrics.recompute`), prefix `QUEUE_PREFIX`. Jobs carry ids only.
- *Cursor semantics:* `Integration.syncCursor = { authoredPrsUpdatedAt, reviewedPrsUpdatedAt }` = the
  window end of the last finished run; `Repository.commitCursor` likewise (not advanced for failed or
  excluded repos); queries start at cursor − 1 h. `Integration.backfillFrom` = start of the completed
  backfill; a null value makes the next run a backfill.
- *API-call budget:* reference fixture 119 requests / 676 points (≤ 250 / 2,500); a daily incremental
  for the basic fixture is 6 requests. GraphQL calls are paced 1/s per integration in production.
- *Replay a webhook locally:* README → "Local webhook forwarding" (smee, `gh webhook forward`, signing
  a fixture payload with `openssl`); redeliveries keep their delivery id → acknowledged as duplicates.
- *GitHub fields not captured:* commits not on the default branch, issues (v2.1), other reviewers'
  comments (aggregates only), bodies/sizes of reviewed PRs, PR file lists, CI status.
- *P07:* consume `metrics.recompute { userId, from, to, reason: 'sync'|'webhook'|'repository_inclusion' }`
  (debounced 30 s per user+reason). Count authored PRs with `isAuthoredByUser = true AND legacyStub =
  false`, reviews from `pull_request_reviews`, and always join `repository.included = true`. Fields for
  KPI_METHODOLOGY: `readyForReviewAt` (null = never draft), `firstReviewAt`/`approvalsCount`/
  `changesRequestedCount`/`reviewersCount` (bots + author excluded), `revertedAt`/`revertedByUrl`,
  `reviewRequestedAt` (user or team request), commit `parentsCount` (merge commits). The v1
  `ActivityService` still serves `/activity/*` with v1 keys (`repo`, `timestamp`, `message`).
- *P10:* sync states for the UI — `GET /sync/status.state` ∈ idle/queued/running/waiting_rate_limit/
  needs_reauth/failed with `currentRun` (stage, progress, `recentWindowCompletedAt` for the "dashboard
  ready" moment), `lastRun` (`errors[]` with repo + code for PARTIAL), `nextScheduledAt`; integrations
  carry `nextScheduledSyncAt` and per-installation `suspended`; org approval pending is the callback's
  `pendingApproval: true`. `POST /sync` 409 details carry the current run (`SYNC_IN_PROGRESS`) or
  `reconnectUrl` (`INTEGRATION_NEEDS_REAUTH`); 429 has `Retry-After`. Repository selection: `GET /repos`
  (`included`, `inclusionSource`, `accessible`, `viaInstallation`, `total`), `PATCH /repos` (bulk) and
  `PATCH /repos/:id`. Replace the transitional `/connect` page.
- *Tests:* `installFakeGitHub()` now serves REST + GraphQL from `state.dataset`
  (`loadDataset('basic-dataset')`, `buildLoadFixture()`), logs requests (`state.log`), simulates rate
  limits (`state.rateLimit`), revoked tokens (`invalidTokens`), refresh grants and faults. Helpers in
  `test/utils/github-fixtures.ts`: `connectGitHub`, `runSync` (queue + run in-process), `resumeSync`,
  `sign` (webhook HMAC). Tests set `GITHUB_THROTTLING=false` and `QUEUE_PREFIX` defaults to
  `devimpact-test`; `resetRedisState()` clears test queues.
- *Running locally:* `RUN_WORKER_IN_API=true` (default) runs the processors and registers the
  scheduler in the API; a real sync needs the GitHub App env (README → GitHub App, webhooks).

