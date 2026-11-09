# UI Test Results — v0.1.0 (Phase 01 audit)

Every page exercised with Playwright (pre-installed Chromium) on 2026-11-09 against
`next dev` (Next 14.2.3) + the API, in three states × two widths:

| State | How it was produced |
|---|---|
| **seeded** | `seed-fixture.ts` data; browser "logged in" as Alice by writing her ID to `localStorage.devimpact_user_id` (that is all v0.1.0 requires — SEC-01) |
| **empty** | All tables truncated; fresh browser contexts with no storage → the app auto-calls `dev-login` |
| **apidown** | API process stopped |

Widths: **1440×900** (desktop) and **390×844** (phone), `deviceScaleFactor: 1`.
Script: [`scripts/ui-audit.cjs`](scripts/ui-audit.cjs). Raw results (console errors, API calls,
visible buttons, unlabeled inputs, overflow, text sample): `logs/ui-seeded.json`,
`logs/ui-empty.json`, `logs/ui-apidown.json`, `logs/ui-interactions.json`.
Screenshots: [`screenshots/`](screenshots/) — `<state>-<width>-<page>.png` (72) +
`interaction-*.png` (5). Before each screenshot the script expands the fixed-height shell
(`h-screen` + scrolling `<main>`) so full-page captures show all content.

> Note on the AI-backed screens: generation ran against the local mock Anthropic server, which
> always answers with the same plausible JSON. The **72/100** impact score on the empty dashboard is
> the mock's answer — but the behaviour it shows is real: the page *automatically* requested an
> LLM-generated score for a month with zero activity and stored it (AI-01).

## Key findings

1. **No mobile navigation (UX-01, 🔴).** At 390 px the sidebar is hidden and nothing replaces it
   — `navVisible = false` on all 36 mobile captures. A phone user cannot leave the page they land on.
2. **Resume generation shows nothing (BUG-14, 🔴).** With a valid AI response the page renders one
   blank bullet card ([interaction-1440-resume-generated.png](screenshots/interaction-1440-resume-generated.png)).
3. **Shared anonymous account (SEC-02, 🔴).** In the empty run, all 24 fresh browser sessions were
   signed into the same `dev@devimpact.ai` "Dev User" account.
4. **Dead buttons (UX-03).** Interaction pass: "Copy All", "Export PDF", "Export Document",
   "Save Changes" and both "Enable" buttons trigger no request, DOM change, clipboard write or download.
5. **Raw JSON documents (UX-04).** Appraisal and promotion results are a `<pre>` JSON dump
   ([appraisal](screenshots/interaction-1440-appraisal-generated.png),
   [promotion](screenshots/interaction-1440-promotion-generated.png)).
6. **Errors masquerade as empty data (UX-05).** With the API down every page renders normally with
   zeros and "No activity data yet" / "No timeline data yet" — no error, no retry
   ([apidown-1440-dashboard.png](screenshots/apidown-1440-dashboard.png)). The only signals are
   `ERR_CONNECTION_REFUSED` console errors (2 per page).
7. **Contradictory dashboard (AI-01).** Empty account: "No activity data yet" directly above
   "Impact Score 72/100" with four 60–75 sub-scores
   ([empty-1440-dashboard.png](screenshots/empty-1440-dashboard.png)).
8. **Failed sync shown as success (BUG-08).** After a sync that failed with "Bad credentials", the
   GitHub card shows a green **Synced** badge and "Last sync: 7:00:08 AM"
   ([interaction-1440-connect-after-failed-sync.png](screenshots/interaction-1440-connect-after-failed-sync.png)).
9. **OAuth code posted 3× (BUG-02).** `/connect/callback?code=…` fires
   `POST /integrations/github/callback` three times; GitHub codes are single-use.
10. **Career timeline is mostly noise (DATA-01, UX-10).** In the seeded run 16 of 24 visible
    timeline items are reviewed-PR stubs ("PR #5064 · closed") with commit-count tags glued onto them
    ([seeded-1440-career.png](screenshots/seeded-1440-career.png)).
