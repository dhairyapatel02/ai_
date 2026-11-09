# V2 Progress Tracker

Every phase session updates this file before opening its PR.

## Status

| # | Phase | Status | PR | Completed | Notes |
|---|---|---|---|---|---|
| 00 | Planning (this folder) | ✅ Done | — | 2026-11-09 | Baseline `ed6ed4f` confirmed; plan written |
| 01 | Audit & Discovery | ✅ Done | (this PR) | 2026-11-09 | 106 issues (🔴10 🟠34 🟡50 ⚪12); see `audit/` |
| 02 | Engineering Foundation & Stabilization | ⏳ Not started | | | |
| 03 | V2 Blueprint | ✅ Done | (this PR) | 2026-11-09 | All 7 user decisions answered; 14 ADRs; `blueprint/` |
| 04 | UX/UI Design System & Prototype | ⏳ Not started | | | |
| 05 | Backend Platform | ⏳ Not started | | | |
| 06 | Sync Engine v2 | ⏳ Not started | | | |
| 07 | Metrics Engine & Impact Score v2 | ⏳ Not started | | | |
| 08 | AI Layer v2 | ⏳ Not started | | | |
| 09 | Frontend Foundation & App Shell | ⏳ Not started | | | |
| 10 | Frontend: Insights Pages | ⏳ Not started | | | |
| 11 | Frontend: AI Document Studio | ⏳ Not started | | | |
| 12 | Product Extensions | ⏳ Not started | | | |
| 13 | Additional Integrations (optional) | ⏸ Deferred | | | Skipped for v2.0 → v2.1 (D-016) |
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

### Phase 03 — V2 Blueprint: Product, KPIs & Architecture (2026-11-09)
**Branch / PR:** `claude/eager-volta-lqrxeb` → `main` / PR "Phase 03: V2 Blueprint"
(branched from `main@91a6c78` = Phase 01 merged; P02 not yet merged — P03 ran in parallel as planned).

**Summary:**
- Asked the owner the 7 USER DECISIONS (two AskUserQuestion rounds); all answers recorded as
  CONFIRMED entries in `DECISIONS.md` (D-003, D-004, D-007, D-013, D-014, D-015, D-016).
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
  (feature → ADR → model → endpoint → page → phase; all 81 open issues targeting ≥ P05 mapped,
  GAP-10 won't-fix for v2.0 — verified by script).
- 14 ADRs in `blueprint/adr/` (+ index); every PROPOSED decision D-001…D-014 marked
  CONFIRMED / AMENDED / DEFERRED with ADR links; new D-015 (brand), D-016 (P13 out), D-017 (time zones).
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
- D-015 Brand **calm, professional, Linear-like**. *(user)*
- D-016 GitLab/Jira/Linear **out of v2.0**; P13 skipped. *(user)*
- D-017 IANA timezone per user; inclusive local periods; ISO weeks; business hours exclude weekends.

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

**Handoff notes for next phases:**
- *P02 (if still open):* targets from ADR-0002 — Zod **4**, latest Prisma major, Nest 11, Node 22;
  env uses `REDIS_URL` (not host/port) and `API_PORT`/`WEB_PORT`; create the **baseline migration**
  exactly as DATA_MODEL_V2 §5 describes; seed should include a heavy persona (12 months, ~3k
  PRs/reviews) for P07/P10/P14 perf work; record the Jest-vs-Vitest choice for the API (ADR-0011
  allows either). If P02 merged with different choices, the next phase records the reconciliation.
- *P04:* read PRD §4–§5, KPI_METHODOLOGY §3/§6.7 (copy), API_CONTRACT_V2, and the P04 amendments.
  Routes in TRACEABILITY §1 are provisional — update that file if IA.md changes them.
- *P05:* the Better Auth Prisma models must be reconciled with `npx @better-auth/cli generate`
  for the pinned version (DATA_MODEL_V2 §3 note). The connect flow needs a GitHub App registered
  for local testing; dummy values suffice for unit/integration tests.
- *P08:* re-check model IDs and SDK details with the `claude-api` skill before coding; defaults are
  env-only so changing them later is configuration.
- Mermaid validation helper used here: mermaid 11 + jsdom, `mermaid.parse()` per block (semicolons
  inside sequence-diagram messages break parsing).
