# Prototype Self-Review — Nielsen heuristics + WCAG 2.2 AA

*Phase 04 · 2026-11-09 · Task 9.* Reviewed the [prototype](prototype/) (Artifact link in
[`../PROGRESS.md`](../PROGRESS.md)) at 1440 × 900 and 390 × 844, light and dark, in every scenario of
its Prototype menu. Severity 0–4 (4 = blocks the task). Context: a transient-posture tool used
weekly/monthly by an individual engineer, plus occasional long sessions in the document studio.

## 1. How it was checked

| Check | Method | Result |
|---|---|---|
| Automated a11y | axe-core 4.10.2, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`, 18 routes × light/dark × 1440/390 (72 runs) | 2 rules failed on first run (below) → fixed → **0 violations** |
| Layout / reflow | Playwright, 25 routes × 1440 light / 390 dark, `scrollWidth − innerWidth` | **0 px** horizontal overflow everywhere |
| Runtime | Console + page errors across all routes and 9 scripted flows | **0 errors** |
| Interaction | Scripted flows: generate appraisal → stream → done → export menu → citation popover; KPI explain drawer focus; ⌘K search + Enter; period change; scenario switches; onboarding import; delete-account typed confirmation | All pass |
| Contrast | `scripts/check-contrast.mjs` on tokens | 39/39 pairs pass in both themes |
| Chart palettes | dataviz `validate_palette.js` (categorical all-pairs, ordinal heat ramp) | All pass |
| Logic | Prototype metrics engine vs KPI_METHODOLOGY golden test G-1 | 78.2050 → 78, dimensions 72.6105 / 80.0278 / 82.3832 / 78.0000 ✅ |
| Visual | Screenshots of dashboard, KPIs, document (static + streaming), career, mobile dashboard/nav | Issues below |

## 2. Findings and fixes

| # | Heuristic / criterion | Sev | Finding | Fix (applied in the prototype and specs) |
|---|---|---|---|---|
| R1 | WCAG 4.1.2 (axe `aria-tooltip-name`) | 3 | Global chart tooltip node had `role="tooltip"` with no name when empty | Tooltip is `aria-hidden` (mouse convenience); data is in the "View as table" toggle — DESIGN_SYSTEM §10 |
| R2 | WCAG 2.1.1 (axe `scrollable-region-focusable`) | 3 | Heatmap scrolls horizontally on mobile but was not focusable | Container is focusable (`tabindex="0"`) with an `aria-label` summary |
| R3 | WCAG 2.1.4 Character key shortcuts (A) | 3 | `G`/`A`/`?` single-key shortcuts could not be turned off | Toggle in the shortcut list; shortcuts ignored while typing — IA §5 |
| R4 | WCAG 2.5.8 Target size (AA) | 2 | Standalone evidence chips were 18 px tall; switches 34 × 20; info buttons 24 px | Chips ≥ 24 px outside prose (inline exception inside sentences), switches 40 × 24, info buttons 28 px |
| R5 | WCAG 3.3.1 / 4.1.3 | 2 | Promotion "Target role" error text not programmatically linked | `aria-describedby` on the field; pattern documented for all forms |
| R6 | WCAG 2.4.11 Focus not obscured | 2 | Anchor jumps (KPI section tabs) could land under the sticky top bar | `scroll-padding-top: topbar + 12px` |
| R7 | H2 Match with the real world | 2 | Mobile period button read "Nov 26" — looks like a date | Always a four-digit year ("Nov 2026") — IA §4 |
| R8 | H8 Aesthetic & minimalist / data-ink | 2 | Full refs (`PR-harbor-io/web-checkout#2342`) inside document prose wrapped onto their own lines and dominated the text | Short chip label (`web-checkout #2342`, `Review · …`, `Achievement`); full ref in `aria-label`, popover and Evidence panel |
| R9 | Dataviz — scale honesty | 2 | Activity y-axis ticks rounded to 0 / 3 / 5 (mid tick not a clean value) | `niceMax` rounds small maxima to even numbers so the mid tick is an integer |
| R10 | H1 Visibility of system status | 2 | Impact card showed "—" for Quality with no reason | Note under the bars: "Quality isn't scored yet — not enough merged PRs in this period. The other dimensions were re-weighted." |
| R11 | H1 / Doherty threshold | 2 | Streaming showed empty list bullets and empty chips ahead of text | Partial HTML is cut at the visible-character boundary, so only written text and closed tags render |
| R12 | Fitts / H8 (mobile) | 1 | Stat-card deltas wrapped to three lines at 390 px | Mobile shows arrow + amount; one caption "Changes are vs same point last month" under the tiles |
| R13 | Layout | 1 | Activity card left a large empty area beside the taller impact card | Chart height 268 px so the row balances |
| R14 | H6 Recognition (mobile) | 1 | Heatmap opened on the oldest months at 390 px | Starts scrolled to the newest week |
| R15 | Prototype only | 1 | Prototype menu button overlapped the sidebar account button | Moved to bottom-right, toasts stacked above it |

## 3. Heuristic summary after fixes

| Heuristic | Score (0 = no issue) | Evidence in the design |
|---|---|---|
| H1 Visibility of system status | 0 | Sync chip + banners for every integration state; staged first-sync progress with recent-first handoff; streaming status names the section; autosave "Saved · v4"; deltas name their comparison |
| H2 Match with the real world | 0 | Metric names/definitions from KPI_METHODOLOGY; business hours stated; "signal, not a judgement" framing; dates spelled out |
| H3 User control and freedom | 0 | Stop generation (no quota used); Undo on deletes; Disconnect keep/purge; versions + Restore; "Not now" on Next step; Finish later in onboarding |
| H4 Consistency and standards | 0 | One component per purpose; same action names through flows (Generate → "ready"); tokens only |
| H5 Error prevention | 0 | Custom range validation; Generate disabled with reason when no evidence or quota; typed confirmation for account deletion; regenerate confirms and keeps history |
| H6 Recognition rather than recall | 0 | Period always visible in the top bar; options remembered in studio; evidence preview before generating |
| H7 Flexibility and efficiency | 0 | ⌘K, `G` shortcuts, presets, deep links (`?period=`, `?metric=`), per-section regenerate |
| H8 Aesthetic and minimalist design | 0 | Hairline layout, one accent, career timeline without stub noise, sparing labels |
| H9 Recognise, diagnose, recover | 0 | Every error says what happened + what to do (+ request ID); no raw upstream JSON; API outage never shows as "no data" |
| H10 Help and documentation | 0 | Explain drawer on every metric and score component; caveats and anti-gaming notes; shortcut list |

## 4. Known limitations of the prototype (not of the design)

- Synthetic data in UTC; the app computes in the user's time zone.
- Downloads, printing, OAuth redirects and emails are simulated with toasts (the Artifact sandbox
  blocks downloads and popups).
- The live region re-renders during streaming; the spec (DESIGN_SYSTEM §10) requires one
  announcement per section, which P11 must implement.
- Hash routes (`#account-integrations`) stand in for `/settings/*` paths (IA §8).