11. **Clipped mobile actions (UX-02).** Dashboard header buttons overflow `<main>` by 163 px at
    390 px; "Generate Appraisal" is cut off and unreachable
    ([seeded-390-dashboard.png](screenshots/seeded-390-dashboard.png)).
12. **Duplicate requests (BUG-11).** Dashboard and KPIs make 6 API calls where 3 are needed
    (`auth/me`, `summary`, `impact-score` each twice).
13. **Accessibility basics missing (UX-08).** No form input on any page has a programmatic label
    (resume 3/3, appraisal 3/3, promotion 2/2, settings 2/2 unlabeled); `<html lang="en">` is set.

No page threw an uncaught JavaScript error in any state. The only console errors were the expected
404 for the not-found route and connection-refused errors when the API was down.

## Interaction pass (seeded, 1440 px)

From `logs/ui-interactions.json`. "Effect" = any API request, DOM change, clipboard change,
navigation or download within 1.5–6 s of the click.

| Action | API requests | Effect | Verdict |
|---|---|---|---|
| Resume → Generate Resume Bullets | `POST /generate/resume` | DOM changed — but renders one empty card | ❌ BUG-14 |
| Resume → Copy All | — | none (clipboard unchanged) | ❌ UX-03 |
| Resume → Export PDF | — | none (no download) | ❌ UX-03 |
| Appraisal → Generate Appraisal | `POST /generate/appraisal` | raw JSON preview | ⚠️ UX-04 |
| Appraisal → Export Document | — | none | ❌ UX-03 |
| Promotion → Generate Promotion Packet | `POST /generate/promotion` | raw JSON preview | ⚠️ UX-04 |
| Settings → Save Changes | — | none | ❌ UX-03 / GAP-07 |
| Settings → Enable (Weekly Summary) | — | none | ❌ UX-03 / GAP-07 |
| Integrations → Sync | `POST /sync/trigger`, `GET /sync/status` | spinner, then green "Synced" although the job failed | ❌ BUG-08 |
| Dashboard → Generate Resume | — | navigates to `/resume` | ✅ |

## Page-by-page notes

| Page | Data fetched | What renders (seeded) | Empty state | API down | Notes |
|---|---|---|---|---|---|
| `/` | — | Server redirect to `/dashboard` | same | same | ✅ |
| `/dashboard` | `auth/me`, `activity/summary` (this month), `generate/impact-score` (this month) | 4 stat cards, impact donut, top repos | "No activity data yet" card + **LLM score for an empty month** | zeros, "—" score, empty-state CTA | "PRs Merged" = all PRs (DATA-02); no 30-day chart / feed (GAP-02); "1 commits" (BUG-13); mobile header clipped (UX-02) |
| `/connect` | `integrations`, `sync/status` | GitHub card connected (`@alice`), Sync/Disconnect; 3 "Coming Soon" | GitHub "Connect"; others "Idle"+"Coming Soon" (UX-13) | spinner never shown, cards show not connected | Disconnect has no confirmation and deletes all data (DATA-07); `alert()` on error (UX-05) |
| `/connect/callback` | `POST integrations/github/callback` ×3 | "No authorization code received" / "Failed to exchange GitHub code for token" | same | "Network error" | BUG-02; page breaks `next build` (BUG-01) |
| `/resume` | none on load | Date inputs, role select, generate | same | generate → "Network error" | BUG-14, UX-03, unlabeled inputs, no progress during generation |
| `/appraisal` | none on load | Period/month/year, generate | same | same | Year is a free number input (2020–2030); raw JSON output; dead export |
| `/promotion` | none on load | Two free-text role inputs, generate | same | same | Raw JSON output; no export |
| `/career` | `activity/commits` + `activity/prs` (6 months, limit 200 each) | Quarter groups, max 8 items each, dominated by stub PRs | "No timeline data yet" + Connect CTA | same empty state (misleading) | No year filter (GAP-03); silent truncation at 200 (PERF-03) |
| `/kpis` | `activity/summary`, `generate/impact-score` | 4 mislabeled cards, impact donut, top repos table | zeros + LLM score | zeros | No trend charts (GAP-03); labels don't match metrics (UX-06) |
| `/settings` | none (auth context) | Profile (name/email), plan cards, notification toggles | "Dev User"/`dev@devimpact.ai` | empty inputs | All actions dead; no connected-integrations section (GAP-07) |
| `/does-not-exist` | — | Next default 404 inside the shell | same | same | Unbranded 404 |

