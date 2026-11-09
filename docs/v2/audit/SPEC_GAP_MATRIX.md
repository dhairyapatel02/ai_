# Spec Gap Matrix — ORIGINAL_SPEC.md vs v0.1.0

One row per item in [`../ORIGINAL_SPEC.md`](../ORIGINAL_SPEC.md), in spec order.
Status: ✅ implemented as specified · 🟡 partial · ❌ missing · ⚠️ implemented but wrong/broken.
Evidence links: `file:line`, probe IDs in [`API_TEST_RESULTS.md`](API_TEST_RESULTS.md), screenshots
in [`screenshots/`](screenshots/), issue IDs in [`ISSUES.md`](ISSUES.md).

> V2 decisions ([`../DECISIONS.md`](../DECISIONS.md)) intentionally supersede some spec items
> (model ID, Next 14, LLM-generated impact score). Those are still scored against the spec here and
> flagged "superseded" in the notes.

## Summary

| Section | Items | ✅ | 🟡 | ❌ | ⚠️ |
|---|---|---|---|---|---|
| Overview outputs | 6 | 0 | 3 | 0 | 3 |
| Tech stack | 7 | 3 | 2 | 0 | 2 |
| Phase 1 — Scaffold | 5 | 3 | 1 | 0 | 1 |
| Phase 2 — Schema | 8 | 5 | 2 | 0 | 1 |
| Phase 3 — GitHub integration | 9 | 2 | 3 | 2 | 2 |
| Phase 4 — AI layer | 8 | 0 | 4 | 1 | 3 |
| Phase 5 — API routes | 18 | 10 | 2 | 0 | 6 |
| Phase 6 — Frontend pages | 34 | 9 | 9 | 12 | 4 |
| Phase 7 — UI components | 7 | 2 | 3 | 1 | 1 |
| Phase 8 — Docker & env | 15 | 6 | 3 | 2 | 4 |
| Coding standards | 8 | 2 | 2 | 3 | 1 |
| **Total** | **125** | **42** | **34** | **21** | **28** |

Roughly a third of the spec works as specified; most of the rest exists in a partial or broken
form. The biggest absences are: real auth, scheduled/webhook sync, exports, the documents library,
charts, error/loading states, tests and a working Docker setup.

## Overview — outputs

| # | Spec item | Status | Evidence / notes |
|---|---|---|---|
| O1 | Resume bullet points | ⚠️ | API works (GEN-R1) but the page renders an empty card (BUG-14) |
| O2 | Appraisal reports (monthly/quarterly/yearly) | 🟡 | Generated (GEN-R2), shown as raw JSON (UX-04), no export |
| O3 | KPI dashboards | 🟡 | `/kpis` has 4 mislabeled count cards + LLM score; no trends (UX-06, GAP-03) |
| O4 | Promotion packets | 🟡 | Generated (GEN-R3), raw JSON, stub PRs as evidence (AI-07) |
| O5 | Career timelines | ⚠️ | `/career` exists but is dominated by reviewed-PR stubs (DATA-01, UX-10) |
| O6 | Impact scores | ⚠️ | LLM-invented, even for empty months (AI-01). *Superseded by D-007* |

## Tech stack

| # | Spec item | Status | Evidence / notes |
|---|---|---|---|
| T1 | Next.js 14 App Router, TailwindCSS, shadcn/ui | ⚠️ | 14.2.3 with critical advisories (SEC-09); `next build` fails (BUG-01); 5 hand-copied shadcn components |
| T2 | Node.js + NestJS REST API | ✅ | NestJS 10, 20 routes |
| T3 | PostgreSQL + Prisma | 🟡 | Works with `db push`; no migrations (DEBT-05) |
| T4 | Redis + BullMQ for async sync | 🟡 | Queue works; processor runs in the API process, no worker entry (OPS-03) |
| T5 | Claude `claude-sonnet-4-20250514` | ✅ | Hard-coded `ai.service.ts:27` (AI-02). *Superseded by D-009* |
| T6 | NextAuth.js with GitHub + Google OAuth | ⚠️ | Route exists, never used; app uses public dev-login (SEC-02, GAP-06) |
| T7 | Docker Compose setup | ✅ | File present — but see Phase 8: images don't build/run |

## Phase 1 — Scaffold

| # | Spec item | Status | Evidence / notes |
|---|---|---|---|
| S1 | `apps/web` Next.js frontend | ✅ | |
| S2 | `apps/api` NestJS backend | ✅ | |
| S3 | `packages/shared` shared types | ⚠️ | Exists but imported by neither app (DEBT-01) |
| S4 | `docker-compose.yml` | ✅ | |
| S5 | `README.md` | 🟡 | Present; quick start fails as written (OPS-07), callback route undocumented |

