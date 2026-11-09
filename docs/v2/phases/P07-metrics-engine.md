# Phase 07 — Metrics Engine & Impact Score v2

| | |
|---|---|
| **Goal** | Implement the KPI methodology from the blueprint as a deterministic, tested, fast metrics engine with an explainable, versioned impact score and the metrics API the UI needs. |
| **Type** | Code (API + worker) |
| **Prerequisites** | P06 merged |
| **Parallel with** | P09 |
| **Effort** | 1 session |

## Context
v0.1.0 has only raw counts (`ActivityService.getSummary`) and an impact score produced entirely
by an LLM — non-deterministic, unexplainable, auto-triggered on page load, and wrong labels in the
UI (e.g. "Code Quality" = PR count). The blueprint's `KPI_METHODOLOGY.md` defines the metric
catalogue, formulas and the impact-score v2 algorithm. D-007 and its ADR are binding.

## Read first
`blueprint/KPI_METHODOLOGY.md` (primary spec), metrics ADR, `blueprint/DATA_MODEL_V2.md`
(`MetricSnapshot`, `ImpactScore`, `UserSettings.timezone`), `blueprint/API_CONTRACT_V2.md`
(metrics/activity/impact endpoints), `audit/ISSUES.md` (target 07). Skill: `dataviz` is not
needed here, but keep response shapes chart-friendly.

## Objectives
1. Every metric in KPI_METHODOLOGY.md implemented exactly as specified, with unit tests using
   hand-computed expected values.
2. Daily rollups so dashboards load fast for 12+ months of data.
3. Impact score v2: deterministic, versioned, explainable, with a "not enough data" state.
4. Time-zone-correct, inclusive period boundaries.
5. Metrics endpoints matching the API contract.

## Tasks
1. Migration: `MetricSnapshot` (userId, date in user TZ, metric values JSON or columns per
   ADR, computedAt, version), `ImpactScore` v2 fields (`scoreVersion`, `inputs` JSON,
   `dimensions`, `explanation`, `periodType`, `periodStart`), indexes. Migrate/discard v0.1.0
   AI-generated scores per ADR.
2. `apps/api/src/metrics/`:
   - `metric-definitions.ts` — one pure function per metric (input: normalised activity rows,
     period, tz; output: value + supporting evidence IDs). No Prisma inside pure functions.
   - `metrics.repository.ts` — efficient queries/aggregations (Prisma; raw SQL allowed for
     analytics per coding standards, parameterised).
   - `rollup.service.ts` — computes daily snapshots for a user/date range; idempotent.
   - `impact-score.service.ts` — implements the documented formula; stores inputs and the
     human-readable explanation; returns `insufficient_data` below the threshold.
3. Worker job `metrics-recompute` (queue created in P06): recompute affected days after sync,
   then period aggregates. Nightly safety recompute for the last N days.
4. Period utilities in `packages/shared`: month/quarter/year/custom ranges in the user's
   timezone, inclusive end-of-day, previous-period for deltas. Fix the v0.1.0 date-range bugs
   (server-local time, exclusive last day). Unit tests incl. DST transitions and year boundaries.
5. Endpoints per contract, e.g.:
   - `GET /metrics/overview?period=` — stat cards with value, previous value, delta, trend.
   - `GET /metrics/timeseries?metric=&from=&to=&interval=day|week|month`
   - `GET /metrics/heatmap?from=&to=` — daily activity counts.
   - `GET /metrics/kpis?period=` — the four sections with metric values + definitions + caveats.
   - `GET /impact?period=` and `GET /impact/history` — score, dimensions, explanation, inputs.
   - `GET /activity/feed?cursor=` — unified chronological feed (commits, PRs, reviews, achievements later).
   - Update `/activity/summary` or deprecate per contract.
   All responses validated by shared Zod schemas.
6. Remove the auto-AI impact-score call path. AI "highlights" for a score become an optional,
   explicit, cached call implemented in P08 (leave a typed hook/placeholder).
7. Performance: verify query plans (`EXPLAIN ANALYZE`) for overview/timeseries on a seeded user
   with 12 months × heavy activity; add indexes; target p95 < 150 ms server time.
8. Update the seed script so all metrics have meaningful values (including edge cases).
9. Fix the dashboard/KPI pages' data calls minimally so the current UI shows correct numbers and
   labels (e.g. "PRs merged" uses merged count). Full UI rebuild is P10.

## Tests
- Golden tests: a small fixed dataset with hand-calculated expected values for **every** metric
  and the impact score (documented in the test file).
- Property tests (e.g. `fast-check`) for period utilities and rollup idempotency.
- Integration tests for every endpoint (auth, validation, shape, ownership).
- Regression: impact score identical across two runs with same inputs; changes only when
  `scoreVersion` changes.

## Deliverables
Migration, metrics module, rollup + recompute jobs, period utils in shared, metrics/impact/feed
endpoints, golden tests, perf notes (`docs/v2/blueprint/PERF_NOTES.md` or in PROGRESS), updated
seed, PROGRESS.md.

## Acceptance criteria
- [ ] Every metric in KPI_METHODOLOGY.md has an implementation and a golden test; names/definitions match the doc exactly.
- [ ] Impact score is deterministic, stores `scoreVersion` + inputs, and returns an explanation string; `insufficient_data` handled.
- [ ] No Anthropic call happens on any metrics/impact GET request (test with the AI client mocked to throw).
- [ ] Period boundaries respect `UserSettings.timezone` and include the full last day (tests).
- [ ] p95 server time < 150 ms for overview/timeseries on the heavy seeded user (measured, recorded).
- [ ] Current UI shows correct, correctly-labeled numbers.
- [ ] `npm run check` + CI green.

## Handoff
List endpoints + example responses (for P10), the score version, and any metric deferred (with reason).