## Heuristic evaluation (Nielsen's 10)

Severity 0–4 (4 = prevents task completion). Context: a single engineer, first visits and
occasional (weekly/monthly) use — a *transient* posture product that must be self-explanatory.

| Heuristic | Sev | Observations (evidence) |
|---|---|---|
| H1 Visibility of system status | **4** | Failed sync shown as "Synced"; API outage looks like "no data"; 10–30 s generations show only a button spinner; impact score shown with no indication it is AI-made or for which month; sync progress never reaches 100 % |
| H2 Match with the real world | 3 | "Code Quality" = PR count, "Ownership" = repo count, "PRs Merged" = all PRs; stub PRs titled "PR #5064"; raw JSON field names (`executiveSummary`) as document UI |
| H3 User control and freedom | **4** | No navigation on mobile; Disconnect deletes all synced data instantly with no confirm/undo; generated documents vanish on navigation |
| H4 Consistency and standards | 2 | Badges/colours hard-coded per component; "Idle" badge for unconnected providers; disabled "Coming Soon" styled as primary buttons; two different empty-state wordings |
| H5 Error prevention | 3 | Free-text roles and free-number year; no validation before paid generation; invalid ranges accepted (from > to); destructive actions unguarded |
| H6 Recognition rather than recall | 2 | No document history to revisit; date range/role not remembered; no indication which data range a KPI covers |
| H7 Flexibility and efficiency | 2 | No shortcuts, no presets (e.g. "last quarter"), no regenerate-section, no copy per bullet |
| H8 Aesthetic and minimalist design | 2 | Clean shadcn baseline, but career timeline floods with low-value stub items; dashboard shows zero-filled cards next to the empty state |
| H9 Recognise, diagnose, recover from errors | **4** | Raw upstream errors (`401 {"type":"error",...}`), `alert()`, "Network error"; empty state shown instead of error; no retry actions |
| H10 Help and documentation | 3 | No onboarding, no "how is this calculated", no explanation of what is synced or how the score works (fairness principle) |

**UX-law notes.** Fitts's law: primary action clipped off-screen on mobile. Doherty threshold:
generation takes 10–30 s with no progressive output. Goal-gradient: no onboarding progress
(connect → sync → generate). Jakob's law: no hamburger/drawer on small screens. Peak-end: the
end of the core flow (a resume) is a blank card or a JSON dump.

## Top 10 UX problems (prioritised)

| # | Problem | Heuristic / law | Evidence | Recommendation | Issue |
|---|---|---|---|---|---|
| 1 | No navigation below 1024 px | H3, Jakob's law | all `*-390-*.png` | Responsive shell with drawer + bottom nav | UX-01 |
| 2 | Resume result renders an empty card | H1, peak-end | `interaction-1440-resume-generated.png` | Typed response + rich bullet list with per-bullet copy/edit | BUG-14 |
| 3 | Generated documents are raw JSON and can't be exported/copied | H2, H8 | `interaction-1440-appraisal-generated.png` | Document studio with formatted, editable sections and exports | UX-04, UX-03, GAP-04 |
| 4 | Errors look like empty data; raw/`alert()` errors | H1, H9 | `apidown-*-*.png` | Distinct error states with retry; friendly messages; toasts | UX-05 |
| 5 | Failed sync shown as "Synced" | H1 | `interaction-1440-connect-after-failed-sync.png` | Real sync status, history, errors and progress | BUG-08 |
| 6 | Impact score contradicts the data ("No activity" + 72/100) and isn't explained | H1, H2, H10 | `empty-1440-dashboard.png` | Deterministic score with "how is this calculated", hide when no data | AI-01, UX-06 |
| 7 | Dead buttons in resume, appraisal and settings | H4, H1 | interaction pass | Implement or remove until implemented | UX-03 |
| 8 | Career timeline flooded with stub "PR #n" items | H2, H8 | `seeded-1440-career.png` | Timeline from authored work/achievements; filters | DATA-01, UX-10 |
| 9 | Mobile header actions clipped; primary action unreachable | Fitts's law | `seeded-390-dashboard.png` | Wrap/stack header actions; sticky primary CTA | UX-02 |
| 10 | No onboarding or progress through connect → sync → generate; destructive Disconnect unguarded | H10, H3, goal-gradient | `empty-1440-*.png`, `/connect` | First-run checklist; confirm + explain data deletion | UX-09, DATA-07 |