## Phase 2 — Database schema

| # | Spec item | Status | Evidence / notes |
|---|---|---|---|
| D1 | User (id, email, name, avatar, plan, createdAt) | ✅ | `schema.prisma:52-69` |
| D2 | Integration (…, accessToken, refreshToken, metadata) | ⚠️ | Token plaintext (SEC-03); `refreshToken` never used (DATA-10) |
| D3 | Commit (sha, message, repo, branch, additions, deletions, timestamp) | 🟡 | `branch` always `main`, message truncated (DATA-05) |
| D4 | PullRequest (title, body, state, repo, mergedAt, reviewCount, timestamp) | 🟡 | `reviewCount` never set; also holds review stubs (DATA-01, DATA-08) |
| D5 | Issue (labels, storyPoints, priority, status, projectName) | ✅ | Model exists; never populated (no Jira/Linear) |
| D6 | CodeReview (prId, comments, approved, timestamp) | ✅ | Fields exist; semantics lossy (DATA-08) |
| D7 | GeneratedDocument (type, content JSON, dateRange, createdAt) | ✅ | |
| D8 | ImpactScore (month, year, overall, 4 dimensions) | ✅ | (+ `highlights`) |

## Phase 3 — GitHub integration

| # | Spec item | Status | Evidence / notes |
|---|---|---|---|
| G1 | OAuth flow: user connects GitHub | 🟡 | Works mechanically; no `state` (SEC-04), `repo` scope (SEC-05), code posted 3× (BUG-02) |
| G2 | On connect, fetch last 6 months of commits (all repos) | ⚠️ | Not automatic on connect (manual Sync); only 30 repos, default branch (DATA-03, DATA-05) |
| G3 | …PRs opened + merged | 🟡 | Authored PRs created in window, 30 repos only |
| G4 | …code reviews (PRs reviewed) | ⚠️ | 15 repos only; reviewed PRs stored as own stub PRs (DATA-01) |
| G5 | Store in DB via BullMQ background job | ✅ | `sync.processor.ts` (in-process) |
| G6 | Webhook support for real-time updates | ❌ | None (GAP-01) |
| G7 | Incremental sync every 24 hours | ❌ | None; always full 6-month rescan (GAP-01) |
| G8 | Uses `GET /user/repos`, `GET /repos/{o}/{r}/commits?author=` | ✅ | `github.service.ts:40,66` (+ N+1 `getCommit`, PERF-01) |
| G9 | Uses `GET /repos/{o}/{r}/pulls?state=all`, `GET /pulls/{n}/reviews` | 🟡 | Used, but paginates every PR ever (PERF-01) |

## Phase 4 — AI layer

| # | Spec item | Status | Evidence / notes |
|---|---|---|---|
| A1 | `enhanceCommitMessage(rawMessage, context)` → `{enhanced, category}` | 🟡 | Implemented, not exposed anywhere (AI-09) |
| A2 | `generateResumeBullets(commits, prs, reviews, dateRange, role)` — 5–8 themed, STAR, quantified, role variants | 🟡 | Prompt matches; sampling 20/15, wrong "merged" metric (AI-06/07); `format` ignored (GAP-08) |
| A3 | `generateAppraisalReport(activityData, period)` — 6 sections | 🟡 | Sections requested; no evidence links; raw JSON UI |
| A4 | `generatePromotionPacket(currentRole, targetRole, activityData)` — 6 sections | 🟡 | Sections requested; stub PRs as evidence |
| A5 | `calculateImpactScore(activityData)` | ⚠️ | LLM-scored; runs for empty months (AI-01). *Superseded by D-007* |
| A6 | Streaming for long documents | ❌ | Non-streaming `messages.create` (AI-03) |
| A7 | Cache results in DB | ⚠️ | Only impact scores are reused; documents regenerate (and are stored again) on every click (AI-03) |
| A8 | Retry with exponential backoff | ⚠️ | Backoff exists (1 s, 2 s) but retries non-retryable errors and parse failures (AI-04) |

## Phase 5 — API routes

