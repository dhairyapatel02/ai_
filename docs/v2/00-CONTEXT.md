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

## 4. Verified state at planning time (2026-11-09)

Commands run on the baseline in a clean container (Node 22, npm 10):

| Check | Result |
|---|---|
| `npm ci` | ✅ passes |
| `tsc --noEmit` (api, web) | ✅ passes |
| `nest build` (api) | ✅ builds, but **no `dist/worker` entry** exists |
| `next build` (web) | ❌ **fails**: `useSearchParams() should be wrapped in a suspense boundary at page "/connect/callback"` |
| `next lint` | ❌ no ESLint config (interactive prompt) |
| Tests | ❌ none exist |
| Tooling available in cloud container | `docker`, `psql`, `redis-server`, PostgreSQL 16 binaries |

## 5. Preliminary findings (pre-audit, from planning review)

Phase 1 must **verify, expand and formalise** these into `docs/v2/audit/ISSUES.md` with stable
IDs. Severity: 🔴 critical · 🟠 high · 🟡 medium · ⚪ low.

### Security
- 🔴 **No real authentication.** Every controller reads `req.headers['x-user-id']` (17 places).
  Any client can impersonate any user by setting that header.
- 🔴 **`POST /api/auth/dev-login` is public in all environments** and accepts any email →
  instant account takeover. The web app calls it automatically when no user is stored, so all
  visitors share one "Dev User".
- 🔴 **OAuth access tokens stored in plaintext** (`Integration.accessToken`).
- 🟠 GitHub connect flow has **no OAuth `state` parameter** (CSRF / account-linking attack).
- 🟠 Unbounded `limit` query param on `/activity/*` and `/documents` (DoS / data dump).
- 🟠 No rate limiting, no helmet; AI endpoints are effectively open → Anthropic cost abuse.
- 🟠 Next.js 14.2.3 has published CVEs (e.g. middleware authorization bypass, CVE-2025-29927).
- 🟡 Untrusted commit messages / PR titles are interpolated into prompts (prompt injection).
- 🟡 Prompts are filled with `String.prototype.replace(str, value)`; a value containing `$&`,
  `` $` ``, `$'` or `$$` is expanded as a replacement pattern and corrupts the prompt.

### Build / infrastructure
- 🔴 `next build` fails (see §4) → web Docker image cannot build.
- 🔴 `docker-compose.yml` `worker` runs `node dist/worker`, which does not exist.
- 🟠 `apps/web/Dockerfile` copies `apps/web/public`, which does not exist.
- 🟠 Prisma migrations are git-ignored; setup relies on `db push` (no migration history).
- 🟡 `tsconfig.tsbuildinfo` files are committed (stale incremental builds; the previous agent's
  skill file warns about "0 errors but no dist output").
- 🟡 `.env.example` defines `REDIS_URL` but code uses `REDIS_HOST`/`REDIS_PORT`; no Zod env
  validation (required by spec).
- 🟡 Node 18 base images (EOL). `packages/shared` is never imported (types duplicated inline).
- 🟡 No ESLint/Prettier config, no tests, no CI.

### Data / sync correctness
- 🔴 When syncing reviews, PRs the user only **reviewed** are inserted as **the user's own PRs**
  (stub `title: "PR #n"`, `state: CLOSED`). This inflates PR counts, PR lists, career timeline
  and AI input.
- 🟠 Dashboard card "PRs Merged" shows **total** PRs (all states).
- 🟠 Sync covers only the 30 most recently pushed repos (reviews: 15); `fetchReviews`
  paginates **every** PR in a repo; one extra `getCommit` call per commit (N+1). No rate-limit
  handling: secondary-rate-limit 403s are swallowed as warnings → **silent data loss**.
- 🟠 Commits only from the default branch; `branch` is hard-coded to `'main'`.
- 🟠 Spec items missing: webhooks, incremental sync, scheduled 24h sync.
- 🟡 `GET /sync/status` loads every job in the queue for all users and filters in memory; no
  persistent sync history; no per-user job de-duplication.
- 🟡 Date handling uses server-local time; `to=YYYY-MM-DD` is parsed as UTC midnight, so the
  last day of a range is excluded.
- 🟡 Disconnecting an integration cascades and deletes all synced activity without warning.
- ⚪ `Issue` model and `refreshToken` are unused.

### AI layer
- 🟠 Model hard-coded and outdated; SDK very old.
- 🟠 No streaming, no result caching (every click = new Claude call + new document), no schema
  validation of AI output (greedy `/\{[\s\S]*\}/` regex + `JSON.parse`).
- 🟠 Impact score is **entirely LLM-generated** → non-deterministic, not explainable, and it is
  auto-requested on every Dashboard/KPIs load when uncached (cost) — even for empty months.
- 🟡 Retries on every error, including non-retryable 400/401.
- 🟡 AI receives only the 20 most recent commits / 15 PRs (arbitrary sampling).
- ⚪ `enhanceCommitMessage` exists but is not exposed anywhere.

### API design
- 🟠 Errors return **HTTP 200** with `{ success:false }`; no exception filter.
- 🟠 No request validation in practice: bodies are typed as TS interfaces, so the global
  `ValidationPipe` does nothing; Zod (required by spec) is not used.
- 🟡 `POST /auth/github` and `/auth/google` are stubs.

### Frontend / UX
- 🔴 Sidebar is `hidden lg:flex` with no mobile alternative → unusable below 1024px.
- 🟠 Spec features missing: 30-day activity chart and recent-activity feed (dashboard),
  `DateRangePicker`, KPI monthly trend charts, career year filter, functional settings,
  documents library UI. `ActivityHeatmap` exists but is unused.
- 🟠 "Copy All" / "Export PDF" buttons on `/resume` have **no handlers**; appraisal export missing.
- 🟠 No `error.tsx` boundaries, no skeletons (single spinner), no route protection, `alert()` for errors.
- 🟡 KPI cards are mislabeled ("Code Quality" = PR count, "Ownership" = top-5 repo count).
- 🟡 Connect page shows "complete" for any connected provider regardless of real sync state;
  polling interval not cleared on unmount.
- 🟡 No dark mode, no design tokens beyond shadcn defaults, no onboarding flow.

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