## Per-run results

### Seeded DB (logged in as Alice via localStorage)

| Page | Width | HTTP | Load ms | Nav visible | Overflow px (doc/main) | Console/page errors | API calls | Screenshot |
|---|---|---|---|---|---|---|---|---|
| `/` | 1440 | 200 | 1738 | yes | 0/0 | 0 | 6 | [png](screenshots/seeded-1440-root.png) |
| `/dashboard` | 1440 | 200 | 1743 | yes | 0/0 | 0 | 6 | [png](screenshots/seeded-1440-dashboard.png) |
| `/connect` | 1440 | 200 | 1727 | yes | 0/0 | 0 | 6 | [png](screenshots/seeded-1440-connect.png) |
| `/connect/callback` | 1440 | 200 | 1723 | yes | 0/0 | 0 | 2 | [png](screenshots/seeded-1440-connect-callback.png) |
| `/connect/callback?code=bogus` | 1440 | 200 | 1936 | yes | 0/0 | 0 | 5 | [png](screenshots/seeded-1440-connect-callback-code.png) |
| `/resume` | 1440 | 200 | 1683 | yes | 0/0 | 0 | 2 | [png](screenshots/seeded-1440-resume.png) |
| `/appraisal` | 1440 | 200 | 1716 | yes | 0/0 | 0 | 2 | [png](screenshots/seeded-1440-appraisal.png) |
| `/promotion` | 1440 | 200 | 1682 | yes | 0/0 | 0 | 2 | [png](screenshots/seeded-1440-promotion.png) |
| `/career` | 1440 | 200 | 1687 | yes | 0/0 | 0 | 6 | [png](screenshots/seeded-1440-career.png) |
| `/kpis` | 1440 | 200 | 1688 | yes | 0/0 | 0 | 6 | [png](screenshots/seeded-1440-kpis.png) |
| `/settings` | 1440 | 200 | 1701 | yes | 0/0 | 0 | 2 | [png](screenshots/seeded-1440-settings.png) |
| `/does-not-exist` | 1440 | 404 | 1684 | yes | 0/0 | 1 | 2 | [png](screenshots/seeded-1440-not-found.png) |
| `/` | 390 | 200 | 1707 | **no** | 0/163 | 0 | 6 | [png](screenshots/seeded-390-root.png) |
| `/dashboard` | 390 | 200 | 1697 | **no** | 0/163 | 0 | 6 | [png](screenshots/seeded-390-dashboard.png) |
| `/connect` | 390 | 200 | 1674 | **no** | 0/0 | 0 | 6 | [png](screenshots/seeded-390-connect.png) |
| `/connect/callback` | 390 | 200 | 1660 | **no** | 0/0 | 0 | 2 | [png](screenshots/seeded-390-connect-callback.png) |
| `/connect/callback?code=bogus` | 390 | 200 | 1853 | **no** | 0/0 | 0 | 5 | [png](screenshots/seeded-390-connect-callback-code.png) |
| `/resume` | 390 | 200 | 1668 | **no** | 0/0 | 0 | 2 | [png](screenshots/seeded-390-resume.png) |
| `/appraisal` | 390 | 200 | 1658 | **no** | 0/0 | 0 | 2 | [png](screenshots/seeded-390-appraisal.png) |
| `/promotion` | 390 | 200 | 1680 | **no** | 0/0 | 0 | 2 | [png](screenshots/seeded-390-promotion.png) |
| `/career` | 390 | 200 | 1690 | **no** | 0/0 | 0 | 6 | [png](screenshots/seeded-390-career.png) |
| `/kpis` | 390 | 200 | 1666 | **no** | 0/0 | 0 | 6 | [png](screenshots/seeded-390-kpis.png) |
| `/settings` | 390 | 200 | 1693 | **no** | 0/0 | 0 | 2 | [png](screenshots/seeded-390-settings.png) |
| `/does-not-exist` | 390 | 404 | 1703 | **no** | 0/0 | 1 | 2 | [png](screenshots/seeded-390-not-found.png) |

