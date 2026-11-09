# Phase 03 — V2 Blueprint: Product, KPI Methodology & Architecture

| | |
|---|---|
| **Goal** | Decide **what** v2.0 is and **how** it is built: product requirements, KPI/impact-score methodology, target architecture, data model, API contract. Every later phase implements this blueprint. |
| **Type** | Design (documents only; no app code) |
| **Prerequisites** | P01 merged |
| **Parallel with** | P02 |
| **Effort** | 1 session; requires the user to answer decision questions |

## Context
v0.1.0 followed a feature checklist but lacks a product model: KPIs are mislabeled, the impact
score is an opaque LLM guess, auth is fake, and sync is incomplete. `DECISIONS.md` holds the
planner's **PROPOSED** defaults (D-001…D-014). This phase validates them with the user, fills the
gaps, and produces the binding blueprint.

## Read first
`00-CONTEXT.md`, `ORIGINAL_SPEC.md`, `DECISIONS.md`, `audit/AUDIT_REPORT.md`, `audit/ISSUES.md`,
`audit/SPEC_GAP_MATRIX.md`, `audit/ARCHITECTURE_CURRENT.md`.
Useful skills: `engineering:system-design`, `engineering:architecture`, `design-skills:ux-strategy`,
`claude-api` (for model IDs, structured output, streaming capabilities).

## Objectives
1. A PRD that defines users, jobs-to-be-done, v2.0 scope, and success metrics.
2. A rigorous, fair, explainable KPI & impact-score methodology.
3. Confirmed architecture decisions (ADRs) for every PROPOSED item.
4. Target data model (Prisma-level) and migration strategy from v0.1.0.
5. API contract v2 (endpoints + Zod schemas sketch) and a phase-by-phase traceability map.

## USER DECISIONS (ask with AskUserQuestion, max 4 per call, recommend a default)
1. **Scope of v2.0** (D-014): individual-only vs. include manager/team views; billing now or later.
2. **Auth approach** (D-003): Better Auth vs Auth.js v5 in web, or NestJS-owned auth.
3. **GitHub data-source mechanism** (D-004): OAuth App vs GitHub App.
4. **Impact score** (D-007): deterministic formula (recommended) vs AI-assisted hybrid; whether to show a single number at all or only dimension scores.
5. **Additional integrations** in v2.0 (P13 in or out).
6. **Hosting target** (D-013) if the user already knows.
7. **Brand/visual direction** keywords for P04 (e.g. "calm, professional, Linear-like" vs "playful").
Record answers as CONFIRMED entries in `DECISIONS.md`.

## Tasks

### A. Product
1. `blueprint/PRD.md`:
   - Personas (IC engineer, senior/staff engineer preparing promotion, manager — if in scope).
   - Jobs-to-be-done and top user journeys (first-run → connect → insight in < 3 minutes;
     prepare appraisal; build promotion case; update resume; weekly reflection).
   - Feature list with MoSCoW priority and owning phase. Include proactive improvements, e.g.:
     achievements/brag journal (manual non-code wins: mentoring, incidents, design docs),
     goals & OKR tracking linked to evidence, weekly/monthly digest email, documents library with
     versions, evidence citations on AI output, "explain this metric", data privacy controls
     (repo include/exclude, private-repo redaction, delete my data, export my data),
     shareable read-only links for documents, command palette, dark mode.
   - Non-functional requirements: performance budgets (e.g. dashboard TTI < 2s on seeded data),
     availability, privacy/GDPR, accessibility (WCAG 2.2 AA), browser support, cost ceilings per user.
   - Success metrics (activation rate, time-to-first-insight, docs generated/user, retention).

### B. KPI & impact-score methodology
2. `blueprint/KPI_METHODOLOGY.md`:
   - Metric catalogue. For each metric: name, user-facing definition, formula, data source fields,
     granularity, caveats, "good" range, anti-gaming notes. Organise into the four spec sections
     **Productivity / Delivery, Quality, Collaboration, Ownership** (+ Consistency if useful).
     Candidates: PRs merged, PR cycle time (open→merge), time to first review (as author),
     review turnaround (as reviewer), review participation, PR size distribution (median changed
     lines), merge rate, rework/revert rate, active days & streaks, repos contributed to,
     cross-repo breadth, issues closed / story points (when Jira/Linear present).
   - Explicitly avoid raw LOC as a productivity signal; explain why.
   - Impact score v2: dimensions, normalisation (per-user baseline / percentile vs absolute
     bands), weights, smoothing, minimum-data threshold ("not enough data"), versioning
     (`scoreVersion`), and the text shown in "How is this calculated?".
   - Where the LLM is used (highlights, narratives) and where it is not (numbers).
   - Time zones & period boundaries (user timezone setting; inclusive ranges).