| # | Spec item | Status | Evidence / notes |
|---|---|---|---|
| R1 | `POST /auth/github` | ⚠️ | Stub returning success (API-03, AUTH-9) |
| R2 | `POST /auth/google` | ⚠️ | Stub (AUTH-11) |
| R3 | `GET /auth/me` | ⚠️ | Works, but identity = `x-user-id` header (SEC-01, AUTH-8) |
| R4 | `GET /integrations` | ✅ | INT-1 (tokens not exposed) |
| R5 | `POST /integrations/github/connect` | ✅ | INT-4 (+ undocumented `POST /integrations/github/callback`) |
| R6 | `DELETE /integrations/:id` | ⚠️ | Works; cascades all data without warning (DATA-07) |
| R7 | `POST /sync/trigger` | ✅ | SYNC-1 (no dedupe, DATA-06) |
| R8 | `GET /sync/status` | 🟡 | Scans all users' jobs; misreports failures (DATA-06, BUG-08) |
| R9 | `GET /activity/commits?from=&to=` | ✅ | ACT-1 (validation gaps SEC-06, BUG-04/05) |
| R10 | `GET /activity/prs?from=&to=` | ⚠️ | Returns review stubs as PRs (ACT-10, DATA-01) |
| R11 | `GET /activity/summary?from=&to=` | 🟡 | `totalPRs` includes stubs and all states (ACT-14) |
| R12 | `POST /generate/resume {dateRange, role, format}` | ✅ | GEN-R1 (`format` ignored, nested response BUG-14) |
| R13 | `POST /generate/appraisal {period, month, year}` | ✅ | GEN-R2 |
| R14 | `POST /generate/promotion {currentRole, targetRole}` | ✅ | GEN-R3 |
| R15 | `GET /generate/impact-score?month=&year=` | ⚠️ | Side-effecting GET, LLM call for empty months (GEN-R4, API-04) |
| R16 | `GET /documents` | ✅ | DOC-1 (unbounded limit, SEC-06) |
| R17 | `GET /documents/:id` | ✅ | DOC-4/5 (ownership enforced) |
| R18 | `DELETE /documents/:id` | ✅ | DOC-7/DEST-1 |

## Phase 6 — Frontend pages

| # | Spec item | Status | Evidence / notes |
|---|---|---|---|
| F1 | `/dashboard` stat card: commits this month | ✅ | `seeded-1440-dashboard.png` |
| F2 | `/dashboard` stat card: PRs merged | ⚠️ | Shows total PRs (DATA-02) |
| F3 | `/dashboard` stat card: reviews done | ✅ | |
| F4 | `/dashboard` stat card: impact score | ⚠️ | LLM score, shown even with no activity (AI-01, `empty-1440-dashboard.png`) |
| F5 | `/dashboard` 30-day activity bar chart | ❌ | GAP-02 |
| F6 | `/dashboard` recent activity feed | ❌ | GAP-02 |
| F7 | `/dashboard` quick actions | ✅ | Generate Resume / Appraisal links (clipped on mobile, UX-02) |
| F8 | `/connect` integration cards GitHub/GitLab/Jira/Linear | 🟡 | Cards present; 3 are "Coming Soon" (GAP-10) |
| F9 | `/connect` connect/disconnect | 🟡 | Works; no confirm on destructive disconnect (DATA-07) |
| F10 | `/connect` last sync | ⚠️ | Shows failed job time as last sync, green "Synced" (BUG-08) |
| F11 | `/connect` sync now | ✅ | Button triggers job + polling |
| F12 | `/resume` date range picker | 🟡 | Two native date inputs, no `DateRangePicker` |
| F13 | `/resume` role selector | ✅ | 5 roles |
| F14 | `/resume` generate with loading state | 🟡 | Button spinner only, no progress |
| F15 | `/resume` preview | ❌ | Empty card rendered (BUG-14) |
| F16 | `/resume` copy | ❌ | Dead button (UX-03) |
| F17 | `/resume` download PDF | ❌ | Dead button (UX-03, GAP-04) |
| F18 | `/resume` download DOCX | ❌ | Not present (GAP-04) |
| F19 | `/appraisal` period selector | ✅ | |
| F20 | `/appraisal` month/year picker | 🟡 | Month select + free number year input (UX-08) |
| F21 | `/appraisal` generate | ✅ | |
| F22 | `/appraisal` rich preview | ❌ | Raw JSON (UX-04) |
| F23 | `/appraisal` export | ❌ | Dead button (UX-03) |
| F24 | `/promotion` current/target role | ✅ | Free-text inputs |
| F25 | `/promotion` generate | 🟡 | Works; no validation (BUG-07) |
| F26 | `/promotion` structured preview | ❌ | Raw JSON (UX-04) |
| F27 | `/career` visual timeline by year/quarter | 🟡 | Quarters only, max 8 items each |
| F28 | `/career` grouped by repo | 🟡 | Commit counts per repo merged into PR items |
| F29 | `/career` achievement tags | ⚠️ | Tags are PR states / "N commits", not achievements; stub PRs (UX-10) |
| F30 | `/career` filter by year | ❌ | GAP-03 |
| F31 | `/kpis` metric cards — Productivity, Quality, Collaboration, Ownership sections | 🟡 | 4 cards, mislabeled counts (UX-06) |
| F32 | `/kpis` monthly trend charts | ❌ | GAP-03 |
| F33 | `/kpis` impact-score donut | ✅ | `ImpactScoreCard` |
| F34 | `/settings` profile · plan & billing · connected integrations · notification preferences | ❌ | Static mock: profile save, notifications dead; no integrations section; plan not enforced (GAP-07) |

