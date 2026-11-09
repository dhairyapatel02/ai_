# ADR-0011: Testing strategy

**Status:** Accepted (confirms D-011 with specifics for GitHub/Anthropic mocking and fixtures)
**Date:** 2026-11-09
**Deciders:** Phase 03

## Context
v0.1.0 has no tests, lint or CI (DEBT-02/03). v2 needs confidence for auth, sync correctness, metric
formulas and AI output contracts, without calling real GitHub or Anthropic.

## Decision
| Layer | Tool | Scope |
|---|---|---|
| API unit | **Jest** (chosen by P02, D-016: `*.spec.ts` unit, `test/integration/*.int-spec.ts` against `DATABASE_URL_TEST`) | pure functions (metrics, periods, encryption, template filling, citation verifier), services with mocked deps |
| API integration | Jest + **supertest** against a real **Postgres 16** + **Redis 7** (CI service containers; local compose) | every endpoint: auth required, ownership, validation, envelope, rate limits |
| Shared | Vitest | period utilities (+ `fast-check` property tests), schemas |
| Web unit/component | **Vitest** + React Testing Library | components and page states with a mocked query client |
| E2E | **Playwright** (Chromium in CI; Firefox/WebKit in P14), `--trace off` by default | every PRD Must journey by P14 |
| Accessibility | `@axe-core/playwright` | shell and every page (0 serious/critical) |
| GitHub | **MSW** (`msw/node`) with recorded GraphQL/REST fixtures under `apps/api/test/fixtures/github/`; request log assertions for budgets | P06 |
| Anthropic | Mock server via `ANTHROPIC_BASE_URL` (formalised from `docs/v2/audit/scripts/mock-anthropic.mjs`) + recorded responses for evals | P08 |
| Evals | deterministic checks in CI; `npm run eval:live` optional | P08 |
| Load | k6 or autocannon | P14 |

- Golden tests document hand-computed expectations in the test file (KPI_METHODOLOGY §10).
- Seed script (P02) provides personas incl. a heavy user (12 months, ~3k PRs/reviews) for perf/E2E.
- CI (GitHub Actions): lint → typecheck → unit → integration (services) → build → E2E smoke; `npm audit --omit=dev` gate.
- Tests never use real credentials; secrets in CI are dummies.

## Options Considered
### Option A: Jest (api) + Vitest (web/shared) + Playwright + MSW (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | Free |
| Scalability | Standard |
| Team familiarity | High |

**Pros:** idiomatic per framework; MSW works with octokit's fetch. **Cons:** two unit runners.

### Option B: Vitest everywhere
**Pros:** one runner. **Cons:** Nest decorators/metadata need SWC config. Allowed as a P02 choice.

### Option C: Testcontainers instead of CI services
**Pros:** hermetic locally. **Cons:** Docker-in-container friction in the cloud sandbox. Not required.

## Consequences
- Easier: regression safety for every later phase.
- Harder: fixture upkeep when GitHub/Anthropic schemas evolve.

## Action Items
1. [ ] P02: harness, CI, seed personas.
2. [ ] P05–P12: tests per phase acceptance criteria.
3. [ ] P14: full journey suite + cross-browser.
