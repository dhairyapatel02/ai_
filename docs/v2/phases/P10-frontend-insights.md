# Phase 10 — Frontend: Insights Pages

| | |
|---|---|
| **Goal** | Build the v2 insight experience — Dashboard, Activity explorer, KPIs, Impact detail, Career timeline, Integrations — on the P09 foundation, wired to the P06/P07 APIs, matching the P04 designs. |
| **Type** | Code (web) |
| **Prerequisites** | P07 and P09 merged |
| **Parallel with** | P11 |
| **Effort** | 1 session (large) |

## Context
v0.1.0 pages: Dashboard lacks the 30-day chart and activity feed and mislabels "PRs merged";
KPIs show raw counts under wrong labels with no trends; Career is a list grouped by quarter with
no filter; Connect shows fake sync status; no Activity explorer exists. P07 provides correct
metrics endpoints; P06 provides sync status/history and repo selection.

## Read first
`design/SCREENS.md` (these pages), `design/DESIGN_SYSTEM.md` (data-viz rules),
`blueprint/KPI_METHODOLOGY.md` (definitions & caveats to show in UI), `blueprint/API_CONTRACT_V2.md`,
P07 + P09 handoff notes in `PROGRESS.md`. Skills: `dataviz` (**load before writing any chart**),
`design-skills:ux-writing`, `nextjs-ai-skills:react-best-practices`.

## Objectives
Each page matches its SCREENS.md spec in all five states (loading, empty, partial, error,
success), on desktop and mobile, in light and dark, using only API data (no mocks in prod code).

## Tasks
1. **Dashboard** (`/dashboard`): stat cards (commits, PRs merged, reviews given, impact score)
   with period-over-period deltas from `/metrics/overview`; 30-day activity chart
   (`/metrics/timeseries`); contribution heatmap (`/metrics/heatmap`); impact score card with
   dimension breakdown + "how calculated" popover; recent activity feed (`/activity/feed`, infinite
   scroll); "next best action" card(s) per design; quick actions (Generate resume/appraisal,
   Add achievement). Empty states: not connected → connect CTA; syncing → live progress; no data
   in period → suggest wider range.
2. **Activity explorer** (`/activity`): unified, filterable, searchable list (type, repo, date range,
   state), detail drawer for a PR/commit with stats and link to GitHub, "Turn into achievement"
   action (calls P08 enhance endpoint; hide if P08 not merged), URL-synced filters.
3. **KPIs** (`/kpis`): four sections (Delivery/Productivity, Quality, Collaboration, Ownership)
   with metric cards exactly as defined in KPI_METHODOLOGY (names, units, caveats), monthly trend
   charts per metric, period comparison, impact donut with breakdown, "not enough data" states.
4. **Impact detail** (`/kpis/impact` or modal per IA): score history chart, dimension drill-down,
   explanation text, inputs table, AI highlights button (explicit, cached; P08).
5. **Career timeline** (`/career`): year → quarter timeline, grouped by repo/project, achievement
   tags, milestone markers (first PR in repo, largest PR, streaks), year filter, expand/collapse,
   print-friendly view.
6. **Integrations** (`/settings/integrations` or `/connect` per IA): provider cards (GitHub live;
   others "coming soon" or live if P13), real status (`connected`, `syncing` with progress,
   `needs_reauth`, `error`), last sync + sync history table (`/sync/runs`), Sync now, repo
   include/exclude manager (P06 API), disconnect with confirm dialog explaining data consequences.
7. Global period picker drives every page via URL state; deep links reproduce the view.
8. Performance: route-level code splitting for chart libs, prefetch on nav hover, no layout shift
   (reserve chart heights), Lighthouse ≥ 90 performance/accessibility on Dashboard with seeded data.
9. Tests: Vitest for page-level components (states via mocked query client); Playwright E2E for
   dashboard (seeded) → drill into KPI → activity filter → career year filter → trigger sync →
   progress → completion; visual screenshots to `docs/v2/screenshots/p10/` (light/dark,
   desktop/mobile) at deviceScaleFactor 2.
10. Remove v0.1.0 page code that is superseded; delete unused components.

## Deliverables
Five rebuilt/new page areas, any new components, tests, screenshots, Lighthouse report
summary in PROGRESS.md.

## Acceptance criteria
- [ ] Every page implements all five states per SCREENS.md (verified by component tests with mocked queries).
- [ ] Numbers on Dashboard/KPIs match API responses exactly; labels and definitions match KPI_METHODOLOGY.
- [ ] Charts follow the `dataviz` rules (accessible names/summaries, consistent palette, both themes).
- [ ] Works at 390px without horizontal scroll; keyboard-navigable; axe 0 serious/critical.
- [ ] Lighthouse ≥ 90 (performance + accessibility) on Dashboard, seeded data, production build.
- [ ] E2E insight journey green; screenshots committed.
- [ ] `npm run check` + CI green.

## Handoff
Note any API gaps worked around, any design deviations (with reason), and remaining UX polish ideas.
