# DevImpact AI — Shared Context for Every V2 Session

Read this file in full at the start of **every** phase session. It is the single source of
background truth. The phase file you are executing tells you what to do; this file tells you
where things stand and why.

---

## 1. What the product is

**DevImpact AI** is a Developer KPI Measurement Tool / "Engineering Career Operating System".
It connects to developer tools (GitHub first; GitLab, Jira, Linear later), ingests engineering
activity (commits, pull requests, code reviews, issues), computes KPIs, and uses Claude to turn
that evidence into career artifacts: resume bullets, appraisal reports, promotion packets,
career timelines and an impact score.

- **Primary user:** an individual engineer who wants to measure and communicate their impact.
- **Secondary user (V2 stretch):** an engineering manager who wants a fair, evidence-based view
  of a team (TEAM / ENTERPRISE plans).
- **V2 goal:** a polished, reliable, production-ready tool with much better UI/UX.

The original brief is in [`ORIGINAL_SPEC.md`](./ORIGINAL_SPEC.md).

## 2. Repository and baseline

- Repo: `dhairyapatel02/ai_` (npm-workspaces monorepo).
- **Baseline commit for V2: `ed6ed4f`** ("Merge pull request #3 …"). It is the head of the
  default branch `devin/1780303918-devimpact-ai-scaffold` and contains all work from the
  previous agent (PRs #2 and #3 merged into it).
- PR #1 (`devin/1780303918-devimpact-ai-scaffold` → `init-branch`) is still **open**.
  `init-branch` holds only the initial empty commit.
- Other branches (`devin/update-skills-*`) are already merged into the baseline. Ignore them.
- Branching protocol for V2 is defined in [`README.md`](./README.md#branching-protocol).

## 3. Current stack (v0.1.0 as found)

| Layer | As built | Notes |
|---|---|---|
| Web | Next.js **14.2.3** App Router, React 18, Tailwind 3, hand-copied shadcn/ui (5 components), Recharts, lucide | All pages are client components |
| API | NestJS 10, Express | Global prefix `/api`, port 4000 |
| DB | PostgreSQL 15 + Prisma 5 | `prisma db push`; migrations folder is **git-ignored** |
| Queue | Redis 7 + BullMQ (`github-sync` queue) | Processor runs **inside the API process** |
| AI | `@anthropic-ai/sdk` ^0.24, model hard-coded `claude-sonnet-4-20250514` | Non-streaming, regex JSON extraction |
| Auth | NextAuth v4 route exists but is **unused** | API trusts an `x-user-id` header |
| Shared | `packages/shared` (enums, Zod schemas, types) | **Not imported by either app** |
| Infra | docker-compose: postgres, redis, api, worker, web | Node 18 images (EOL) |
| Tests / CI | **None** | No ESLint config, no Prettier, no CI |

### File map (≈4.5k lines of source)
```
apps/api/prisma/schema.prisma        # 8 models: User, Integration, Commit, PullRequest, Issue, CodeReview, GeneratedDocument, ImpactScore
apps/api/src/main.ts                 # bootstrap, CORS, ValidationPipe, /api prefix
apps/api/src/app.module.ts           # module wiring, BullModule (REDIS_HOST/PORT)
apps/api/src/auth/*                  # dev-login, /auth/me, stub github/google callbacks
apps/api/src/integrations/*          # GitHub OAuth URL + code exchange, list, disconnect
apps/api/src/sync/*                  # trigger/status, BullMQ processor (commits → PRs → reviews)
apps/api/src/github/github.service.ts# Octokit REST fetchers
apps/api/src/activity/*              # commits/prs paginated lists, summary, data for AI
apps/api/src/generate/*              # resume/appraisal/promotion/impact-score orchestration
apps/api/src/ai/ai.service.ts        # Claude calls + retry; prompts in src/prompts/*.ts
apps/api/src/documents/*             # list/get/delete generated docs
apps/web/src/lib/auth-context.tsx    # auto dev-login, userId in localStorage, apiFetch()
apps/web/src/app/<page>/page.tsx     # dashboard, connect(+callback), resume, appraisal, promotion, career, kpis, settings
apps/web/src/components/*            # impact-score-card, activity-heatmap (unused), document-preview, generate-button, resume-bullet-card, sidebar, sync-status-badge, ui/*
.agents/skills/testing-frontend/SKILL.md # previous agent's notes on running the stack locally
```

## 4. Verified state (Phase 01 audit, 2026-11-09)

Run on a clean container (Node 22.23, npm 10.9, Docker 29, Postgres 15 + Redis 7 via compose).
Full evidence: [`audit/AUDIT_REPORT.md`](./audit/AUDIT_REPORT.md) and
[`audit/ARCHITECTURE_CURRENT.md §9`](./audit/ARCHITECTURE_CURRENT.md#9-build-tooling--dependencies).

| Check | Result |
|---|---|
| `npm ci` | ✅ (47 vulnerabilities reported; prod-only audit: 22 pkgs — 3 critical, 11 high) |
| `npm run typecheck` | ✅ api, web, shared |
| `npm run build` | ❌ api ✅, **web ❌** (`useSearchParams()` needs Suspense on `/connect/callback`) |
| `npm run lint` | ❌ api: no ESLint config; web: interactive `next lint` prompt |
| `npm test` | ❌ no tests, no script |
| `npm run dev:api` | ❌ after any build (stale committed `tsconfig.tsbuildinfo` → empty `dist/`); ✅ once it is deleted |
| README quick start | ❌ root `.env` not loaded by Prisma CLI or Nest (cwd `apps/api`) unless exported |
| `docker compose up --build` | ❌ api/web/worker images fail (no `tsconfig.base.json` copied, bad `.prisma` path, missing `public/`); API crashes on Node 18 (`ERR_REQUIRE_ESM`, octokit v4); `dist/worker` missing |
| Runtime (dev servers) | ✅ all 20 endpoints and 10 pages load; behaviour defects listed in `audit/ISSUES.md` |
| Tooling in the cloud container | `docker` (start `dockerd` manually), `psql`, `redis-server`, Chromium + Playwright |

## 5. Known issues (verified)

The authoritative, prioritised backlog is [`audit/ISSUES.md`](./audit/ISSUES.md) — **106 issues:
🔴 10 · 🟠 34 · 🟡 50 · ⚪ 12**, stable IDs (`SEC-`, `BUG-`, `DATA-`, `AI-`, `API-`, `UX-`, `GAP-`,
`DEBT-`, `OPS-`, `PERF-`) with target phases. All 42 planning-time findings were verified (9
amended, 0 refuted). Critical items:

- **SEC-01/02/03** — no authentication (`x-user-id` header), public `dev-login` account takeover
  with every visitor sharing one account, plaintext GitHub tokens.
- **DATA-01** — reviewed-only PRs stored as the user's own PRs (61 % of a seeded user's "PRs";
  71 % in a 30-repo simulation).
- **BUG-01** — `next build` fails. **BUG-14** — resume page renders an empty card even on success.
- **OPS-01/02/03** — Docker images don't build; API crashes on Node 18; worker entry missing.
- **UX-01** — no navigation below 1024 px.

Other themes: LLM-invented impact score (AI-01), silent sync data loss and 8.7k GitHub calls per
sync (DATA-04, PERF-01), errors returned as 200/201 and no validation (API-01/02), dead buttons and
raw-JSON documents (UX-03/04), no tests/lint/CI (DEBT-02/03).

## 6. Non-negotiable V2 principles

1. **Evidence over vibes.** Every number is computed deterministically from stored data and is
   explainable ("how is this calculated?"). The LLM writes narratives and suggestions; it does
   not invent scores. Every AI claim should link to the PRs/commits that support it.
2. **Secure by default.** Real auth, encrypted tokens, least-privilege scopes, validated input,
   rate-limited AI, no secrets in code or logs.
3. **Reliable data.** Idempotent, incremental, observable sync with visible progress and history.
4. **Delightful, fast UX.** Clear onboarding, real empty/loading/error states, mobile-friendly,
   accessible (WCAG 2.2 AA), dark mode.
5. **Tested.** Every phase leaves the repo with lint, typecheck, unit tests and build green.
6. **Fairness.** KPIs measure work patterns, not worth. Avoid metrics that reward volume
   (raw LOC). Communicate limitations in the UI.

## 7. State changes by phase

### After Phase 02 (2026-11-09)
- Green from the root: `npm run lint`, `format:check`, `typecheck`, `test`, `build` (`npm run check`),
  plus `npm run test:int` (Postgres + Redis) and `npm run test:e2e` (Playwright). CI runs all of
  them plus a Docker Compose job.
- Stack versions: Node 22, NestJS 11, Prisma 6.19 (committed migrations), Next 14.2.35, zod 4,
  TypeScript 5.9 strict everywhere (D-015).
- `apps/api/src/worker.ts` exists; `docker compose up --build` starts postgres, redis, api
  (migrates on start), worker and web, all with healthchecks. `GET /api/health` checks DB + Redis.
- Root `.env` is read by everything; env validated with Zod at startup (fail fast).
- `npm run db:seed` creates `demo@devimpact.dev` (deterministic, ~9 months of data); setting
  `NEXT_PUBLIC_DEV_LOGIN_EMAIL=demo@devimpact.dev` makes the web dev-login open it.
- Fixed BUG-01/02/14. Auth, sync, metrics and AI behaviour are otherwise unchanged (verified by
  re-running the P01 API probes: 83/87 identical, 4 explained differences).

### After Phase 03 (2026-11-09)
- The v2 blueprint is in [`blueprint/`](./blueprint/) and binding:
  PRD, KPI methodology (`metrics@2.0.0`, `impact@2.0.0`), architecture, data model + migration plan,
  API contract, traceability, 14 ADRs. Owner decisions: Better Auth; GitHub App data source;
  deterministic impact score (overall + 4 dimensions); individual-only scope without billing;
  GitLab/Jira/Linear and Phase 13 moved to v2.1; hosting decided in P15; brand "calm, professional,
  Linear-like". See [`DECISIONS.md`](./DECISIONS.md) → Confirmed decisions.

### After Phase 04 (2026-11-16)
- The v2 UX is designed and **approved** (D-020): [`design/`](./design/) — IA (routes, navigation,
  period-in-URL, ⌘K), flows, design system + `tokens.css` (light/dark, WCAG AA verified), per-screen
  specs with all states, and a clickable prototype (Artifact link in PROGRESS.md).
- Routes in `design/IA.md` are binding (TRACEABILITY updated). API_CONTRACT_V2 §22 adds A-1…A-5
  (metrics trends/evidence, document evidence + flags, `recentWindowCompletedAt`).

### After Phase 05 (2026-11-16)
- **Real auth:** Better Auth 1.7.25 in `apps/web` (GitHub OAuth App + Google, Prisma adapter, sessions in
  Postgres, JWT plugin). The browser gets a 15-minute EdDSA JWT from `/api/auth/token`; the API verifies
  it via `${WEB_URL}/api/auth/jwks` in a global `AuthGuard`. `x-user-id`, the API dev-login and NextAuth
  are gone. Dev login = web `POST /api/dev-login` (development only, seeded users only).
- **Schema:** migrations P05-1..3 applied (sessions/accounts/verifications/jwks, `user_settings`,
  integration security columns + `github_installations`). No plaintext provider tokens remain; v0.1
  integrations are `NEEDS_REAUTH`. GitHub App connect (signed single-use state, PKCE, encrypted tokens,
  revoke on disconnect) works; syncing with App tokens is P06.
- **API conventions live:** D-006 envelope + error codes, Zod pipe with shared schemas, cursor
  pagination, 256 KB body limit, helmet, strict CORS (no credentials), Redis rate-limit classes,
  pino logs with request ids and redaction, `/api/health/live`, OpenAPI at `/api/docs` (non-prod).
- **New env:** `BETTER_AUTH_SECRET`, `ENABLE_DEV_LOGIN`, `GITHUB_SIGNIN_*`, `GOOGLE_*`, `AUTH_JWT_*`,
  `AUTH_JWKS_URL`, `GITHUB_APP_*`, `GITHUB_WEB_URL`/`GITHUB_API_URL`, `TOKEN_ENCRYPTION_KEYS`,
  `TOKEN_ENCRYPTION_ACTIVE_KEY`, `OAUTH_STATE_SECRET`, `LOG_LEVEL` (see `.env.example`).

### After Phase 06 (2026-11-16)
- **Sync engine v2:** GitHub App user-token sync via `ActivityProvider`/`GitHubProvider` (GraphQL search
  for authored vs reviewed PRs, contributions + batched default-branch history), `SyncRun` persistence
  (status/progress/history from Postgres), newest-30-days-first backfill then monthly slices,
  incremental cursors, rate-limit pause/resume, token refresh + `NEEDS_REAUTH`, hourly fan-out (each
  active integration once per 24 h), GitHub App webhooks (`POST /api/webhooks/github`, HMAC, idempotent).
  Reference fixture: 119 requests (v0.1: 8,732 for a smaller fixture).
- **Schema:** migrations P06-1/P06-2 applied (`repositories`, PR/commit v2 columns,
  `pull_request_reviews`, `sync_runs`, `webhook_deliveries`; `code_reviews` dropped). Reviewed PRs are
  `PullRequest.isAuthoredByUser = false`; v0.1 stubs are `legacy_stub` until the first v2 backfill
  purges them (DATA-01 fixed). **Prisma 7.10.1** with the `pg` driver adapter (D-022).
- **API:** `POST /sync` (replaces `/sync/trigger`), `GET /sync/status|runs|runs/:id`, `GET/PATCH /repos`,
  `POST /repos/:id/purge`, `/activity/prs?role=`; callback returns `syncRun`. Queues `sync` + `metrics`
  under `QUEUE_PREFIX` (tests: `devimpact-test`, OPS-17); `metrics.recompute` is queued but consumed as
  a no-op until P07.
- **New env:** `GITHUB_APP_PRIVATE_KEY_FILE`, `GITHUB_WEBHOOK_SECRET` (now used), `GITHUB_REQUEST_RETRIES`,
  `GITHUB_THROTTLING`, `SYNC_RATE_LIMIT_MIN_REMAINING`, `QUEUE_PREFIX` (see `.env.example`).


### After Phase 07 (2026-11-17)
- **Deterministic metrics engine:** `metrics@2.0.0` (21 metrics, KPI_METHODOLOGY §3) and
  `impact@2.0.0` (overall + Delivery/Quality/Collaboration/Ownership) in `apps/api/src/metrics/`
  as pure functions; the LLM never produces a number. Period grammar, business hours and the
  metric catalogue live in `packages/shared` (`periods/`, `metrics/catalogue.ts`) for API and web.
- **Schema:** migration P07-1 — `metric_snapshots` (daily additive counters), `impact_scores` v2
  (lazy cache with stored inputs + explanation); v0.1 LLM scores kept only in
  `impact_scores_legacy` (never shown, dropped in P15).
- **Jobs:** `metrics.recompute` (debounced per user, merged ranges, rewrites snapshot days and
  invalidates overlapping scores) and the `metrics-nightly` job scheduler (02:30 UTC). Time-zone
  changes queue a full recompute. `npm run metrics:recompute` rebuilds manually.
- **API:** `/metrics/{definitions,overview,kpis,timeseries,heatmap,repos,trends,evidence}`,
  `/impact`, `/impact/history`, `/career/timeline`, `/activity/{feed,prs,prs/:id,reviews,commits,
  commits/:id}` (v2 shapes, `role` required on `/activity/prs`). `GET /generate/impact-score` is
  gone; `/activity/summary` is deprecated (removed in P10). p95 ≤ 100 ms on a heavy user
  (`blueprint/PERF_NOTES.md`).
- **Web (interim):** dashboard, KPIs and career pages read the new endpoints with correct labels;
  no AI call on page load. The designed pages are P10.
- **No env changes.** Seed: demo user now in Europe/London with KPI edge cases and snapshots;
  `npm run db:seed:heavy` adds a perf fixture.

### After Phase 08 (2026-11-17)
- **AI layer v2 (ADR-0009, D-024):** `@anthropic-ai/sdk` 1.9.0 behind `AiClient`; models only from
  config (`ANTHROPIC_MODEL_DEFAULT=claude-opus-5-5` documents, `ANTHROPIC_MODEL_FAST=claude-haiku-5-5`
  quick actions + repair); structured output from Zod with one repair; versioned prompts in
  `apps/api/src/prompts/`; deterministic `EvidenceBuilder` + citation verification (uncited /
  invalid flags, coverage); untrusted text delimited and escaped; private repos redacted on request.
- **Execution:** generation runs in the worker (`ai` queue: `ai.generate`, `ai.quick`); events go to
  Redis Streams and `GET /documents/:id/stream` relays SSE with `Last-Event-ID`; `inputHash` cache;
  cancel; versions + user edits + restore + regenerate (whole or one section).
- **Schema:** migration P08-1 — documents v2, `document_versions`, `ai_usage`; v0.1 documents are
  read-only imported versions.
- **API:** `/documents` (+ preview-evidence, stream, cancel, versions, restore, regenerate),
  `POST /impact/highlights` (and `GET /impact.highlights`), `POST /ai/achievement-statement`,
  `GET /me/usage`; `/generate/*` and the v1 `AIService` are gone. Monthly AI quotas (FREE 15 + 100,
  PRO 150 + 1,000; `402 QUOTA_EXCEEDED`).
- **Evals:** 7 personas × 6 generators in `npm test` (recorded, synthetic until a live run);
  `npm run eval:live` with a key (not run yet, AI-10).
- **New env (all optional):** `ANTHROPIC_MODEL_DEFAULT/FAST`, `AI_FALLBACKS_ENABLED`,
  `AI_EFFORT_DEFAULT/FAST`, `AI_TIMEOUT_MS`, `AI_QUICK_TIMEOUT_MS`, `AI_MAX_RETRIES`,
  `AI_RETRY_BASE_MS`, `AI_WORKER_CONCURRENCY`, `AI_STREAM_TTL_SECONDS`, `ENTITLEMENTS_JSON`,
  `AI_PRICES_JSON`. Local mock: `npm run ai:mock --workspace=apps/api`.
- **Web (interim):** studio pages call `POST /documents` and poll; P11 builds the studio + SSE.

### After Phase 09 (2026-11-18)
- **Web stack (D-025):** Next.js **16.4.6** (Turbopack, `src/proxy.ts` replaces middleware), React
  **19.3.1**, Tailwind CSS **4.3.5** (CSS-first; `src/styles/tokens.css` = `design/tokens.css`,
  checked in CI by `npm run check:tokens`), shadcn/ui new-york-v4 sources adapted to the tokens,
  TanStack Query 5, next-themes (light/dark/system, no flash), Instrument Sans + JetBrains Mono,
  Vitest 5. Better Auth stays 1.7.25.
- **Data layer (ADR-0010):** typed `apiClient` (`src/lib/api/`) on the shared Zod schemas with
  `ApiError` (`code`, `status`, `details`, `requestId`, `retryAfterSeconds`), one token refresh on 401
  then `/sign-in?reason=session_expired`, query-key factory `qk`, query defaults (retry ≤ 2 on
  network/5xx only), `useSyncStatus` polling (2 s / 30 s / off), fetch-based `useEventStream`
  (`Last-Event-ID`, heartbeats ignored, terminal `done`/`error`/`cancelled`), server client for RSC
  (`/me` prefetched in the `(app)` layout). `auth-context.tsx`, the old `Sidebar` and the API's
  `GET /auth/me` alias are gone. Components cannot call `fetch` or `alert` (lint).
- **Shell + states:** route groups `(auth)`, `(onboarding)`, `(system)`, `(app)`, each with
  `loading`/`error` (+ `not-found`), a global 404 (inside the shell when signed in) and
  `global-error`. AppShell per IA §3 (sidebar ≥ 1024 px with a collapsible rail, drawer 768–1023 px,
  bottom bar < 768 px), top bar with the global period picker (`?period=`, IA §4), sync status,
  theme toggle, New menu, ⌘K palette, `G`-key shortcuts and a skip link. State catalogue in
  `src/components/states/`.
- **Auth + onboarding:** designed sign-in (S1) incl. `account_not_linked` (SEC-16 UI) and the
  session-ended notice; onboarding S2–S5 against the real API (connect → org approval pending →
  repositories → first sync with polling and the `recentWindowCompletedAt` "dashboard ready"
  moment), resumable via `onboardingStep`. `/` redirects to `/onboarding` until onboarding is
  completed. `ConnectReturnTo` = `/onboarding` | `/settings/integrations`.
- **Routes:** interim pages now live at their IA routes (`/settings/integrations`,
  `/settings/profile`, `/documents/new/{resume,appraisal,promotion}`); old paths redirect.
  Activity, Impact detail, Documents library, Achievements, Goals, Notifications, Privacy and Plan
  are placeholders until P10–P12.
- **Tests:** web Vitest 108; Playwright 21 (+3 opt-in screenshot tests) incl. axe-core (0
  serious/critical) on the shell, sign-in and onboarding, 1440/768/390 px navigation, theme
  persistence, ⌘K, the period picker, and onboarding end-to-end. The GitHub App round trip is
  intercepted in the browser. CI also audits web production dependencies.
- **New env:** `API_INTERNAL_URL` (optional, server-side API base; Compose sets `http://api:4000/api`).

### After Phase 10 (2026-11-18)
- **Designed insight pages (D-026)** replace the interim views and placeholders: Dashboard (S6:
  stat cards, activity chart, impact card, heatmap, recent activity, Next step, Create), Activity
  (S7: URL-synced filters, `?metric=` evidence, item drawer on `?item=` with "Turn into achievement"
  that drafts and copies a statement until P12), KPIs (S8: five sections, sparklines from
  `/metrics/trends`, explain drawer on `?metric=`), Impact (S9: explanation, highlights, history,
  components), Career (S10: `?year=`, milestones, `/career/print`), Settings → Integrations (S19:
  every connection state, repository manager, sync history, keep/delete disconnect, planned
  providers). All five states per screen, light/dark, 390 px; axe 0 serious/critical in E2E.
- **Charts:** Recharts 3.11 via the shadcn `chart` container on the chart tokens (fixed series
  colours, table toggle, `aria-label` summaries), loaded per route with `next/dynamic`;
  sparklines are plain SVG. Helpers in `apps/web/src/lib/charts.ts`.
- **Performance:** the dashboard prefetches its first-paint queries on the server; Turbopack bundles
  `@devimpact/shared` from its ESM source (`sideEffects: false`), the API still uses `dist/`.
  Lighthouse on the production dashboard: mobile median 96, desktop 100, accessibility 100, CLS 0.
- **API:** `GET /activity/summary` is gone (404). No new endpoints. New optional env
  `RATE_LIMIT_DEFAULT_PER_MINUTE` (default 300; the E2E API server sets 3000). Sync progress is still
  polling (GAP-11 → P14).
- **Seed:** repositories carry `lastActivityAt`; the demo integration has two installations and a
  three-run sync history (one partial with a per-repository error).
- **Tests:** web Vitest 166 (page views run against `test/api-mock.tsx` + captured API fixtures),
  API integration 157, Playwright 26 (+ opt-in screenshots for P09 and P10).

### After Phase 11 (2026-11-21)
- **Designed document studio (D-027)** replaces the interim studios and placeholders: Documents
  library (S11: filters/search/sort in the URL, cursor pages, status + "N uncited" badges, usage
  meter, rename / duplicate options / retry / delete with Undo), type picker (S12), Resume /
  Appraisal / Promotion studios (S13–S15: options per API_CONTRACT §13.1, `?period=` pre-fill,
  debounced evidence preview, quota and rate-limit copy) and the viewer/editor `/documents/:id`
  (S16: streaming with "Writing section N of M", Stop, polite announcements, reconnect + polling
  fallback; citations with popovers, flags, engine tables, readable v0.1 imports; structured
  per-claim editor with 900 ms autosave and version conflicts; versions with `?version=` and
  restore; regenerate whole / options / section; resume bullet cards with copy / pin / used /
  reorder; rename; delete). Documents nav spinner + "ready" toast while a generation runs elsewhere.
- **Exports (ADR-0012):** `GET /documents/:id/export?format=md|txt|pdf|docx&version=&citations=`
  from one export-blocks IR in `packages/shared` (also used for client-side copy); PDF via
  `@react-pdf/renderer` 4.9.0 with embedded Instrument Sans / JetBrains Mono (`@fontsource/*`, local
  files), DOCX via `docx` 9.16.0; filenames `<type>-<period>-v<N>.<ext>`; `export` rate class 30/h.
- **API (additive):** `GET /documents?status=` filter; CORS exposes `Content-Disposition`;
  `ResumeContent.bullets[].pinned/used` (API_CONTRACT §22 A-6). **New optional env**
  `RATE_LIMIT_EXPORT_PER_HOUR` (default 30; E2E 1000). The AI mock takes `AI_MOCK_CHUNK` /
  `AI_MOCK_DELAY_MS`.
- **Seed:** three v2 documents (appraisal with three versions and one uncited claim, curated resume,
  promotion packet) next to the three v0.1 imports.
- **Tests:** web Vitest 208, shared 83, API unit 210, API integration 164, Playwright 34 (+ opt-in
  screenshots for P09–P11). Playwright now starts the fake Anthropic API (:4010) for generation.

### After Phase 12 (2026-11-24)
- **Career OS (D-028):** migration P12-1 `career_os` (achievements + evidence with an exactly-one
  CHECK, goals, goal_achievements, digest_deliveries). `/achievements` and `/goals` CRUD (evidence =
  your own PRs / commits / reviews, else 404); achievements appear in the activity feed, PR detail,
  career timeline ("Beyond code", A-7), snapshots and AI evidence packs as `ACH-<id>` refs
  (`RefResolver`, citation popovers); goal progress comes from the metrics engine.
- **Email:** `EmailTransport` (`console` default in dev, `memory` in tests, `smtp` via nodemailer
  10.4.1, `resend`), the worker consumes the `email` queue: hourly `email-digest-fanout` → idempotent
  weekly `email.digest` (user's local day/hour, last complete ISO week, engine numbers, optional AI
  summary), `email.send` for "Sync problems" / "Document ready"; HMAC unsubscribe links + public
  `POST /notifications/unsubscribe` and the public `/unsubscribe` page; `POST
  /notifications/digest/preview`.
- **Settings complete:** Profile (roles, sessions, sign-in methods), Notifications, Privacy & data
  (redaction, `GET /me/export` streamed JSON 3/day, `DELETE /me` with typed confirmation + Redis
  cleanup), Plan & usage. Entitlements add `weeklyDigest` and enforce the history window
  (`403 ENTITLEMENT_REQUIRED`); PRO via `npm run plan:set --workspace=apps/api -- <email> PRO`.
- **Web:** S17 Achievements, S18 Goals, S20–S24 replace every placeholder (`ComingSoon` removed);
  shell-level "Add achievement" / "Add goal" dialogs (⌘K, `A`, New menu, dashboard, Next step rules 4
  and 6); "Turn into achievement" saves through the pre-filled dialog.
- **New env:** `EMAIL_TRANSPORT`, `EMAIL_FROM`, `SMTP_URL`, `RESEND_API_KEY`, `RESEND_API_URL`,
  `DIGEST_ENABLED`, `UNSUBSCRIBE_TOKEN_SECRET` (required in production), `UNSUBSCRIBE_TOKEN_TTL_DAYS`,
  `RATE_LIMIT_DATA_EXPORT_PER_DAY`.
- **Seed:** achievements, goals (met / not met / tracked by achievements), digest settings + a
  delivered digest, and the disposable `delete-me@devimpact.dev` user.
- **Deferred:** monthly digest and in-app notification centre → v2.1; goals in the appraisal prompt
  (GAP-19), email bounce handling (GAP-21), DigestDelivery retention (OPS-18) → P14.

### After Phase 13 (2026-11-25)
- **Scope:** P13 was pulled into v2.0 before P14 (D-029 amends D-018). GitLab (gitlab.com +
  allow-listed self-managed), Jira Cloud and Linear are live sources next to GitHub (D-030).
- **Provider abstraction:** `ProviderRegistry` + two categories — code hosts (`ActivityProvider`:
  GitHub, GitLab) and issue trackers (`IssueTrackerProvider`: Jira, Linear). The sync engine runs
  the same lifecycle for both (issue trackers: prepare + `ISSUES` stage). Plain `fetch` clients via
  `ProviderHttp` (no new SDKs). OAuth per provider (PKCE for GitLab/Linear, signed state bound to
  user + provider), encrypted tokens, refresh → `NEEDS_REAUTH`, revoke on disconnect (not Jira),
  webhooks `/api/webhooks/{gitlab,jira,linear}` (token / HMAC / HMAC + timestamp, idempotent).
- **Schema:** migration P13-1 `additional_integrations` — Issue v2 columns, `provider_identities`,
  `integrations.base_url/config`, `SyncStage.ISSUES`, `IntegrationMechanism.OAUTH2`,
  `metric_snapshots.issues_completed/story_points/by_provider`.
- **Metrics / AI:** `metrics@2.1.0` adds the §3.6 issue metrics (never scored; `impact@2.0.0`
  unchanged), provider rollup dimension (`GET /metrics/providers`), KPIs `issues` section.
  Evidence refs `MR-…!n`, `REV-…!n`, `JIRA-…`, `LIN-…`; packs include completed issues; prompts v2
  for resume/appraisal/promotion/impact narrative; evals 8 personas × 6 (re-recorded).
- **Entitlements:** FREE 2 connected sources / PRO 4, one account per provider
  (`integrationsPerProvider`).
- **Web:** S19 live cards per provider (status, Sync now / Reconnect, Manage, Disconnect keep/purge,
  history, Jira sites + story points field, GitLab commit emails, connect tiles with plan/config
  reasons), `/integrations/:provider/callback`, Activity Issues chip + Source filter + issue drawer,
  KPIs Issues section + "By source", career "Issues completed", MR/JIRA/LIN evidence chips.
- **New env:** `GITLAB_URL`, `GITLAB_CLIENT_ID/SECRET`, `GITLAB_INSTANCES_JSON`,
  `GITLAB_WEBHOOK_SECRET`, `JIRA_CLIENT_ID/SECRET`, `JIRA_AUTH_URL`, `JIRA_API_URL`,
  `JIRA_WEBHOOK_SECRET`, `LINEAR_CLIENT_ID/SECRET`, `LINEAR_WEB_URL`, `LINEAR_API_URL`,
  `LINEAR_WEBHOOK_SECRET`, `PROVIDER_REQUEST_TIMEOUT_MS`, `PROVIDER_REQUEST_RETRIES` (all optional).
- **Seed:** demo user also has GitLab (two projects, MRs, a manual commit email), Jira (issues,
  detected story points field) and Linear (needs reconnection) — display-only, no tokens.
- **Tests:** fake GitLab/Atlassian/Linear (`test/utils/fake-providers.ts`, HTTP server
  `npm run providers:mock --workspace=apps/api`), per-provider integration tests, E2E with
  intercepted OAuth.
