# Phase 01 — Audit & Discovery

| | |
|---|---|
| **Goal** | Build a complete, verified understanding of what v0.1.0 does, how it works, what is broken and what is missing — before anything is changed. |
| **Type** | Analysis. **No feature code and no fixes.** Only docs, scripts under `docs/v2/audit/scripts/`, and throwaway local config. |
| **Prerequisites** | Planning PR merged; integration branch exists (see README branching protocol). |
| **Parallel with** | — (everything depends on this) |
| **Effort** | 1 session (large) |

## Context

The previous agent built v0.1.0 quickly and the owner does not know exactly what works.
`00-CONTEXT.md §5` lists ~45 preliminary findings from a static read during planning. This phase
turns that into a **verified, prioritised, ID'd backlog** and a clear map of the system, by
reading every file **and actually running the stack**.

## Read first
- `docs/v2/00-CONTEXT.md`, `docs/v2/ORIGINAL_SPEC.md`
- Every file under `apps/`, `packages/`, plus `docker-compose.yml`, `.env.example`, root `README.md`,
  `.agents/skills/testing-frontend/SKILL.md`.

## Objectives
1. Document the current architecture and every runtime flow, accurately.
2. Run the system end-to-end and record what works and what fails, with evidence.
3. Produce a gap matrix: original spec → implemented / partial / missing / wrong.
4. Produce a single prioritised issue backlog with stable IDs used by all later phases.

## In scope / out of scope
- ✅ Reading, running, probing, measuring, documenting. Small throwaway scripts (e.g. a curl
  probe, a fixture seeder) kept in `docs/v2/audit/scripts/`.
- ❌ Fixing bugs, refactoring, upgrading dependencies, changing app code. (Exception: none. If
  the stack cannot run without a code change, apply it **locally only**, do not commit it, and
  record it as an issue.)

## Tasks

### A. Environment bring-up
1. `npm ci` at repo root. Delete `apps/*/tsconfig.tsbuildinfo` before building.
2. Start Postgres + Redis: `docker compose up -d postgres redis`. If the Docker daemon is not
   available, start them directly (PostgreSQL 16 binaries under `/usr/lib/postgresql/16/bin`,
   `redis-server --daemonize yes`), create role/db `devimpact` matching `.env.example`.
3. `cp .env.example .env`; use dummy values for OAuth/Anthropic keys.
4. `npx prisma generate && npx prisma db push` in `apps/api`.
5. Run API (`npm run dev:api`) and web (`npm run dev:web`). Record every error.
6. Try `docker compose up --build` for the full stack; record each failing service and why.
7. Run `npm run build`, `npm run typecheck`, `npm run lint` at root; record results verbatim.

### B. Static architecture analysis
8. Write `docs/v2/audit/ARCHITECTURE_CURRENT.md`:
   - Component diagram (Mermaid): web ↔ api ↔ postgres/redis/worker ↔ GitHub/Anthropic.
   - Module-by-module description of the API (controllers, services, dependencies).
   - Data model ERD (Mermaid) with notes on every field that is unused, misnamed or misused.
   - Sequence diagrams (Mermaid) for: first visit/login, GitHub connect, sync job, dashboard
     load, resume generation, impact score.
   - Frontend route map: each page, data it fetches, components used, states handled.
   - Config/env inventory: every env var read in code vs. declared in `.env.example`.
9. Dependency audit: `npm outdated`, `npm audit --omit=dev`; list majors behind and CVEs.

### C. Runtime / behavioural testing (black-box + white-box)
10. Create `docs/v2/audit/scripts/seed-fixture.ts` (or SQL) that inserts a realistic user with
    ~6 months of commits, PRs, reviews into the local DB, so pages can be exercised without
    GitHub. (This is an audit helper; P02 will build the real seed script.)
