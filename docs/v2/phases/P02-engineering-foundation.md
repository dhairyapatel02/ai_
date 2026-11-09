# Phase 02 — Engineering Foundation & Stabilization

| | |
|---|---|
| **Goal** | Make the repo buildable, testable and safe to change: green build, lint, formatting, test harness, CI, migrations, seed data, worker entrypoint. Fix only blockers — no feature redesign. |
| **Type** | Code (tooling + minimal fixes) |
| **Prerequisites** | P01 merged (`docs/v2/audit/ISSUES.md` exists) |
| **Parallel with** | P03 |
| **Effort** | 1 session |

## Context
v0.1.0 has no lint config, no tests, no CI; `next build` fails; the docker `worker` service
points to a non-existent file; Prisma migrations are git-ignored; `tsconfig.tsbuildinfo` is
committed. Every later phase relies on a fast, trustworthy feedback loop, so this phase builds it.
Relevant issues: all `OPS-`, `DEBT-` and build-blocking `BUG-` items targeted at P02 in ISSUES.md.

## Read first
`docs/v2/audit/ISSUES.md` (filter Target phase = 02), `docs/v2/audit/ARCHITECTURE_CURRENT.md`,
`DECISIONS.md` D-002, D-011.

## Objectives
1. `npm run lint && npm run typecheck && npm test && npm run build` all pass from the root.
2. A test harness exists for API (unit + integration with real Postgres) and web (unit), and a
   Playwright smoke test runs against the running stack.
3. CI runs all of the above on every PR.
4. Database changes are tracked through committed Prisma migrations.
5. A deterministic seed script makes the app demo-able without GitHub or Anthropic.
6. Docker Compose builds and starts every service.

## In scope / out of scope
- ✅ Tooling, configs, build fixes, dependency **patch/minor** bumps, backend major bumps that
  don't change behaviour (Node 22, NestJS 11, Prisma latest, Anthropic SDK may wait for P08),
  Next.js to the latest **14.2.x patch** (security). Characterization tests of current behaviour.
- ❌ Auth redesign (P05), sync rewrite (P06), UI redesign (P09+), Next.js major upgrade (P09).

## Tasks

### A. Repo hygiene
1. Remove committed `tsconfig.tsbuildinfo` files; add `*.tsbuildinfo` and `next-env.d.ts` to `.gitignore`.
2. Stop ignoring `apps/api/prisma/migrations/`. Generate the initial migration from the current
   schema (`prisma migrate dev --name init`) and commit it. Update README to use
   `prisma migrate deploy` instead of `db push`.
3. Add `.nvmrc` (`22`), set `engines.node >= 22`, Docker bases → `node:22-alpine`.
4. Add `.editorconfig`, Prettier (+ `prettier-plugin-tailwindcss`), and run it once over the repo
   in a **separate commit** (`chore: format`).

### B. Lint & typecheck
5. ESLint flat config at the root (typescript-eslint strict-type-checked where practical,
   `eslint-config-next` for web, import ordering). Fix or explicitly disable (with reason) every
   violation so `npm run lint` is green.
6. Make API tsconfig fully `strict: true` (currently partial flags). Fix resulting errors.
7. Make `packages/shared` buildable and importable by both apps (fix `module`/`moduleResolution`
   for Nest CommonJS + Next bundler). Add a `typecheck` script for it. Do not migrate app code to
   it yet beyond what's needed to prove it works (P05/P09 do the migration).

### C. Build blockers
8. Fix `next build` failure on `/connect/callback` (wrap `useSearchParams` consumer in `<Suspense>`).
9. Create `apps/api/src/worker.ts`: a Nest application context that loads only the modules needed
   to process queues (no HTTP). Make the API process **not** register queue processors when
   `RUN_WORKER_IN_API=false` (default `true` for local dev convenience, `false` in compose).
   Update compose `worker` command to `node dist/worker.js`.