### C. Architecture
3. `blueprint/ARCHITECTURE_V2.md`: target component diagram, process model (web, api, worker,
   scheduler), request flow, auth flow, sync flow (initial backfill, incremental, webhooks),
   metrics rollup flow, AI generation flow (sync vs queued, streaming), caching layers, secrets
   handling, observability, multi-tenancy (team model if in scope).
4. `blueprint/adr/ADR-0001…`: one ADR per confirmed decision (use the `engineering:architecture`
   skill format: context, options, decision, consequences). At minimum: monorepo/tooling, versions,
   auth, GitHub App vs OAuth, token encryption, API conventions, sync strategy, metrics engine,
   AI generation, frontend data layer, testing, exports, hosting.
5. Update `DECISIONS.md`: mark each D-0xx CONFIRMED / AMENDED / REJECTED with a link to its ADR.

### D. Data model & API
6. `blueprint/DATA_MODEL_V2.md`: Prisma schema draft for v2 (Mermaid ERD + schema block), e.g.
   `Account/Session` (auth lib), `Integration` (encrypted tokens, scopes, status, cursors,
   `lastSyncedAt`, webhook ids), `Repository` (include/exclude flag), `Commit`, `PullRequest`
   (+ additions, deletions, changedFiles, firstReviewAt, closedAt, isDraft, authorExternalId),
   `PullRequestReview` linked to PR **without implying authorship**, `Issue`, `SyncRun`,
   `MetricSnapshot` (daily per user), `ImpactScore` (+ `scoreVersion`, inputs JSON),
   `GeneratedDocument` (+ status, version, title, inputHash, model, tokens, evidence refs),
   `Achievement`, `Goal`, `UserSettings` (timezone, notification prefs), `AiUsage`.
   Include indexes, uniqueness, retention, and a **migration plan from v0.1.0** (data backfill,
   what can be dropped).
7. `blueprint/API_CONTRACT_V2.md`: every endpoint (method, path, auth, request schema, response
   schema, errors, pagination, rate-limit class). Group: auth, me/settings, integrations, repos,
   sync, activity, metrics, impact, documents/generation (incl. SSE stream endpoints), achievements,
   goals, exports, webhooks, health. Note which v1 endpoints are kept, changed, or removed.
8. `blueprint/TRACEABILITY.md`: matrix of PRD feature → KPI/ADR → data model → endpoint → UI page
   → implementing phase (P05–P15). Every `ISSUES.md` row with target ≥ P05 must map to a feature or
   be marked "won't fix" with a reason.
9. Review the phase files P04–P15 against the blueprint. If a phase needs adjusting (scope moved,
   new task), **append** a "Blueprint amendments" section at the bottom of that phase file rather
   than rewriting it, and note it in PROGRESS.md.

## Deliverables
```
docs/v2/blueprint/PRD.md
docs/v2/blueprint/KPI_METHODOLOGY.md
docs/v2/blueprint/ARCHITECTURE_V2.md
docs/v2/blueprint/DATA_MODEL_V2.md
docs/v2/blueprint/API_CONTRACT_V2.md
docs/v2/blueprint/TRACEABILITY.md
docs/v2/blueprint/adr/ADR-*.md
docs/v2/DECISIONS.md (confirmed)
docs/v2/phases/P04…P15 (amendment sections if needed)
```

## Acceptance criteria
- [ ] Every PROPOSED decision is CONFIRMED/AMENDED/REJECTED with an ADR link; user decisions recorded with the user's answer.
- [ ] Every metric in KPI_METHODOLOGY.md has a formula precise enough to implement and test without further questions.
- [ ] Impact score is reproducible from the documented formula and stored inputs.
- [ ] DATA_MODEL_V2 includes a migration plan from the current schema.
- [ ] API_CONTRACT_V2 covers every UI need listed in the PRD; every endpoint has request/response shapes and error codes.
- [ ] TRACEABILITY maps every PRD "Must" feature to an implementing phase; every open ISSUES.md row ≥ P05 is mapped or marked won't-fix.
- [ ] Only files under `docs/v2/` changed.

## Human review checklist
Read PRD scope + KPI methodology summary. These define the product — push back now if anything
feels wrong; later phases treat them as binding.

## Handoff
Summarise confirmed decisions (one line each) in PROGRESS.md and list any phase amendments.
