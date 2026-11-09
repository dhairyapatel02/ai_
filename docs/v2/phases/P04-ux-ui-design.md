# Phase 04 — UX/UI Design System & Prototype

| | |
|---|---|
| **Goal** | Design the complete v2 experience — information architecture, flows, every screen and state, and a design system — and validate it with a clickable prototype before frontend code is written. |
| **Type** | Design (docs + static prototype) |
| **Prerequisites** | P03 merged (PRD, KPI methodology, API contract) |
| **Parallel with** | P05 |
| **Effort** | 1 session; user reviews the prototype |

## Context
v0.1.0 UI is a default shadcn layout: desktop-only sidebar, a spinner for every load, dead
buttons, mislabeled KPIs, no onboarding, no dark mode, no documents library. The owner wants a
"much better UI/UX and more intuitive experience". Audit evidence: `audit/UI_TEST_RESULTS.md`,
`audit/screenshots/`, UX issues (`UX-*`) in `audit/ISSUES.md`.

## Read first
`blueprint/PRD.md`, `blueprint/KPI_METHODOLOGY.md`, `blueprint/API_CONTRACT_V2.md`,
`audit/UI_TEST_RESULTS.md`, `DECISIONS.md` (brand direction answer).
Skills to load: `artifact-design` (before writing the prototype), `design-skills:design-systems`,
`design-skills:interaction-design`, `design-skills:ux-writing`, `design-skills:accessibility-audit`,
`dataviz` (before designing any chart), `nextjs-ai-skills:frontend-design`.

## Objectives
1. An information architecture and navigation model that makes the core loop obvious:
   **Connect → See impact → Capture wins → Generate documents**.
2. End-to-end user flows including first-run onboarding and every empty/loading/error state.
3. A tokenised design system (light + dark) implementable with Tailwind v4 + shadcn/ui.
4. Wireframes/specs for every screen at desktop and mobile widths.
5. A clickable HTML prototype the owner approves.

## Tasks

### A. Structure
1. `design/IA.md`: sitemap, navigation (grouped sidebar e.g. *Overview* — Dashboard, Activity,
   KPIs, Career; *Create* — Documents studio (Resume/Appraisal/Promotion), Achievements, Goals;
   *Settings* — Integrations, Profile, Notifications, Privacy, Plan), mobile navigation pattern,
   command palette (⌘K) actions, global date-range control semantics, URL structure.
2. `design/FLOWS.md` (Mermaid flowcharts + narrative): sign-up/sign-in, onboarding wizard
   (connect GitHub → choose repos → watch first sync with live progress → land on populated
   dashboard), reconnect/expired token, manual sync, generate → stream → edit → export document,
   regenerate with different options, add achievement, set goal, delete account / export data.

### B. Design system
3. `design/DESIGN_SYSTEM.md`: principles; tokens (color palette with semantic roles incl. chart
   categorical/sequential palettes validated for contrast in light/dark, typography scale,
   spacing, radii, shadows, motion durations/easing); component inventory mapped to shadcn/ui
   primitives with variants and states; data-viz rules (chart types per metric, axis/legend/
   tooltip conventions, number formatting); iconography; voice & tone + microcopy rules
   (button labels, empty states, errors).
4. `design/tokens.css` (or `tokens.json`): the actual CSS variables P09 will import.

### C. Screens
5. `design/SCREENS.md`: for each screen — purpose, primary action, layout (ASCII/Markdown
   wireframe or embedded SVG), components, data (endpoint from API contract), and **states**:
   loading skeleton, empty (no integration / syncing / no data in range), partial data, error,
   success. Desktop (1440) and mobile (390) notes. Screens: Sign-in, Onboarding (steps),
   Dashboard, Activity explorer (filterable list of commits/PRs/reviews), KPIs (four sections +
   trends + "how calculated" drawers), Impact score detail, Career timeline (year/quarter, repo
   grouping, tags, year filter), Documents library, Resume studio, Appraisal studio, Promotion
   studio, Document viewer/editor with evidence citations, Achievements, Goals, Integrations,
   Settings (profile, notifications, privacy/data, plan), 404/500.