### Empty DB (fresh browser → auto dev-login)

| Page | Width | HTTP | Load ms | Nav visible | Overflow px (doc/main) | Console/page errors | API calls | Screenshot |
|---|---|---|---|---|---|---|---|---|
| `/` | 1440 | 200 | 1726 | yes | 0/0 | 0 | 4 | [png](screenshots/empty-1440-root.png) |
| `/dashboard` | 1440 | 200 | 1711 | yes | 0/0 | 0 | 6 | [png](screenshots/empty-1440-dashboard.png) |
| `/connect` | 1440 | 200 | 1777 | yes | 0/0 | 0 | 6 | [png](screenshots/empty-1440-connect.png) |
| `/connect/callback` | 1440 | 200 | 1651 | yes | 0/0 | 0 | 2 | [png](screenshots/empty-1440-connect-callback.png) |
| `/connect/callback?code=bogus` | 1440 | 200 | 1804 | yes | 0/0 | 0 | 5 | [png](screenshots/empty-1440-connect-callback-code.png) |
| `/resume` | 1440 | 200 | 1684 | yes | 0/0 | 0 | 2 | [png](screenshots/empty-1440-resume.png) |
| `/appraisal` | 1440 | 200 | 1698 | yes | 0/0 | 0 | 2 | [png](screenshots/empty-1440-appraisal.png) |
| `/promotion` | 1440 | 200 | 1656 | yes | 0/0 | 0 | 2 | [png](screenshots/empty-1440-promotion.png) |
| `/career` | 1440 | 200 | 1695 | yes | 0/0 | 0 | 4 | [png](screenshots/empty-1440-career.png) |
| `/kpis` | 1440 | 200 | 1725 | yes | 0/0 | 0 | 6 | [png](screenshots/empty-1440-kpis.png) |
| `/settings` | 1440 | 200 | 1682 | yes | 0/0 | 0 | 2 | [png](screenshots/empty-1440-settings.png) |
| `/does-not-exist` | 1440 | 404 | 1654 | yes | 0/0 | 1 | 2 | [png](screenshots/empty-1440-not-found.png) |
| `/` | 390 | 200 | 1746 | **no** | 0/163 | 0 | 4 | [png](screenshots/empty-390-root.png) |
| `/dashboard` | 390 | 200 | 1720 | **no** | 0/163 | 0 | 6 | [png](screenshots/empty-390-dashboard.png) |
| `/connect` | 390 | 200 | 1752 | **no** | 0/0 | 0 | 6 | [png](screenshots/empty-390-connect.png) |
| `/connect/callback` | 390 | 200 | 1710 | **no** | 0/0 | 0 | 2 | [png](screenshots/empty-390-connect-callback.png) |
| `/connect/callback?code=bogus` | 390 | 200 | 1739 | **no** | 0/0 | 0 | 5 | [png](screenshots/empty-390-connect-callback-code.png) |
| `/resume` | 390 | 200 | 1653 | **no** | 0/0 | 0 | 2 | [png](screenshots/empty-390-resume.png) |
| `/appraisal` | 390 | 200 | 1674 | **no** | 0/0 | 0 | 2 | [png](screenshots/empty-390-appraisal.png) |
| `/promotion` | 390 | 200 | 1652 | **no** | 0/0 | 0 | 2 | [png](screenshots/empty-390-promotion.png) |
| `/career` | 390 | 200 | 1715 | **no** | 0/0 | 0 | 4 | [png](screenshots/empty-390-career.png) |
| `/kpis` | 390 | 200 | 1700 | **no** | 0/0 | 0 | 6 | [png](screenshots/empty-390-kpis.png) |
| `/settings` | 390 | 200 | 1675 | **no** | 0/0 | 0 | 2 | [png](screenshots/empty-390-settings.png) |
| `/does-not-exist` | 390 | 404 | 1662 | **no** | 0/0 | 1 | 2 | [png](screenshots/empty-390-not-found.png) |

