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