10. Fix web Dockerfile (`public/` missing → create `apps/web/public/.gitkeep` or drop the COPY;
    use Next `output: 'standalone'`). Fix API Dockerfile to run `prisma migrate deploy` on start
    (entrypoint script) and include the shared package correctly.
11. Add healthcheck endpoint `GET /api/health` (DB + Redis ping) and compose healthchecks for api/web.
12. Ensure `docker compose up --build` brings every service to healthy.

### D. Env validation
13. Add a Zod env schema in the API (`src/config/env.ts`) validated at startup; fail fast with a
    readable error. Unify Redis config on `REDIS_URL`. Add a web env schema (`src/env.ts`) for
    `NEXT_PUBLIC_*` and server vars. Update `.env.example` with every variable and comments.

### E. Test harness
14. API: Jest + ts-jest (or `@swc/jest`), `test/` folder, `npm test` (unit) and
    `npm run test:int` (integration). Integration tests use a dedicated Postgres database
    (`DATABASE_URL_TEST`), run migrations, and truncate between tests. Provide a `createTestApp()`
    helper and a factory module for test data.
15. Write **characterization tests** for current behaviour of: `ActivityService.getSummary`,
    `GenerateService.getDateRangeForPeriod`, `SyncProcessor.process` (Octokit + Prisma mocked),
    `AIService` prompt building (Anthropic mocked). Where current behaviour is a known bug (e.g.
    review stub PRs), write the test asserting the **correct** behaviour and mark it
    `it.todo`/`skip` with the issue ID — later phases un-skip them.
16. Web: Vitest + React Testing Library + jsdom; one test per shared component as a baseline.
17. E2E: Playwright config in `e2e/` (root or `apps/web/e2e`), one smoke test: load `/dashboard`
    with seeded data and assert stat cards render. Document `--trace off`.

### F. Seed data
18. `apps/api/prisma/seed.ts` (wired to `prisma db seed`): deterministic (fixed RNG seed) demo user
    `demo@devimpact.dev` with 6–12 months of realistic commits, PRs (authored + reviewed), reviews,
    issues, one GitHub integration (fake encrypted-later token), plus 2–3 generated documents.
    Data should produce interesting charts (streaks, gaps, multiple repos, varied PR sizes).

### G. CI
19. `.github/workflows/ci.yml`: on PR + push to `main`: install (cache), lint, typecheck, unit
    tests, integration tests (Postgres + Redis service containers), build all workspaces, Playwright
    smoke (against `next start` + API with seeded DB). Upload Playwright report on failure.
20. Add `npm run check` = lint + typecheck + test + build, and document it.

### H. Docs
21. Update root `README.md`: prerequisites (Node 22), setup with migrations + seed, running worker,
    running tests, CI. Remove stale instructions. Update `.agents/skills/testing-frontend/SKILL.md`
    to the new commands.

## Deliverables
Configs (ESLint, Prettier, Jest, Vitest, Playwright, CI), committed migration, `seed.ts`,
`worker.ts`, health endpoint, env schemas, fixed Dockerfiles/compose, characterization tests,
updated README and PROGRESS.md.

## Acceptance criteria
- [ ] Fresh clone → `npm ci && npm run check` passes locally and in CI.
- [ ] `docker compose up --build` → postgres, redis, api, worker, web all healthy; `/api/health` returns 200.
- [ ] `npx prisma migrate reset --force` then `npx prisma db seed` produces a demo user whose dashboard shows non-zero data.
- [ ] API starts and exits with a clear message when a required env var is missing.
- [ ] At least: 10 API unit tests, 3 API integration tests, 5 web component tests, 1 E2E smoke test — all green.
- [ ] Known-bug tests exist as skipped/todo with issue IDs.
- [ ] No behaviour changes beyond the listed fixes (verify by running the P01 API probes again; differences explained).
- [ ] CI workflow is green on the PR.

## Human review checklist
Check the CI run is green and the README setup steps work on your machine.

## Handoff
Record exact test commands, the seeded demo account, any skipped tests (with IDs), and CI timing.