6. Dashboard specifics: stat cards with period-over-period deltas, 30-day activity chart,
   contribution heatmap, recent activity feed, impact score with dimension breakdown, "next best
   action" card (e.g. "You merged 12 PRs this month — capture it in your appraisal").
7. Accessibility spec: focus order, keyboard shortcuts, ARIA for charts (data tables / summaries),
   contrast ratios, reduced motion.

### D. Prototype & validation
8. Build a clickable, static HTML prototype (single page app with hash routing or several pages)
   using the tokens and realistic seeded-style data, covering at least: onboarding, dashboard,
   KPIs, career, documents studio (with a simulated streaming generation), settings — light and
   dark, desktop and mobile. Save source in `design/prototype/` and publish it as a private
   Artifact for the owner (follow `artifact-design`). Put the link in PROGRESS.md.
9. Run a heuristic self-review of the prototype (Nielsen + WCAG 2.2 AA checklist) and fix issues.
10. Ask the user for feedback on the prototype (AskUserQuestion: approve / change list). Apply
    requested changes, re-publish, record approval in DECISIONS.md.

## Deliverables
```
docs/v2/design/IA.md
docs/v2/design/FLOWS.md
docs/v2/design/DESIGN_SYSTEM.md
docs/v2/design/tokens.css
docs/v2/design/SCREENS.md
docs/v2/design/prototype/*   (+ Artifact link in PROGRESS.md)
```

## Acceptance criteria
- [ ] Every screen in the PRD has a SCREENS.md entry with all five states and both breakpoints.
- [ ] Every screen's data maps to an endpoint in API_CONTRACT_V2 (gaps added as amendments to the contract + PROGRESS note).
- [ ] Token palette passes WCAG AA contrast for text and UI in both themes (list the checked pairs).
- [ ] Prototype covers onboarding → dashboard → generate document → export, in light/dark, desktop/mobile.
- [ ] Owner approval (or approved change list) recorded in DECISIONS.md.
- [ ] Only files under `docs/v2/` changed.

## Human review checklist
Click through the prototype on desktop and phone. This is the cheapest moment to change the UX.

## Handoff
List which shadcn components P09 must install, any custom components needed, and the token file path.

---

## Blueprint amendments (P03, 2026-11-09)
Appended by Phase 03; these take precedence over conflicting text above.

1. **Brand direction (D-017):** calm, professional, Linear-like — neutral surfaces, one restrained
   accent, crisp type, dense-but-airy data views, subtle motion. Avoid gamified/celebratory patterns.
2. **Scope (D-014, D-018):** no manager/team screens; no billing UI (Plan & usage shows plan, AI
   usage vs quota and "contact us to upgrade"); integrations page shows **GitHub only** as live,
   GitLab/Jira/Linear as "Planned" cards **without** connect buttons.
3. **Onboarding (ADR-0004):** step "Connect GitHub data" = install the GitHub App (repo choice on
   GitHub) + authorise; design the **org approval pending** state (`setupAction=request`), the
   "Review repositories" include/exclude step, and first-sync progress by stage with the
   newest-30-days-first behaviour ("your dashboard is ready; older history is still loading").
4. **Additional screens/states:** Impact detail (`/kpis/impact`) with dimension drill-down, inputs
   table and explanation (KPI_METHODOLOGY §6.7); integration states `needs_reauth`, `suspended`,
   `waiting_rate_limit` (sync shows "paused until HH:MM"); document flags (`uncited`,
   `invalid_citation`); quota exceeded (402) and rate limited (429).
5. **KPI copy:** metric names, units, definitions, caveats and score band labels come from
   `blueprint/KPI_METHODOLOGY.md` (five KPI sections: Delivery, Quality, Collaboration, Ownership,
   Consistency; dashboard cards: Commits, PRs merged, PRs reviewed, Impact score).
6. **URL & period:** global period uses the grammar in API_CONTRACT_V2 §3.4 in the URL
   (`?period=month:2026-10`); period types month, quarter, half, year, custom.
7. Provisional routes are listed in `blueprint/TRACEABILITY.md`; if IA.md changes them, update that file.
