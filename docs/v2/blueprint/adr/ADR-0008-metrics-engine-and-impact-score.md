# ADR-0008: Deterministic metrics engine and impact score (overall + four dimensions)

**Status:** Accepted — **user decision (2026-11-09): "Deterministic, overall + dimensions"**
**Date:** 2026-11-09
**Deciders:** Project owner; Phase 03

## Context
v0.1.0's impact score is produced by an LLM on page load — non-deterministic, unexplainable,
billed per view and generated even for empty months (AI-01, API-04). KPI cards are mislabeled
(UX-06), "PRs merged" counts all PRs (DATA-02), dates use server-local time and drop the last day
(BUG-05/06), and summaries scan raw rows per request (PERF-03).

## Decision
1. Implement the catalogue and formulas in [KPI_METHODOLOGY.md](../KPI_METHODOLOGY.md)
   (`metrics@2.0.0`, `impact@2.0.0`) exactly.
2. **Impact score:** a single integer 0–100 **and** four dimension scores (Delivery 30 %,
   Quality 25 %, Collaboration 30 %, Ownership 15 %), computed from absolute reference bands,
   small-sample shrinkage (k = 3), saturation, minimum-data thresholds and documented rounding.
   Every score stores `scoreVersion`, all inputs and a rendered explanation.
3. **Engine structure** (`apps/api/src/metrics/`): pure metric functions (no I/O) +
   repository queries (Prisma; parameterised raw SQL allowed for aggregates) + rollup service
   (daily `MetricSnapshot`) + impact service (lazy compute & cache in `ImpactScore`).
4. **Periods** resolved in the user's IANA timezone with inclusive end dates via shared utilities.
5. **No LLM in any number.** AI narrative for a score is an explicit, cached call (ADR-0009).
6. GET endpoints are side-effect free; recomputation happens in the `metrics` queue after data changes.

## Options Considered

### Option A: Deterministic formula, overall + dimensions (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | Negligible compute, no AI cost |
| Scalability | Cached per period; rollups for charts |
| Team familiarity | High |

**Pros:** reproducible, explainable, testable with golden values; a headline number for the dashboard.
**Cons:** any single number invites over-interpretation — mitigated by copy, bands framed as "signal", no comparisons with others.

### Option B: Deterministic, dimensions only
**Pros:** less reductive. **Cons:** weaker at-a-glance signal; the spec and dashboard expect a score. Rejected by the owner.

### Option C: AI-assisted hybrid (bounded LLM adjustment)
**Pros:** can reflect qualitative evidence. **Cons:** non-reproducible, costs per computation, hard to explain. Rejected.

### Normalisation sub-options
- *Percentiles vs other users* — rejected (ranking people; privacy; cold start).
- *Personal baseline* — rejected for the score (a steady engineer would hover at 50; new users have no baseline); used for deltas/history instead.
- *Absolute bands with saturation* — chosen.

## Trade-off Analysis
Absolute bands make a period's score a pure function of that period's inputs (reproducible from
stored JSON), while shrinkage and saturation address noise and volume-gaming. Weights favour
delivery and collaboration equally, recognising reviews as first-class impact (audit finding).

## Consequences
- Easier: golden tests, "How is this calculated?" drawers, zero AI cost on views (fixes AI-01, API-04, DATA-02, UX-06, BUG-05/06, PERF-03, DATA-09).
- Harder: anchors and weights are opinions — they must be versioned and revisited with real usage data.
- Revisit: anchors after 90 days of production data (`impact@2.1.0`), team-relative views in v2.1 (opt-in only).

## Action Items
1. [ ] P07: implement metrics, rollups, impact service, golden tests (G-1, G-2, thresholds), period utilities, p95 < 150 ms.
2. [ ] P10: UI copy from KPI_METHODOLOGY (labels, definitions, caveats, explanation template).
3. [ ] P08: feed engine metrics into prompts; never let the model compute numbers.
