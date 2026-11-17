# Performance notes

*Phase 07 · 2026-11-17.* Target from the P07 phase file / ADR-0008: **p95 server time < 150 ms**
for `/metrics/overview` and `/metrics/timeseries` on a heavy seeded user (12 months, heavy
activity). Later phases append their measurements here.

## P07 — metrics engine

### How to reproduce

```bash
npm run db:deploy
npm run db:seed:heavy   # heavy@devimpact.dev + 20 filler users, snapshots computed
npm run perf:metrics    # prints the table and EXPLAIN ANALYZE plans below
```

`apps/api/prisma/scripts/measure-metrics-perf.ts` calls the real services
(`MetricsService` → `ImpactScoreService` → `MetricsRepository` → Postgres) in-process, so the
numbers are server time without HTTP, auth guard and envelope; those add ≈ 2–5 ms (pino
`responseTime` of 16–20 ms for the first, uncached `/metrics/overview`, `/impact` and
`/metrics/repos` calls of the demo user in the E2E run).

**"cold"** = the user's cached `ImpactScore` rows are deleted before every call (worst case right
after a `metrics.recompute`); **"warm"** = cache hits (the normal case).

### Dataset and environment

- `heavy@devimpact.dev`, America/New_York, 12 months: **5,196 commits** (8 % merge commits),
  **1,098 authored PRs** (25 % drafts, 3 % reverted), **1,654 reviews** on 1,654 reviewed PRs,
  25 repositories (2 excluded), 364 snapshot rows.
- 20 filler users (≈ 600 commits each) so the user filter is selective: database totals 16,892
  commits, 14,478 PRs, 7,490 reviews.
- Cloud container, 4 vCPU, PostgreSQL 16.15 local, Node 22, `ANALYZE` after seeding.

### Results (2026-11-17)

| Call | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| overview month (cold) | 50 | 17.4 | 28.0 | 33.3 |
| overview month (warm) | 200 | 1.7 | 3.5 | 4.4 |
| overview year (cold) | 30 | 74.6 | 99.9 | 107.6 |
| overview year (warm) | 200 | 1.5 | 3.2 | 4.5 |
| kpis quarter (cold) | 30 | 17.0 | 24.1 | 24.8 |
| timeseries commits/day, 12 months (snapshots) | 100 | 3.0 | 4.4 | 9.2 |
| timeseries prs_merged/week, 12 months (snapshots) | 100 | 2.9 | 4.1 | 4.7 |
| timeseries pr_cycle_time/week, 12 months (facts) | 50 | 31.6 | 47.1 | 81.8 |
| timeseries prs_reviewed/month, 12 months (facts) | 50 | 18.4 | 28.7 | 52.4 |
| heatmap 365 days | 100 | 2.6 | 4.2 | 6.8 |
| impact history 12 months (cold) | 10 | 103.1 | 118.6 | 118.6 |
| trends 6 months (warm) | 100 | 2.3 | 3.9 | 6.1 |

**Verdict: met.** Worst p95 for the target endpoints is 99.9 ms (overview of a whole year with a
cold cache: two full-year computations, current and previous year). Warm overview is ~3 ms.
Snapshot-backed timeseries are < 5 ms; fact-backed median/ratio timeseries < 50 ms.

### Query plans (EXPLAIN ANALYZE, 12-month range)

| Query | Plan | Rows | Execution |
|---|---|---|---|
| Authored PRs (`created`/`merged`/`closed`/`first_review` in range) | Bitmap index scan on `(userId, external_id)` → filter; hash join `repositories` (included) | 994 | 0.95 ms |
| Reviews in range (+ reviewed PR, included repo) | Seq scan `pull_request_reviews` + hash joins | 1,528 | 4.7 ms |
| Commits in range (no merge commits, included repo) | Seq scan `commits` + hash join | 4,363 | 3.9 ms |
| Snapshots (365 days) | Seq scan `metric_snapshots` (554 rows total) | 364 | 0.11 ms |
| Impact score cache lookup | Index scan `impact_scores_user_id_period_start_period_end_idx` | 1 | 0.013 ms |

The planner picks sequential scans for reviews/commits because the heavy user owns ~30 % of
those small tables; with more users the existing indexes `commits (userId, authored_at)`,
`pull_request_reviews (user_id, submitted_at)`, `pull_requests (userId, is_authored_by_user,
mergedAt|created_at_remote|closed_at)`, `metric_snapshots (user_id, date)` (unique) and
`impact_scores (user_id, period_start, period_end)` take over (verified on the same queries
with `SET enable_seqscan = off`: all index scans, < 5 ms). **No new index was needed**; the
only index added by P07 is the impact-score lookup index (migration P07-1).

### Where the time goes and what was changed

- A cold period computation = 3 indexed fact loads (≈ 10 ms for a year) + pure computation
  (business hours walk local days; offsets and day starts are memoised per time zone) + one
  upsert. Multi-period misses (`/impact/history`, `/metrics/trends`, overview's previous period)
  load facts **once** for the union of the periods and write the cache rows concurrently
  (history cold p95 158 → 119 ms after that change).
- Count charts never touch the fact tables (snapshots); medians/ratios per bucket reuse one fact
  load for the whole range.

### Follow-ups

- P14: re-measure on production-like volumes (Postgres in a separate container/host, many users)
  and add `pg_stat_statements` dashboards; consider a per-user data version to close the
  cache-write race (PERF-06).