### API down

| Page | Width | HTTP | Load ms | Nav visible | Overflow px (doc/main) | Console/page errors | API calls | Screenshot |
|---|---|---|---|---|---|---|---|---|
| `/` | 1440 | 200 | 1736 | yes | 0/0 | 2 | 0 | [png](screenshots/apidown-1440-root.png) |
| `/dashboard` | 1440 | 200 | 1706 | yes | 0/0 | 2 | 0 | [png](screenshots/apidown-1440-dashboard.png) |
| `/connect` | 1440 | 200 | 1669 | yes | 0/0 | 2 | 0 | [png](screenshots/apidown-1440-connect.png) |
| `/connect/callback` | 1440 | 200 | 1723 | yes | 0/0 | 2 | 0 | [png](screenshots/apidown-1440-connect-callback.png) |
| `/connect/callback?code=bogus` | 1440 | 200 | 1672 | yes | 0/0 | 4 | 0 | [png](screenshots/apidown-1440-connect-callback-code.png) |
| `/resume` | 1440 | 200 | 1665 | yes | 0/0 | 2 | 0 | [png](screenshots/apidown-1440-resume.png) |
| `/appraisal` | 1440 | 200 | 1657 | yes | 0/0 | 2 | 0 | [png](screenshots/apidown-1440-appraisal.png) |
| `/promotion` | 1440 | 200 | 1678 | yes | 0/0 | 2 | 0 | [png](screenshots/apidown-1440-promotion.png) |
| `/career` | 1440 | 200 | 1677 | yes | 0/0 | 2 | 0 | [png](screenshots/apidown-1440-career.png) |
| `/kpis` | 1440 | 200 | 1731 | yes | 0/0 | 2 | 0 | [png](screenshots/apidown-1440-kpis.png) |
| `/settings` | 1440 | 200 | 1695 | yes | 0/0 | 2 | 0 | [png](screenshots/apidown-1440-settings.png) |
| `/does-not-exist` | 1440 | 404 | 1653 | yes | 0/0 | 3 | 0 | [png](screenshots/apidown-1440-not-found.png) |
| `/` | 390 | 200 | 1696 | **no** | 0/163 | 2 | 0 | [png](screenshots/apidown-390-root.png) |
| `/dashboard` | 390 | 200 | 1727 | **no** | 0/163 | 2 | 0 | [png](screenshots/apidown-390-dashboard.png) |
| `/connect` | 390 | 200 | 1667 | **no** | 0/0 | 2 | 0 | [png](screenshots/apidown-390-connect.png) |
| `/connect/callback` | 390 | 200 | 1680 | **no** | 0/0 | 2 | 0 | [png](screenshots/apidown-390-connect-callback.png) |
| `/connect/callback?code=bogus` | 390 | 200 | 1667 | **no** | 0/0 | 4 | 0 | [png](screenshots/apidown-390-connect-callback-code.png) |
| `/resume` | 390 | 200 | 1670 | **no** | 0/0 | 2 | 0 | [png](screenshots/apidown-390-resume.png) |
| `/appraisal` | 390 | 200 | 1680 | **no** | 0/0 | 2 | 0 | [png](screenshots/apidown-390-appraisal.png) |
| `/promotion` | 390 | 200 | 1665 | **no** | 0/0 | 2 | 0 | [png](screenshots/apidown-390-promotion.png) |
| `/career` | 390 | 200 | 1727 | **no** | 0/0 | 2 | 0 | [png](screenshots/apidown-390-career.png) |
| `/kpis` | 390 | 200 | 1692 | **no** | 0/0 | 2 | 0 | [png](screenshots/apidown-390-kpis.png) |
| `/settings` | 390 | 200 | 1677 | **no** | 0/0 | 2 | 0 | [png](screenshots/apidown-390-settings.png) |
| `/does-not-exist` | 390 | 404 | 1675 | **no** | 0/0 | 3 | 0 | [png](screenshots/apidown-390-not-found.png) |

