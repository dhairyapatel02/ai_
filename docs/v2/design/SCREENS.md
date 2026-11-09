# Screen Specifications — DevImpact AI v2.0

*Phase 04 · 2026-11-09 · Status: **binding** for P09–P12 after owner approval (D-020).*
Every screen below lists purpose, primary action, layout, components ([DESIGN_SYSTEM §5](DESIGN_SYSTEM.md#5-component-inventory--shadcnui)),
data (endpoints from [API_CONTRACT_V2](../blueprint/API_CONTRACT_V2.md); `A-n` = P04 amendment in its
§22), and **five states**: Loading · Empty (no integration / syncing / no data in range) · Partial ·
Error · Success — plus desktop (1440) and mobile (390) notes. Shared state patterns are defined once
in [DESIGN_SYSTEM §9](DESIGN_SYSTEM.md#9-state-patterns-applies-to-every-screen--see-screensmd-per-screen);
the tables here say what is specific to each screen. The [prototype](prototype/) implements every
screen marked ▶ (switch states with its dashed **Prototype** menu).

## Index

| # | Screen | Route | PRD | Prototype |
|---|---|---|---|---|
| S1 | Sign-in | `/sign-in` | F-01, F-02 | ▶ `#sign-in` |
| S2 | Onboarding · Connect GitHub data | `/onboarding/connect` | F-10, F-74 | ▶ |
| S3 | Onboarding · Approval pending | `/onboarding/pending` | F-10 | ▶ |
| S4 | Onboarding · Review repositories | `/onboarding/repositories` | F-11 | ▶ |
| S5 | Onboarding · First sync | `/onboarding/sync` | F-12, F-15 | ▶ |
| S6 | Dashboard | `/dashboard` | F-20–F-24, F-28 | ▶ |
| S7 | Activity explorer (+ item drawer) | `/activity` | F-23, F-25, F-51 | ▶ |
| S8 | KPIs (+ explain drawer) | `/kpis` | F-26, F-27 | ▶ |
| S9 | Impact score detail | `/kpis/impact` | F-28, F-29 | ▶ |
| S10 | Career timeline (+ print view) | `/career`, `/career/print` | F-30 | ▶ |
| S11 | Documents library | `/documents` | F-48 | ▶ |
| S12 | New document (type picker) | `/documents/new` | F-40–F-42 | ▶ |
| S13 | Resume studio | `/documents/new/resume` | F-40, F-43 | ▶ |
| S14 | Appraisal studio | `/documents/new/appraisal` | F-41, F-43 | ▶ |
| S15 | Promotion studio | `/documents/new/promotion` | F-42, F-43 | ▶ |
| S16 | Document viewer / editor | `/documents/:id` | F-44–F-47, F-49 | ▶ |
| S17 | Achievements | `/achievements` | F-60, F-61 | ▶ |
| S18 | Goals | `/goals` | F-62 | ▶ |
| S19 | Settings · Integrations | `/settings/integrations` | F-10, F-11, F-13, F-15–F-17 | ▶ |
| S20 | Settings · Profile | `/settings/profile` | F-01, F-05 | ▶ |
| S21 | Settings · Notifications | `/settings/notifications` | F-63, F-65 | ▶ |
| S22 | Settings · Privacy & data | `/settings/privacy` | F-03, F-04, F-76, UJ-7 | ▶ |
| S23 | Settings · Plan & usage | `/settings/plan` | F-06, F-07 | ▶ |
| S24 | Unsubscribe (public) | `/unsubscribe` | F-63 | — |
| S25 | 404 / 500 | — | F-73 | ▶ |
| O1 | Command palette | overlay | F-72 | ▶ |
| O2 | Period picker | overlay | F-31 | ▶ |

Breakpoint shorthand: **D** = desktop 1440 (sidebar, multi-column), **M** = mobile 390 (top bar +
bottom bar, single column, sheets). Tablet (768–1023) = mobile navigation with desktop grids where they fit.

---

## S1 · Sign-in ▶
**Purpose** authenticate with GitHub or Google. **Primary action** Continue with GitHub.
```
            [■] DevImpact
            Sign in to DevImpact
            Your engineering work, measured fairly and written up for you —
            every claim backed by a PR.
            [  Continue with GitHub  ]   (primary, 40 px)
            [  Continue with Google  ]
            Signing in only reads your name and email. Connecting repository
            data is a separate, read-only step you control.
            ┌ Development only ─────────────────────────┐  (only if ENABLE_DEV_LOGIN)
            │ [Sign in as demo@devimpact.dev]            │
            └────────────────────────────────────────────┘
```
**Components** Button lg, Banner, Well. **Data** web `POST /api/auth/sign-in/social`, `POST /api/dev-login`.

| State | Behaviour |
|---|---|
| Loading | Clicked button shows spinner + "Opening GitHub…", other button disabled |
| Empty | n/a (no data) |
| Partial | n/a |
| Error | Danger banner above buttons: "We couldn't sign you in with GitHub. Try again, or continue with Google." Cancelled: neutral notice "Sign-in was cancelled." `returnTo` expired session: info "Your session ended. Sign in to continue." |
| Success | Redirect to `returnTo` / `/onboarding` / `/dashboard` (FLOWS F1) |

**D** centred 400 px card on canvas. **M** same, 16 px gutters, buttons full width.

## S2 · Onboarding · Connect GitHub data ▶
**Purpose** install the read-only GitHub App. **Primary** Install GitHub App.
```
 [■] DevImpact                                         [theme] Finish later
 ▬▬▬▬▬▬▬▬▬ Step 1 · Connect GitHub data  ───── Step 2 ─────  ───── Step 3 ─────
 Connect your GitHub data
 Install the DevImpact GitHub App on your account or organization…
 ┌───────────────────────────────────────────────────────────────┐
 │ What DevImpact can see                                         │
 │ (eye)   Read-only access — PRs, reviews, commits, metadata      │
 │ (repo)  Only repositories you pick                             │
 │ (sync)  Kept up to date — daily + webhooks                     │
 ├───────────────────────────────────────────────────────────────┤
 │ [Install GitHub App]                 My organization needs to approve apps │
 └───────────────────────────────────────────────────────────────┘
 Signed in as priya@harbor.dev · Times will be shown in Europe/London · change
```
**Data** `POST /integrations/github/connect { returnTo:'/onboarding' }` → redirect; return via
`/integrations/github/callback` → `POST /integrations/github/callback`; `PATCH /me/settings { timezone, onboardingStep:'connect' }`.

| State | Behaviour |
|---|---|
| Loading | Button → "Opening GitHub…" (disabled) until redirect |
| Empty | This *is* the no-integration state |
| Partial | Integration exists but only org pending → S3; integration exists → skip to S4 |
| Error | Cancelled on GitHub: danger banner "GitHub authorization was cancelled. Nothing was connected." · 400 state expired: "That link expired. Install the app again." · 409 account in use: "This GitHub account is already connected to another DevImpact account. Sign in with that account, or use a different GitHub account." · 403 entitlement: "Your plan includes 1 GitHub connection." · 502: "GitHub didn't respond. Try again in a minute." |
| Success | Callback 201 → S4 with toast "GitHub connected" |

**D** 720 px column. **M** stepper labels collapse to "Step 1 of 3 · Connect GitHub data"; footer link wraps below the button.

## S3 · Onboarding · Approval pending ▶
**Purpose** explain org approval (`setupAction=request`) and offer a way forward. **Primary** Continue with personal repositories.
Content: icon, "Waiting for harbor-io to approve DevImpact", explanation, copyable admin message
(Copy message), Check again, note "We'll email you when the organization approves the app".
**Data** callback `200 { pendingApproval: true }`; Check again → `GET /integrations`.

| State | Behaviour |
|---|---|
| Loading | Check again → button spinner |
| Empty | No personal repositories either → primary becomes "Install on my personal account" |
| Partial | Personal install active + org pending → primary continues to S4 with personal repos; org row shows "Pending approval" in S19 |
| Error | Copy blocked → toast "Copy was blocked. Select the text and copy it manually." |
| Success | Approved → toast "harbor-io approved DevImpact. Importing its repositories." and S4 lists them |

**D/M** single column; the admin message is a selectable well.

## S4 · Onboarding · Review repositories ▶
**Purpose** confirm which repositories count. **Primary** Start import.
```
 Review repositories
 Repositories with activity in the last 12 months are selected…
 ┌ 7 of 9 selected ───────────────────────── [Select recently active] ┐
 │ (on)  harbor-io/payments-api       Your last activity 5 h ago   🔒 Private │
 │ (on)  harbor-io/web-checkout       …                            🔒 Private │
 │ (off) harbor-io/legacy-admin       No activity from you in 12 months      │
 ├─────────────────────────────────────────────────────────────────────┤
 │ Missing a repository? Add it on GitHub         [Back] [Start import] │
 └─────────────────────────────────────────────────────────────────────┘
```
**Data** `GET /repos?integrationId=&sort=-lastActivityAt&limit=100` (+ cursor), `PATCH /repos { ids, included }`.
Search box appears when > 20 repositories.

| State | Behaviour |
|---|---|
| Loading | 6 skeleton rows; the backfill is already queued in the background |
| Empty | No accessible repos: "DevImpact can't see any repositories yet. Add repositories to the app on GitHub." + Manage on GitHub |
| Partial | Repo discovery still running: info line "Still discovering repositories in harbor-io…" rows stream in |
| Error | Inline panel error + Retry; Start import still allowed with defaults |
| Success | Start import → `PATCH` then S5 |

**D** 720 px list. **M** private badge hidden < 400 px (lock icon remains in the label's accessible name).

## S5 · Onboarding · First sync ▶
**Purpose** show live, legible progress and hand off to the dashboard early. **Primary** Go to dashboard (appears when the recent 30 days are ready).
```
 Importing your last 12 months
 This usually takes 1–3 minutes. You can leave this page — the import keeps running.
 ┌──────────────────────────────────────────────────────────┐
 │ Overall progress                                     64% │
 │ ████████████████████░░░░░░░░░                            │
 │ (✓) Repositories                    Found 5 …          5 │
 │ (✓) Your pull requests              Newest 30 days first 72 │
 │ (◌) Pull requests you reviewed                         131 │
 │ ( ) Commits                         Default branches only  │
 │ ( ) KPIs and impact score                                  │
 └──────────────────────────────────────────────────────────┘
 ┌ (✓) Your dashboard is ready ─ Your last 30 days are in. Older history is still loading. [Go to dashboard] ┐
```
**Data** `GET /sync/stream?runId=` (SSE `progress`, `done`, `error`) with polling fallback `GET /sync/status`;
`recentWindowCompletedAt` (A-4) triggers the ready banner; `PATCH /me/settings { onboardingStep:'sync' }`, on finish `onboardingCompletedAt`.

| State | Behaviour |
|---|---|
| Loading | Before the first progress event: stage 1 active, "Preparing…" |
| Empty | Run finishes with 0 items: "We didn't find any pull requests, reviews or commits by @priyar in the selected repositories." + Review repositories / Go to dashboard |
| Partial | Some repositories failed: amber line under the stage "1 repository couldn't be read (harbor-io/ledger-service)" + continue |
| Error | `waiting_rate_limit`: "Paused until 16:32 — GitHub's rate limit. It resumes automatically." · failed: danger banner with `errorMessage`, Retry, Contact support · SSE drop: silently fall back to polling |
| Success | 100 %: "Import complete" + counts; Go to dashboard |

Progress bar `role="progressbar"`; stage completions announced politely. **M** counts right-aligned, stage descriptions wrap.

---

## S6 · Dashboard ▶
**Purpose** answer "what did I do and how does it look?" for the period in one glance; route to the
next useful action. **Primary** the Next step card's action (default "Draft appraisal" in the header).
```
 Dashboard                                         [Add achievement] [✦ Draft appraisal]
 November 2026 · in progress · synced 12 min ago
 ┌Commits    ⓘ┐ ┌PRs merged ⓘ┐ ┌PRs reviewed ⓘ┐ ┌Impact score     ⓘ┐
 │ 4          │ │ 2          │ │ 5            │ │ 66 / 100 · Strong │
 │ ↘ 1 vs same point last month …                ↗ 3 pts            │
 └────────────┘ └────────────┘ └──────────────┘ └───────────────────┘
 ┌ Activity · November 2026 · by day ── View as table ┐ ┌ Impact score ─ Details ┐
 │ ■ Commits ■ PRs merged ■ Reviews                    │ │ 66 /100 [Strong]       │
 │ ▂ ▅ █ █ ▂ ▁ … stacked columns                       │ │ ▬▬▬▬▬|▬▬|■■|▬ bands    │
 │                                                     │ │ Delivery    ███▌   55  │
 └─────────────────────────────────────────────────────┘ │ Quality     —  (n/a)   │
                                                         │ Collaboration ████ 69  │
                                                         │ Ownership   █████  83  │
                                                         │ How is this calculated? │
                                                         └────────────────────────┘
 ┌ Contributions · Last 12 months · 513 on 194 days ─────────────────── View as table ┐
 │ Dec Jan Feb … heatmap 53×7 …                                     Less ▢▢▢▢▢ More │
 └──────────────────────────────────────────────────────────────────────────────────┘
 ┌ Recent activity ─────────────── View all ┐ ┌ Next step ─────────────────────────┐
 │ (rev) Reviewed Fix Toast contrast … 09:41│ │ (doc) Start your H2 2026 appraisal │
 │ (mrg) Merged Retry Stripe webhooks Nov 6 │ │ Since July you've merged 24 PRs…   │
 │ …                                        │ │ [Draft appraisal] Not now          │
 └──────────────────────────────────────────┘ │ Shown because H2 ends in 52 days…  │
                                              ├ Create ─────────────────────────────┤
                                              │ Appraisal › Promotion packet › Resume│
                                              └─────────────────────────────────────┘
```
**Components** StatCard ×4, ActivityChart, ImpactScoreCard, ActivityHeatmap, FeedItem list,
NextStepCard, quick create list, Banner. **Data** `GET /metrics/overview?period=` (cards, impact,
dataFreshness), `GET /impact?period=` (dimensions), `GET /metrics/heatmap?from=&to=` (heatmap **and**
the activity chart's per-day series for the period; week/month buckets summed client-side),
`GET /activity/feed?limit=7&types=pr_merged,pr_closed,review,achievement`, `GET /documents?type=appraisal&limit=5`
and `GET /achievements?period=` + `GET /me` for Next step rules.

**Next step rules** (first match wins; client-side, F-24):
1. Integration `needs_reauth`/`suspended` → "Reconnect GitHub".
2. Last sync `failed` → "Review the failed sync".
3. ≤ 60 days to the end of the current half (or quarter if `defaultPeriodType=quarter`) and no
   appraisal for it → "Start your H2 2026 appraisal" with merged/reviewed counts since the half began.
4. ≥ 3 PRs merged in the period and no achievement in the last 30 days → "Capture a recent win"
   (pre-fills from the largest merged PR).
5. Newest resume document older than 90 days → "Refresh your resume bullets".
6. No goals → "Set a goal for this half".
7. Otherwise → "See what drove your impact score" (links to S9).
"Not now" hides the card's current rule for 7 days (localStorage). Each card says why it's shown.

| State | Behaviour |
|---|---|
| Loading | Skeleton: 4 stat tiles, chart block, impact block, heatmap strip, 6 feed rows. Changing the period keeps old data with a top progress bar |
| Empty — no integration | Three-step setup checklist (Connect → Review repositories → First sync) + three value cards; **no** zero-filled stats, **no** score (fixes AI-01/UX-09 contradiction) |
| Empty — syncing | Info banner "Your last 30 days are ready. Older history is still loading." with % ; heatmap cells older than 30 days hatched "Still importing"; long periods show "Partial — import in progress" next to the period label |
| Empty — no data in range | Stat values `0` are real zeros with "No activity in Q3 2026"; impact card shows "Not enough activity in this period to compute a fair score" + chip "Show Q3 2026"/"Try a longer period"; chart shows an empty-plot message |
| Partial | Impact dimension unavailable → "—" + note "Quality isn't scored yet — not enough merged PRs in this period. The other dimensions were re-weighted."; low-sample metrics labelled in KPIs; failed repositories → sync-failed banner |
| Error | Whole page: ErrorState with Retry + request ID (API down never looks like empty data — UX-05). One widget failing → that card shows an inline error with Retry; others render |
| Success | Data renders; after a manual sync completes the queries refetch in place with a toast "Sync finished — 3 new items" |

Banners (top of page) for `needs_reauth`, sync failed, `waiting_rate_limit` ("Sync paused until 16:32"), backfill.
**D** 4-column stats; 2:1 rows. **M** stats 2×2 with deltas reduced to arrow + amount and one caption
"Changes are vs same point last month"; header actions stack full width; chart 268 px tall; heatmap
scrolls horizontally and starts scrolled to the newest week; Next step above Create.

## S7 · Activity explorer ▶
**Purpose** find any PR, review, commit or achievement in the period and inspect it. **Primary** none (exploration); per-item "Turn into achievement".
```
 Activity                                November 2026 · 38 items
 (All)(Pull requests)(Reviews)(Commits)(Achievements)   [All repositories ▾] [🔍 Search titles or refs]
 ┌ Mon, Nov 9 ────────────────────────────────────────────────────┐
 │ (rev) Reviewed Fix Toast contrast in dark theme   harbor-io/ui-kit · by @jgarcia · approved  09:41 │
 │ Fri, Nov 6                                                      │
 │ (mrg) Merged Retry Stripe webhooks…            harbor-io/payments-api     Nov 6 │
 └────────────────────────────── [Show more] 40 of 112 ───────────┘
```
**Item drawer (right sheet)** PR: state badges, labels, ref, wells (cycle time, first review after,
changed lines + small/large, reviews), timeline, "Turn into achievement" (AI quick action), Open on
GitHub. Review: state, turnaround, comments, "review bodies of others are never stored". Commit: ref,
authored time, +/− "context only — never a KPI". Achievement: description, impact, evidence chips.
**Data** `GET /activity/feed?period=&types=&repoIds=&q=&cursor=` (infinite scroll), detail
`GET /activity/prs/:id`, `GET /activity/commits/:id`, review detail from `FeedItem.meta` +
`GET /activity/prs/:id` (reviewed PR), achievements `GET /achievements/:id`; `POST /ai/achievement-statement`.
URL: `?type=&repo=&q=&item=`; `?metric=<key>` (from explain drawer) filters to that metric's evidence via `GET /metrics/evidence` (A-2).

| State | Behaviour |
|---|---|
| Loading | 6 skeleton rows; "Show more" → spinner in the footer button |
| Empty — no integration | Connect GitHub empty state |
| Empty — syncing | Banner; list shows what's imported, footer "More history is still importing" |
| Empty — no data in range / no match | "No activity matches these filters. Try another type or repository, or a longer period." + Clear filters |
| Partial | Excluded repositories never appear; a note in the repository filter lists excluded repos with a link to manage |
| Error | Panel error + Retry; drawer fetch error inside the drawer |
| Success | "Turn into achievement" → button "Drafting…" → pre-filled dialog (S17); 402 → inline "Quick AI actions used up — add it manually" |

**D** filters on one row. **M** chips scroll horizontally; repo select + search stack; drawer is a full-screen sheet.

## S8 · KPIs ▶
**Purpose** the five KPI sections with honest values, trends and explanations. **Primary** none; Explain per metric; link to Impact score.
```
 KPIs                                                     [⊙ Impact score 66]
 November 2026 · in progress · metrics@2.0.0 · Only included repositories count
 Delivery  Quality  Collaboration  Ownership  Consistency        (anchor tabs)
 ┌ Delivery ─ How steadily your own work reaches production.   Delivery score 55 · weight 30% ┐
 │ PRs merged [Scored]                     2        ↘ 1 vs same point   ╱╲_╱‾•   ⓘ │
 │ Pull requests you authored that were merged…                                     │
 │ PR cycle time (median) [Scored]   Not enough data   n = 2 of 3 needed  ╲ ╱      ⓘ │
 └────────────────────────────────────────────────────────────────────────────────┘
 … Quality · Collaboration · Ownership · Consistency (Active weeks feeds Delivery)
 Durations use business hours… Lines of code are never used as a KPI.
```
Metric order, names, definitions, caveats from `GET /metrics/definitions` (KPI_METHODOLOGY §3).
**Explain drawer** (F-27): section + Scored/Informational, definition, value/n/min n, good range +
direction, formula (mono), 6-month column chart + table, caveats, "Why gaming it doesn't help",
evidence (first 8 + count, "Open in Activity"), footer `metrics@2.0.0 · Times in Europe/London`.
**Data** `GET /metrics/kpis?period=`, `GET /metrics/definitions`, sparklines `GET /metrics/trends?period=&count=6` (A-1),
drawer `GET /metrics/timeseries?metric=&interval=month`, `GET /metrics/evidence?metric=&period=` (A-2), `GET /impact?period=` for section scores.

| State | Behaviour |
|---|---|
| Loading | Section cards with 3 skeleton rows each |
| Empty — no integration | Connect GitHub empty state (definitions still browsable via "How metrics work") |
| Empty — syncing | Banner; long periods show "Partial — import in progress" |
| Empty — no data in range | Every row "Not enough data · n = 0 of N needed"; count metrics show 0 |
| Partial | Per-row `insufficient_data` copy; "Low sample" badge when n < minN + 3; section score "—" when its dimension is unavailable |
| Error | Page error state; drawer timeseries error shows inline Retry while definition still renders (definitions cached) |
| Success | Changing period re-renders in place; drawer deep link `?metric=` restores on reload |

**D** 5-column row (name/def, value, delta, sparkline, explain). **M** 3-column row: name, value,
explain; delta and sparkline on a second line; definitions hidden (in the drawer); anchor tabs scroll.

## S9 · Impact score detail ▶
**Purpose** make the score defensible: explanation, components, history. **Primary** Generate highlights (AI, quick quota).
Layout: overall card (score 48 px, band, rendered §6.7 explanation) + Highlights card; History line
chart (12 months, 0–100, ticks 40/60/80, gaps for insufficient months) + table toggle; four dimension
cards with a components table (metric → explain, value, n, band score, adjusted (shrunk) score,
effective weight or "dropped"); footer note on k = 3 shrinkage and bands.
**Data** `GET /impact?period=`, `GET /impact/history?periodType=month&count=12`, `POST /impact/highlights`.

| State | Behaviour |
|---|---|
| Loading | Score skeleton, explanation lines, chart block, 4 table skeletons; Highlights "Writing highlights…" skeleton |
| Empty — no integration | Connect GitHub empty state |
| Empty — syncing | History months not yet imported shown as "Importing" in the table and as gaps |
| Empty — no data in range | Badge "Not enough data" + the §5 overall-threshold copy; dimension tables still show what exists; Highlights disabled "Highlights need an impact score for the period" |
| Partial | Unavailable dimension card shows "—" and the re-weighting sentence; old-version history points note "calculated with an earlier version" |
| Error | Page error; Highlights errors inline (402 "Quick AI actions used up for November", 409 insufficient, 503 "The AI service is busy. Try again in a minute.") |
| Success | Highlights: 2–3 bullets with evidence chips, "Generated 15:00 · cached for this period", Regenerate |

**D** 2:1 top row, 2-column dimension cards. **M** single column; tables scroll horizontally inside cards.

## S10 · Career timeline ▶
**Purpose** the story of the year by quarter. **Primary** none; Print view.
Header: year segmented control (years with data), Print view. Each quarter: sticky label (Q4 2026,
"In progress", totals), milestone tiles (first merged PR in a repo, largest merged PR, longest
active-week streak, achievements), "Beyond code" group (achievements), then per-repository groups:
merged PRs (3 shown, "Show N more"), labels as tags, "Reviewed N pull requests by teammates" cluster row.
No reviewed-PR stubs, no commit-count cards (fixes UX-10/DATA-01 noise).
**Data** `GET /career/timeline?year=`, `GET /metrics/repos?period=year:YYYY`.
**Print view** `/career/print?year=`: no shell, black-on-white, all items expanded, one quarter per page break, evidence refs printed in mono.

| State | Behaviour |
|---|---|
| Loading | Quarter skeletons (label + 3 rows) |
| Empty — no integration | Connect GitHub empty state |
| Empty — syncing | Quarters older than the imported window show "Still importing" |
| Empty — no data in range | Year with nothing: "No merged work, reviews or achievements in 2024." Quarter with nothing: one muted line |
| Partial | `truncated` flag → "Show N more" loads the rest for that repo/quarter |
| Error | Page error state |
| Success | Expanding a group is instant (client) or fetches with an inline spinner |

**D** 120 px sticky quarter column + content. **M** quarter label above content, milestones single column.

## S11 · Documents library ▶
**Purpose** find, reopen and manage generated documents. **Primary** New document.
Filters: type chips (All, Appraisals, Promotion, Resume), search; table: Title (+ status badge, "N
uncited" badge), Type, Period, Version, Evidence (% cited), Updated; row click opens S16; row menu
(Rename, Duplicate options, Delete). Sort by updated (default), created, title.
**Data** `GET /documents?type=&q=&sort=&cursor=` (`DocumentSummary` + `flags` A-5), `DELETE /documents/:id`.

| State | Behaviour |
|---|---|
| Loading | 5 skeleton rows |
| Empty — no integration | "No documents yet. Connect GitHub first — documents are written from your real pull requests and reviews." |
| Empty — no documents | "Draft an appraisal, promotion packet or resume bullets. Every claim links to the work behind it." + New document |
| Empty — no match | "No documents match" + Clear filters |
| Partial | Rows in `pending`/`streaming` show "Writing" badge with spinner; `failed` rows show "Failed" + Retry in the menu |
| Error | Panel error + Retry |
| Success | Delete → toast with Undo (soft delete window 7 s, then `DELETE`) |

**D** table. **M** table becomes stacked rows (title + badges, then type · period · updated).

## S12 · New document ▶
Three cards (Appraisal, Promotion packet, Resume bullets) with one-sentence descriptions and "Start …".
States: Loading n/a (static); Empty (no integration) → cards stay but studio shows the connect state;
Error n/a; Success → studio. **D** 3 columns, **M** stacked.

## S13–S15 · Studios (Resume ▶ · Appraisal ▶ · Promotion ▶)
**Purpose** choose options, preview evidence, generate. **Primary** Generate.
```
 New appraisal
 ┌ Options ───────────────────────────────┐ ┌ Evidence preview · H2 2026 ──────┐
 │ Period [H2 2026 (Jul–Dec, in progress)▾]│ │ PRs merged 24   PRs reviewed 49  │
 │ In-progress period: covers work to today│ │ Repositories 4  Achievements 2   │
 │ Self-reflection notes (optional)        │ │ Most significant work            │
 │ [                                     ] │ │  Harden 3DS challenge timeout…   │
 ├─────────────────────────────────────────┤ │  PR-harbor-io/payments-api#1935  │
 │ Uses 1 of 12 generations left · same    │ │ Ranked by DevImpact, not the AI. │
 │ inputs reuse the last result  [✦ Generate]│ │ Private repo names are redacted. │
 └─────────────────────────────────────────┘ └──────────────────────────────────┘
```
Fields — **Resume:** period (Last 12 months default), role segmented (Backend, Frontend, Fullstack,
DevOps, Manager), format (Bullets/Narrative), length (Short/Standard), job description (optional,
8,000 chars). **Appraisal:** period (month/quarter/half/year/custom presets; pre-filled from the
global period when coming from an Overview page), self-reflection (optional, 4,000). **Promotion:**
current role, target role (required; pre-filled from Profile), ladder text (optional, 12,000), period
(last 12 months default).
**Data** `POST /documents/preview-evidence` (debounced 400 ms on option change), `GET /me/usage`,
`POST /documents` (200 cached → open viewer with "Reused your last result — no generation used").

| State | Behaviour |
|---|---|
| Loading | Evidence preview skeleton while options change; Generate stays enabled |
| Empty — no integration | Connect GitHub empty state instead of the form |
| Empty — syncing | Preview note "Import in progress — older work may be missing" |
| Empty — no data in range | Warning in preview "Not enough evidence — choose a longer period"; Generate disabled with the same reason |
| Partial | In-progress period note; redaction note when `aiRedactPrivateRepos` |
| Error | Preview error inline (Retry) — Generate still possible; 402 → quota banner in the footer "You've used all 15 generations for November. They reset on December 1." + See plan; 429 → "Too many generations in a short time. Try again at 15:42."; validation → field errors (promotion target role) |
| Success | 201 → navigate to S16 streaming |

**D** form + 320 px evidence aside. **M** evidence preview below the form, Generate sticky at the bottom of the form card.

## S16 · Document viewer / editor ▶
**Purpose** read, verify, edit and export a document. **Primary** Export.
```
 Documents / Appraisal — H2 2026
 [Appraisal] H2 2026 · v1 · claude-opus-5-5 · [96% of claims cited]   [✎ Edit] [↻ Regenerate▾] [⤓ Export▾] […]
 ┌ (◌) Writing section 2 of 5 · Key accomplishments  You can leave this page…   [Stop] ┐
 ┌ Document (720 px) ────────────────────────────┐ ┌ Evidence · 6 cited ──────────┐
 │ Summary                                       │ │ Harden 3DS challenge…        │
 │ In H2 2026 I focused on … [payments-api #1935] │ │ [PR-harbor-io/payments-api#1935]│
 │ Key accomplishments                           │ ├ Versions ────────────────────┤
 │ • Harden 3DS… [payments-api #1921]             │ │ v3 · current  Your edits     │
 │ Metrics [Engine]  table …                     │ │ v2  Regenerated   [Restore]  │
 │ ⊞ Calculated by DevImpact — not written by AI │ │ v1  Generated     [Restore]  │
 └───────────────────────────────────────────────┘ └──────────────────────────────┘
```
Citations: chips after each claim → popover (title, repo, date, type, GitHub link, Details).
Flags: uncited/invalid claims get a wavy warning underline + "No evidence linked" chip; banner
"1 claim has no evidence" above the document. Engine sections are read-only in edit mode.
Edit: per-section rich text, autosave 900 ms after typing → "Saving…" → "Saved · v4" (first edit
in a session creates a new version). Regenerate menu: whole document (confirm), change options
(studio pre-filled), one section (Should). Export menu: Copy as Markdown, Copy as plain text,
Download PDF / DOCX / Markdown. More: Rename, Delete (alert dialog).
**Data** `GET /documents/:id` (+ `evidence: EvidenceItem[]` A-3), `GET /documents/:id/stream`,
`POST …/cancel`, `PATCH /documents/:id`, `GET …/versions`, `POST …/versions/:n/restore`,
`POST …/regenerate`, `GET …/export?format=`, `DELETE /documents/:id`.

| State | Behaviour |
|---|---|
| Loading | Title + 3 section skeletons; aside skeletons |
| Empty | `pending` (queued): "Queued — starting in a moment" banner; no sections yet |
| Partial (streaming) | Sections appear one by one; current section has a soft background and caret; actions disabled with reasons; leaving keeps it running (sidebar spinner, toast "Appraisal ready — Open") |
| Error | `error` SSE event → danger banner "The draft couldn't be finished. Nothing was counted against your quota." + Try again; cancelled → neutral banner "Generation stopped…" + Generate again; 409 VERSION_CONFLICT on save → dialog "A newer version exists (v5). Reload it, or save yours as a new version."; export failure → toast with retry; 404 → "This document was deleted" + Back to documents |
| Success | Done → coverage badge, flags banner if any, toast "Appraisal ready — 96% of claims cited."; copy → "Copied as Markdown"; download starts with filename `appraisal-2026-H2-v1.pdf` |

**D** 720 px document + 320 px aside. **M** aside moves below the document (Evidence collapsed into an accordion); header actions: Export primary + overflow menu (Edit, Regenerate, Rename, Delete).

## S17 · Achievements ▶
**Purpose** capture wins GitHub can't see; make them citable. **Primary** Add achievement.
List grouped by month: title (opens drawer), impact line, category badge, evidence chips, links,
date, delete (Undo toast). Category filter chips. Add/edit dialog: title (required, 200), category,
date (≤ today), impact (optional), links (≤ 10), linked evidence picker (search PRs/reviews/commits).
**Data** `GET /achievements?category=&period=&cursor=`, `POST/PATCH/DELETE /achievements/:id`,
evidence picker `GET /activity/feed?q=&types=pr_merged,review,commit`.

| State | Behaviour |
|---|---|
| Loading | Skeleton rows |
| Empty | "Capture the work GitHub can't see. Mentoring, incidents, design docs, talks…" + Add achievement (works without an integration) |
| Empty — filter | "No mentoring achievements yet" + Add achievement |
| Partial | Evidence that was purged shows a struck chip "Evidence removed" |
| Error | Panel error; dialog save error inline above the footer, values kept |
| Success | "Achievement saved" toast with View; appears in feed, timeline, document evidence |

**D** list + filters. **M** dialog = bottom sheet; chips scroll.

## S18 · Goals ▶
**Purpose** set targets on metrics or track with achievements. **Primary** Add goal.
Cards: title, status badge (On target / Not yet / Not enough data / Tracked by achievements — icon +
text), target text ("Review turnaround (median) ≤ 8.0 h"), current value, progress bar, date range.
Page lede states the evaluated month. Dialog: goal, metric (optional, from definitions), comparator,
target value (unit-aware: hours, %, count), target date. Card menu: Edit, Mark achieved, Archive, Delete.
**Data** `GET/POST/PATCH/DELETE /goals`, `GET /metrics/definitions`.

| State | Behaviour |
|---|---|
| Loading | 3 card skeletons |
| Empty | "Set a goal you can measure — for example, review teammates' PRs within a day." + Add goal |
| Partial | `no_data` badge with "Not enough data in October" |
| Error | Panel error; dialog validation "Enter a number of hours" |
| Success | Toast "Goal added"; status recalculates on the next complete month |

**D** 3 columns. **M** 1 column.

## S19 · Settings · Integrations ▶
**Purpose** connection health, repositories, sync history. **Primary** Sync now (Reconnect GitHub when needed).
Sections: GitHub card (status badge, account, installations table with per-install status,
explanation line, Sync now / Reconnect, Manage on GitHub, Disconnect), Repositories (switch per repo,
"Counted in KPIs and documents" / "Excluded — data kept, never counted", last activity, search when >
20, "Changing a repository recalculates your KPIs…"), Sync history (started, trigger, result badge,
first error message, new items, duration; expandable error list), Planned (GitLab, Jira, Linear — dashed
cards, "Planned for v2.1", **no** connect buttons, D-018).
**Data** `GET /integrations`, `GET /integrations/:id`, `GET /sync/status` (poll 2 s while running),
`POST /sync`, `POST /integrations/:id/reconnect`, `DELETE /integrations/:id?purgeData=`,
`GET /repos`, `PATCH /repos/:id`, `GET /sync/runs`.

| Integration state | Badge | Explanation | Actions |
|---|---|---|---|
| `active` | Connected (success) | "Synced 12 min ago · next scheduled sync tomorrow at 03:40" | Sync now |
| syncing | Importing history · 64% (accent) | stage + % | Sync now disabled "A sync is already running" |
| `waiting_rate_limit` | Paused until 16:32 (warning) | "GitHub's rate limit was reached. The sync resumes automatically." | Sync now disabled |
| `needs_reauth` | Needs reconnection (warning) | "GitHub access was revoked on Nov 8. Reconnect to resume syncing — nothing has been deleted." | **Reconnect GitHub** |
| `suspended` | Suspended (warning) on the org row | "harbor-io suspended DevImpact. Ask an owner to unsuspend it." | Manage on GitHub |
| `error` / last run failed | Last sync failed (danger) | first error message | Retry sync, View details |
| not connected | — | "Pull requests, reviews and commits" | Connect GitHub |

| State | Behaviour |
|---|---|
| Loading | Card + list skeletons |
| Empty — no integration | GitHub card with Connect; repositories and history hidden; Planned cards shown |
| Empty — syncing | Badge + progress; repositories editable |
| Partial | `partial` runs list failed repositories; inaccessible repos show "No longer accessible to the app" with Manage on GitHub |
| Error | Section-level errors with Retry; `POST /sync` 429 toast "You can sync again at 16:10" |
| Success | Toasts: "Sync started…", "Sync finished — 3 new items", "harbor-io/ui-kit excluded. KPIs are being recalculated.", disconnect confirmations (keep/purge) |

**D** 760 px column. **M** installation table and history become stacked rows.

## S20 · Settings · Profile ▶
Fields: display name, email (read-only, from provider), time zone (searchable list of IANA zones;
helper: "Changing it recalculates all KPIs and scores"), current role, level, target role, default
period (Month/Quarter/Half/Year). Sections: Sign-in methods (GitHub primary, Link Google), Sessions
(this device, others with Sign out). **Primary** Save changes.
**Data** `GET /me`, `PATCH /me`, `GET/PATCH /me/settings` (`meta.recomputeQueued` → toast "Recalculating your KPIs in Europe/Berlin…"), Better Auth `list-sessions`, `revoke-session`, link social.

| State | Behaviour |
|---|---|
| Loading | Field skeletons |
| Empty | n/a (always has a user) |
| Partial | Unsaved changes → "You have unsaved changes" on navigation attempt |
| Error | Field errors (name 1–100 chars); save error banner keeps values |
| Success | "Profile saved"; time zone change toast + banner on Overview pages until recompute finishes |

## S21 · Settings · Notifications ▶
Toggles save immediately ("Saved"): Weekly digest (+ day, hour in the user's time zone, "Preview this
week's digest" dialog), Sync problems, Document ready. **Data** `PATCH /me/settings`, `POST /notifications/digest/preview`.
States: Loading (rows skeleton) · Empty n/a · Partial (digest off hides schedule) · Error (toggle
reverts + toast "Couldn't save. Try again.") · Success ("Saved").

## S22 · Settings · Privacy & data ▶
Rows: Repositories counted (→ S19), Redact private repository names in AI output (switch), Export
data (button → "Preparing…" → download; "Up to 3 exports a day"), Delete account (danger section →
alert dialog with typed email; button disabled until it matches).
**Data** `PATCH /me/settings { aiRedactPrivateRepos }`, `GET /me/export`, `DELETE /me`.
States: Loading · Empty n/a · Partial (export in progress keeps the button disabled) · Error (429
"You've exported 3 times today. Try again tomorrow.", delete 400 "The email doesn't match your account")
· Success (download starts + toast; delete → signed out to S1 with "Account deleted").

## S23 · Settings · Plan & usage ▶
Usage card (AI generations used of limit, quick actions used of limit, reset date in UTC), plans
table (Free current vs Pro: history window, generations, quick actions, integrations, exports/digest),
"Need more? Email upgrade@devimpact.dev" (selectable text; no billing, D-014). Optional: tokens and
estimated cost breakdown by feature (collapsed).
**Data** `GET /me/entitlements`, `GET /me/usage?month=`.
States: Loading (meters skeleton) · Empty (0 of 15 used) · Partial (≥ 80 % used → meter note
"3 generations left — resets December 1") · Error (panel retry) · Success n/a (read-only).

## S24 · Unsubscribe (public)
No shell, no sign-in. "You're unsubscribed from the weekly digest." + "Change all email settings"
(sign-in link). **Data** `POST /notifications/unsubscribe { token }` on load.
States: Loading ("Updating your email preferences…") · Empty n/a · Partial n/a · Error ("This
unsubscribe link has expired. Sign in to change your email settings.") · Success (confirmation).

## S25 · 404 / 500 ▶
404: "Page not found — The page may have moved, or the link is incomplete." Go to dashboard · Search.
500 (route `error.tsx` / global error): "Something went wrong on our side. We've logged the problem.
Try again in a moment — your data is safe." Try again · Go to dashboard · Error ID. Both render inside
the shell when the user is signed in (navigation still works) and standalone otherwise.

---

## O1 · Command palette ▶
See [IA §5](IA.md#5-command-palette-k--ctrl-k). States: Loading (document search results show a
spinner row) · Empty ("No results for “xyz”") · Error (document search failure → navigation and
actions still listed, "Couldn't search documents") · Success (runs the command, closes, focus moves
to the destination's `main`). **M** opens as a top sheet with the keyboard up.

## O2 · Period picker ▶
See [IA §4](IA.md#4-global-period-control). Presets with check for the current one, custom range with
inline validation, URL footer. **M** opens as a bottom sheet with presets as 48 px rows.

---

## Acceptance checks (P04)

- Every PRD screen (F-01…F-76 UI-bearing features) maps to a row in the index above; v2.1 items
  (F-08, F-19, F-52, F-66, F-77) intentionally have no screen.
- Every screen lists Loading, Empty (with the no-integration / syncing / no-data-in-range variants
  where data-driven), Partial, Error and Success, plus D/M notes.
- Every data dependency names an endpoint in API_CONTRACT_V2; the five gaps found are amendments
  A-1…A-5 in its §22.