11. Exercise **every API endpoint** with curl (happy path + bad input + missing/forged
    `x-user-id` + another user's resource IDs). Record status code, body, and verdict in
    `docs/v2/audit/API_TEST_RESULTS.md`. Explicitly demonstrate the impersonation issue.
12. Exercise **every page** with Playwright (Chromium pre-installed; `require('playwright')`),
    at 1440px and 390px widths, with: empty DB, seeded DB, API down. Save screenshots to
    `docs/v2/audit/screenshots/` (deviceScaleFactor 1) and notes to
    `docs/v2/audit/UI_TEST_RESULTS.md` (what renders, what breaks, console errors, dead buttons).
13. Sync logic review: trace `sync.processor.ts` + `github.service.ts` line by line; estimate
    GitHub API calls for a user with 30 repos × 200 commits; list correctness bugs with a
    concrete example each (e.g. reviewed-PR stub inflating counts). If you can, unit-run the
    processor against mocked Octokit responses to prove the stub-PR bug.
14. AI layer review: for each prompt, note inputs, sampling, output parsing, failure modes,
    cost per call estimate, and the `String.replace` `$`-pattern bug (write a 5-line repro).
15. UX heuristic review (use the `design-critique` / `design-skills:design-critique` skill if
    available): Nielsen heuristics per page, top 10 UX problems with screenshots.

### D. Synthesis
16. `docs/v2/audit/SPEC_GAP_MATRIX.md`: one row per item in `ORIGINAL_SPEC.md` (every page,
    component, endpoint, model, AI method, standard) → status ✅/🟡/❌/⚠️wrong + evidence link.
17. `docs/v2/audit/ISSUES.md`: the master backlog. One row per issue:
    `ID | Category | Severity | Title | Evidence (file:line / test) | Impact | Suggested fix | Target phase`.
    ID prefixes: `SEC-`, `BUG-`, `DATA-`, `AI-`, `API-`, `UX-`, `GAP-`, `DEBT-`, `OPS-`, `PERF-`.
    Include and verify every finding in `00-CONTEXT.md §5`; mark any that turn out false.
    Target phases follow the plan in `README.md`.
18. `docs/v2/audit/AUDIT_REPORT.md` — executive summary for the owner (non-technical first
    page): what works, what doesn't, top 10 risks, effort outlook, "keep vs rewrite" verdict per
    module with justification, and opportunities/feature ideas discovered.
19. Refresh `00-CONTEXT.md` §4–§5 to match verified reality (keep it concise; link to ISSUES.md).

## Deliverables
```
docs/v2/audit/AUDIT_REPORT.md
docs/v2/audit/ARCHITECTURE_CURRENT.md
docs/v2/audit/SPEC_GAP_MATRIX.md
docs/v2/audit/ISSUES.md
docs/v2/audit/API_TEST_RESULTS.md
docs/v2/audit/UI_TEST_RESULTS.md
docs/v2/audit/screenshots/*.png
docs/v2/audit/scripts/*        (probe + fixture helpers)
docs/v2/00-CONTEXT.md          (refreshed §4–§5)
docs/v2/PROGRESS.md            (phase log)
```

## Acceptance criteria
- [ ] Every source file was read; ARCHITECTURE_CURRENT.md covers every module, model and page.
- [ ] Every endpoint in the API has at least 3 recorded probes (happy, invalid, unauthorised/forged).
- [ ] Every page has screenshots for desktop + mobile in seeded and empty states.
- [ ] Every preliminary finding in `00-CONTEXT.md §5` is marked verified, refuted, or amended in ISSUES.md.
- [ ] ISSUES.md has stable IDs, severities and a target phase for every row; sorted by severity.
- [ ] SPEC_GAP_MATRIX.md covers 100% of ORIGINAL_SPEC items.
- [ ] AUDIT_REPORT.md first page is readable by a non-engineer.
- [ ] `git diff --stat` shows changes only under `docs/v2/`.

## Human review checklist
Read AUDIT_REPORT.md page 1 and the top 15 rows of ISSUES.md. Confirm the "keep vs rewrite"
verdicts make sense to you before P02/P03 start.

## Handoff
In PROGRESS.md list: exact commands that got the stack running, any local-only hacks needed,
issue counts by severity, and anything P02/P03 must prioritise.