## Phase 7 — Key UI components

| # | Spec item | Status | Evidence / notes |
|---|---|---|---|
| C1 | `<ImpactScoreCard/>` | ✅ | `components/impact-score-card.tsx` |
| C2 | `<ActivityHeatmap/>` | 🟡 | Exists, used nowhere (GAP-02) |
| C3 | `<ResumeBulletCard/>` | ✅ | Hard-coded colours (UX-11) |
| C4 | `<DocumentPreview/>` | ⚠️ | JSON `<pre>` dump (UX-04) |
| C5 | `<SyncStatusBadge/>` | 🟡 | Exists; fed wrong status (BUG-08) |
| C6 | `<DateRangePicker/>` | ❌ | GAP-03 |
| C7 | `<GenerateButton/>` | 🟡 | Spinner only, no streaming/progress |

## Phase 8 — Docker & env

| # | Spec item | Status | Evidence / notes |
|---|---|---|---|
| E1 | compose `postgres:15` | ✅ | Ran healthy |
| E2 | compose `redis:7` | ✅ | Ran healthy |
| E3 | compose `api` | ⚠️ | Image fails to build (OPS-01, OPS-04); once built, crashes on Node 18 (OPS-02); no schema step (OPS-06) |
| E4 | compose `web` | ⚠️ | Image fails (OPS-01, BUG-01, OPS-05) |
| E5 | compose `worker` (BullMQ consumer) | ⚠️ | `node dist/worker` doesn't exist (OPS-03) |
| E6 | `.env.example`: `DATABASE_URL` | ✅ | |
| E7 | `.env.example`: `REDIS_URL` | ⚠️ | Declared but unused; code reads `REDIS_HOST/PORT` (OPS-10) |
| E8 | `.env.example`: `ANTHROPIC_API_KEY` | 🟡 | Declared; not loaded from root `.env` in dev (OPS-07) |
| E9 | `.env.example`: `GITHUB_CLIENT_ID` | ✅ | |
| E10 | `.env.example`: `GITHUB_CLIENT_SECRET` | ✅ | |
| E11 | `.env.example`: `GOOGLE_CLIENT_ID` | 🟡 | Declared; only read by the unused NextAuth route |
| E12 | `.env.example`: `GOOGLE_CLIENT_SECRET` | 🟡 | Same |
| E13 | `.env.example`: `NEXTAUTH_SECRET` | ✅ | Declared (NextAuth unused) |
| E14 | `.env.example`: `NEXTAUTH_URL` | ❌ | Declared, but repurposed as API CORS origin + OAuth redirect base (OPS-10) — not used for NextAuth. Counted ❌ for its specified purpose |
| E15 | Hosting-ready Docker setup | ❌ | `docker compose up --build` cannot produce a running stack (OPS-01..06, OPS-09) |

## Coding standards

| # | Spec item | Status | Evidence / notes |
|---|---|---|---|
| CS1 | TypeScript strict everywhere | 🟡 | web/shared `strict: true`; api only `strictNullChecks` + `noImplicitAny` (DEBT-08) |
| CS2 | Zod for all input validation | ❌ | Zod unused at runtime (API-02) |
| CS3 | Error boundaries on all async components | ❌ | None (UX-07) |
| CS4 | Loading skeletons for all data-fetching components | ❌ | Single spinner (UX-07) |
| CS5 | All AI prompts in `/prompts` as separate `.ts` files | ✅ | `apps/api/src/prompts/*.ts` |
| CS6 | Env vars validated at startup with Zod | ⚠️ | `envSchema` exists in shared but is never called and is wrong (OPS-10) |
| CS7 | API responses `{ success, data?, error? }` | 🟡 | Shape used, but with 200/201 for errors and Nest default shapes for 404/500 (API-01) |
| CS8 | All DB queries through Prisma service | ✅ | No raw SQL in app code (`PrismaService` everywhere) |
