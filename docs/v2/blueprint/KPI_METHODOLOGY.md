# KPI & Impact-Score Methodology (v2)

*Phase 03 · 2026-11-09 · Status: **binding** for P07 (implementation), P08 (prompt inputs),
P10 (UI copy). Metrics version **`metrics@2.0.0`**, impact score version **`impact@2.0.0`**.*

Any change to a formula, threshold, band or weight is a **version bump** (§9) and a new entry in
[`../DECISIONS.md`](../DECISIONS.md). Names, keys and user-facing definitions in this file are the
source of truth for code (`apps/api/src/metrics/metric-definitions.ts`) and UI copy.

Related: [ADR-0008](adr/ADR-0008-metrics-engine-and-impact-score.md) ·
[DATA_MODEL_V2](DATA_MODEL_V2.md) · [API_CONTRACT_V2 §Metrics](API_CONTRACT_V2.md#9-metrics)

---

## 1. Principles

1. **Deterministic.** Every number is a pure function of stored data, the period and the user's
   timezone. Same inputs → same output, byte for byte.
2. **Explainable.** Every metric has a one-sentence definition, a formula, its sample size `n`,
   caveats and links to the records it was computed from.
3. **Fair.** Metrics describe *work patterns*, not *worth*. We never rank users against each
   other. Volume metrics saturate (more is not always better). Raw lines of code are never a
   productivity signal (§1.1).
4. **Honest about uncertainty.** Medians and ratios with small samples are shrunk toward neutral
   in the score and labelled "low sample" in the UI; below thresholds we show
   **"Not enough data"** instead of a number.
5. **The LLM never produces numbers** (§8).

### 1.1 Why we don't use lines of code
- LOC rewards verbosity, generated code, vendored files and copy-paste; it punishes deletion,
  refactoring and careful small changes — the opposite of good engineering.
- It varies by language and formatting, so it is not comparable across repos or people.
- It is trivially gameable.

We use change size **only** in the *Quality* section, where **smaller** pull requests are
treated as better (they are reviewed more effectively), and we cap the effect. Per-commit
additions/deletions appear only as context in detail drawers, never as a KPI.

---

## 2. Definitions used by every formula

### 2.1 Identity and scope
- **User identity** = the GitHub account of the user's active GitHub integration
  (`Integration.externalAccountId`, GitHub node ID; login kept for display).
- **Included repository** = `Repository.included = true`. Records from excluded repositories are
  ignored by every metric (but remain stored until purged).
- **Bot account** = a GitHub actor whose `__typename` is `Bot` or whose login ends with `[bot]`.

### 2.2 Record sets (all filtered to included repositories)
| Symbol | Set | Source |
|---|---|---|
| `AP` | **Authored PRs**: `PullRequest` rows with `isAuthoredByUser = true` | P06 search `is:pr author:<login>` |
| `RP` | **Reviewed PRs**: `PullRequest` rows with `isAuthoredByUser = false` on which the user submitted ≥ 1 review | P06 search `is:pr reviewed-by:<login> -author:<login>` |
| `RV` | **User's reviews**: `PullRequestReview` rows (one per submitted review, state ∈ {APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED}; PENDING never stored; self-reviews never stored) | P06 |
| `CM` | **Commits**: `Commit` rows authored by the user, reachable from the repository's default branch, with ≤ 1 parent (merge commits excluded) | P06 |
| `AC` | **Achievements**: `Achievement` rows (P12) — used by the timeline/feed and AI evidence, **not** by any scored metric | P12 |

### 2.3 Timestamps used for period membership (attribution)
| Event | Timestamp |
|---|---|
| PR opened | `AP.createdAt` |
| PR ready for review (`readyAt`) | `AP.readyForReviewAt` if the PR was ever a draft (first `ReadyForReviewEvent`), else `AP.createdAt` |
| PR merged | `AP.mergedAt` |
| PR closed unmerged | `AP.closedAt` where `mergedAt IS NULL` |
| PR first review received | `AP.firstReviewAt` = earliest `submittedAt` of a review on the PR by an account that is not the PR author and not a bot, state ≠ PENDING |
| Review submitted | `RV.submittedAt` |
| Review requested | `RV.reviewRequestedAt` = earliest `ReviewRequestedEvent.createdAt` on the PR whose requested reviewer is the user **or any team**, at or before that review's `submittedAt` (null if none) |
| Commit | `CM.authoredAt` (git author date; stable across rebases) |

### 2.4 Periods and time zones
- Every user has `UserSettings.timezone` (IANA name, default `UTC`, prefilled from the browser at
  onboarding). Changing it triggers a full recompute of snapshots and cached scores.
- A **period** is an inclusive range of local calendar dates `[startDate, endDate]`. It maps to
  the half-open UTC instant range `[start, endExclusive)` where `start` = `startDate 00:00` local
  and `endExclusive` = `(endDate + 1 day) 00:00` local, both converted with the IANA tz database
  (DST-correct). An event belongs to the period iff `start ≤ t < endExclusive`.
- Period types: `month`, `quarter` (calendar Q1–Q4), `half` (H1 Jan–Jun, H2 Jul–Dec), `year`,
  `custom` (7–366 days). Grammar in [API_CONTRACT_V2 §3.4](API_CONTRACT_V2.md#34-period-parameter).
- **Current (in-progress) periods** end at "today" for display, but `periodDays` (§2.6) uses the
  full calendar length so rates are not inflated early in a month; the UI labels them
  "in progress".
- **Previous period** (for deltas): the immediately preceding period of the same type and length
  (`custom` of N days → the N days before `startDate`).
- **Week**: ISO week (Monday–Sunday) in the user's timezone. Weekdays = Monday–Friday.

### 2.5 Business hours
`businessHours(a, b, tz)` = the number of hours in `[a, b)` that do **not** fall on a Saturday or
Sunday in `tz`. If `b ≤ a` the result is `0`. Computed by walking local calendar days (DST-safe:
a 23-hour or 25-hour local day contributes its real length). All duration metrics use business
hours, so a PR opened Friday 17:00 and reviewed Monday 09:00 counts as 16 h, not 64 h.
*Holidays are not modelled in v2.0 (caveat shown in the UI).*

### 2.6 Helpers
- `periodDays` = number of calendar days in the period (full length, see §2.4).
- `per28(x)` = `x × 28 / periodDays` (normalises counts to a 4-week rate for scoring; displayed
  values are always raw counts).
- `median(S)` = middle value of sorted `S`; for even `|S|`, the arithmetic mean of the two middle
  values; undefined for empty `S`.
- `changedLines(pr)` = `pr.additions + pr.deletions` as reported by GitHub for the PR diff.
- Ratios are computed in full floating-point precision; only display values are rounded.

---

## 3. Metric catalogue

Legend — **Scored**: used by the impact score (§6). **Min n**: below this sample size the metric
status is `insufficient_data` and the UI shows "Not enough data". Metric keys are stable API
identifiers. Units: `count`, `hours` (business hours, 1 decimal), `ratio` (0–1, shown as %),
`repos`, `days`, `weeks`.

### 3.1 Delivery

#### `prs_merged` — PRs merged · Scored
- **Definition (UI):** "Pull requests you authored that were merged in this period."
- **Formula:** `|{ p ∈ AP : p.mergedAt ∈ period }|`
- **Data:** `pull_requests.is_authored_by_user, merged_at, repository_id`
- **Unit / granularity:** count · day, week, month
- **Good range:** context-dependent; 4–12 per 4 weeks is typical for product teams.
- **Caveats:** Team conventions (stacked PRs, monorepo vs many repos) change counts a lot. Merges
  done by others still count — authorship is what matters.
- **Anti-gaming:** Score saturates at 12 per 4 weeks; tiny PRs are not rewarded beyond the
  small-PR ratio; splitting PRs artificially raises review load for teammates (visible in their data).

#### `prs_opened` — PRs opened · informational
- **Definition:** "Pull requests you opened in this period (including drafts)."
- **Formula:** `|{ p ∈ AP : p.createdAt ∈ period }|`
- **Caveats / anti-gaming:** Not scored, so opening PRs never raises the score by itself.

#### `pr_cycle_time_median_hours` — PR cycle time (median) · Scored · Min n = 3
- **Definition:** "Typical business hours from a PR being ready for review to being merged, for
  your PRs merged in this period."
- **Formula:** `median({ businessHours(readyAt(p), p.mergedAt) : p ∈ AP, p.mergedAt ∈ period })`
- **Data:** `created_at, ready_for_review_at, merged_at`
- **Unit:** hours (business) · lower is better
- **Good range:** < 24 h excellent, 24–72 h healthy, > 1 week worth a look.
- **Caveats:** Depends heavily on reviewers' availability and team process; long-running
  feature branches by design will look slow. Draft time is excluded by design.
- **Anti-gaming:** Opening PRs as drafts until approval would shorten cycle time; mitigated
  because `first_pass_approval_rate` and teammates' review data stay visible, and the metric is
  only 30 % of one dimension.

#### `merge_rate` — Merge rate · Scored · Min n = 3
- **Definition:** "Of your PRs that were closed in this period, the share that were merged."
- **Formula:** `M / (M + U)` where `M = prs_merged`, `U = |{ p ∈ AP : p.mergedAt IS NULL ∧ p.closedAt ∈ period }|`; `n = M + U`
- **Unit:** ratio · higher is better (to ~90 %)
- **Good range:** 80–95 %. Exploratory/spike work legitimately lowers it.
- **Caveats:** Closing obsolete PRs is good hygiene; the band saturates at 90 % so abandoning
  nothing is not required for a full score.

### 3.2 Quality

#### `small_pr_ratio` — Small PR ratio · Scored · Min n = 3
- **Definition:** "Share of your merged PRs with 400 or fewer changed lines."
- **Formula:** `|{ p ∈ AP_m : changedLines(p) ≤ 400 }| / |AP_m|` where `AP_m = { p ∈ AP : p.mergedAt ∈ period }`; `n = |AP_m|`
- **Unit:** ratio · higher is better
- **Good range:** ≥ 70 %.
- **Rationale:** Review effectiveness drops sharply above ~400 changed lines (SmartBear/Cisco
  study; Google engineering practices recommend small CLs).
- **Caveats:** Generated files, lockfiles, migrations and renames inflate `changedLines`; GitHub
  does not let us exclude them per file in v2.0.
- **Anti-gaming:** Splitting a change into dependent PRs is genuinely good practice; trivially
  small PRs don't move other metrics.

#### `revert_rate` — Revert rate · Scored · Min n = 3
- **Definition:** "Share of your PRs merged in this period that were later reverted."
- **Formula:** `|{ p ∈ AP_m : p.revertedAt IS NOT NULL }| / |AP_m|`; `n = |AP_m|`
- **Revert detection (P06):** PR `p` is reverted when a **merged** PR `r` in the same repository
  cross-references `p` (GitHub `CrossReferencedEvent` on `p`) **and** `r.title` starts with
  `Revert "`. `p.revertedAt = r.mergedAt`, `p.revertedByUrl = r.url`. (This matches GitHub's
  "Revert" button output: title `Revert "<title>"`, body `Reverts owner/repo#N`.)
- **Unit:** ratio · lower is better
- **Good range:** < 5 %.
- **Caveats:** Reverts made by plain `git revert` without referencing the PR are not detected.
  The value for a past period can rise later when a revert lands (data freshness); reverts are
  sometimes rollbacks of healthy changes for unrelated reasons.

#### `pr_size_median_lines` — Median PR size · informational
- **Definition:** "Typical changed lines (added + deleted) of your PRs merged in this period."
- **Formula:** `median({ changedLines(p) : p ∈ AP_m })` · Min n = 3
- **Caveats:** Context only; shown next to the small-PR ratio; never framed as output.

#### `first_pass_approval_rate` — First-pass approval · informational · Min n = 3
- **Definition:** "Share of your merged PRs approved without any 'changes requested' review."
- **Formula:** `|{ p ∈ AP_m : p.changesRequestedCount = 0 }| / |AP_m|`
- **Caveats:** Strongly dependent on team review culture; not scored for that reason.

### 3.3 Collaboration

#### `prs_reviewed` — PRs reviewed · Scored
- **Definition:** "Distinct pull requests by others that you reviewed in this period."
- **Formula:** `|{ p ∈ RP : ∃ r ∈ RV, r.pullRequestId = p.id ∧ r.submittedAt ∈ period }|`
  (a PR reviewed in two periods counts once in each)
- **Unit:** count · Good range: 5–15 per 4 weeks for product teams.
- **Caveats:** GitHub records each reply in a review thread as a `COMMENTED` review; counting
  **distinct PRs** removes that inflation.
- **Anti-gaming:** Saturates at 15 per 4 weeks; rubber-stamp approvals are visible in
  `review_depth_median`.

#### `review_turnaround_median_hours` — Review turnaround (median) · Scored · Min n = 3
- **Definition:** "Typical business hours from being asked to review to submitting your first
  review, for reviews submitted in this period."
- **Formula:** for each `p ∈ RP` let `r₁(p)` = the user's earliest review on `p` with
  `submittedAt ∈ period`; sample `S = { businessHours(r₁.reviewRequestedAt, r₁.submittedAt) :
  r₁.reviewRequestedAt IS NOT NULL }`; value = `median(S)`; `n = |S|`
- **Unit:** hours (business) · lower is better · Good range: < 8 h excellent, < 24 h healthy.
- **Caveats:** Reviews without a recorded request (e.g. drive-by reviews) are excluded. Team
  requests are attributed to the user if they reviewed (we cannot see team membership).

#### `review_balance` — Review balance · Scored · Min n = 3
- **Definition:** "How your reviewing compares with your authoring: reviews ÷ (reviews + merged PRs)."
- **Formula:** `prs_reviewed / (prs_reviewed + prs_merged)`; `n = prs_reviewed + prs_merged`
- **Unit:** ratio · Good range: 0.4–0.7. Score saturates at 0.5 (balanced) — reviewing more
  than you author is never penalised.

#### `time_to_first_review_median_hours` — Time to first review (as author) · informational · Min n = 3
- **Definition:** "Typical business hours your PRs waited for a first review from someone else."
- **Formula:** `median({ businessHours(readyAt(p), p.firstReviewAt) : p ∈ AP, p.firstReviewAt ∈ period })`
- **Caveats:** Measures your teammates' responsiveness more than yours — **never scored**; shown
  to help you spot bottlenecks.

#### `review_depth_median` — Review depth (median) · informational · Min n = 3
- **Definition:** "Typical number of comments you leave per PR you review."
- **Formula:** for each `p` counted in `prs_reviewed`: `c(p) = Σ over the user's reviews r on p
  with r.submittedAt ∈ period of (r.commentsCount + (r.hasBody ? 1 : 0))`; value = `median(c)`
- **Caveats:** More comments are not inherently better; shown for self-reflection only.

#### `repos_reviewed` — Repositories reviewed in · informational
- **Formula:** distinct `repositoryId` over PRs counted in `prs_reviewed`.

### 3.4 Ownership

#### `repos_contributed` — Repositories contributed to · Scored
- **Definition:** "Repositories where you committed, opened or merged a PR, or reviewed in this period."
- **Formula:** distinct `repositoryId` over `{ CM by authoredAt } ∪ { AP by createdAt } ∪ { AP by mergedAt } ∪ { RP with a review in period }`
- **Unit:** repos · Good range: 1–5 (more is not better beyond focus limits; score saturates at 5).
- **Caveats:** Not rate-normalised (breadth over a year naturally exceeds a month).

#### `two_way_repos` — Two-way repositories · Scored
- **Definition:** "Repositories where you both merged your own PRs and reviewed others' PRs in
  this period — a sign of shared ownership."
- **Formula:** `|{ repo : ∃ p ∈ AP, p.mergedAt ∈ period, p.repo = repo } ∩ { repo : ∃ q counted in prs_reviewed, q.repo = repo }|`
- **Unit:** repos · saturates at 3.

#### `repos_with_merged_prs` — Repositories with merged PRs · informational
- **Formula:** distinct `repositoryId` over `AP_m`.

### 3.5 Consistency

#### `active_days` — Active days · informational
- **Definition:** "Days in this period with at least one commit, PR opened or review."
- **Formula:** distinct local dates of `{ CM.authoredAt } ∪ { AP.createdAt } ∪ { RV.submittedAt }` within the period.
- **Caveats:** Not scored, to avoid rewarding always-on or weekend work.

#### `active_weeks_ratio` — Active weeks · Scored (inside Delivery)
- **Definition:** "Share of the period's working weeks with at least one contribution."
- **Formula:** `W` = set of ISO weeks that contain at least one weekday (Mon–Fri) inside the
  period; a week `w ∈ W` is active if at least one contribution (as in `active_days`) falls on a
  date in `w ∩ period`. Value = `|active weeks| / |W|`.
- **Good range:** ≥ 75 %. Holidays and leave lower it (caveat shown); one contribution per week
  is enough, so it rewards steadiness, not volume.

#### `commits` — Commits · informational
- **Formula:** `|{ c ∈ CM : c.authoredAt ∈ period }|`
- **Caveats:** Commit granularity is a personal style; squash-merge teams show few commits. Never scored.

#### `longest_active_week_streak` — Longest active-week streak · informational
- **Formula:** longest run of consecutive active weeks (as in `active_weeks_ratio`) within the period.
- **Caveats:** Shown as a milestone only; never scored.

### 3.6 Issue metrics — deferred to v2.1 (requires Jira/Linear, P13 skipped)
Kept here so the catalogue is complete; not implemented in v2.0.
- `issues_completed`: issues assigned to the user whose `completedAt ∈ period` and status category = done.
- `story_points_completed`: Σ `storyPoints` over the same set (null points ignored; `n` = issues with points).
- `issue_cycle_time_median_hours`: median `businessHours(startedAt, completedAt)` for the same set.

### 3.7 Dashboard stat cards (F-20)
| Card | Metric key | Delta |
|---|---|---|
| Commits | `commits` | vs previous period |
| PRs merged | `prs_merged` | vs previous period |
| PRs reviewed | `prs_reviewed` | vs previous period |
| Impact score | `impact.overall` | vs previous period (points) |

`delta = value − previousValue`; `deltaPct = delta / previousValue` (null when `previousValue = 0`).
Deltas use the same period type; for an in-progress period, the previous period is compared
**to the same elapsed fraction** (e.g. Nov 1–9 vs Oct 1–9) and labelled "same point last month".

---

## 4. Daily rollups (`MetricSnapshot`)

For charts (timeseries, heatmap) the engine stores one row per user per **local date** with
additive counters (columns, see [DATA_MODEL_V2](DATA_MODEL_V2.md#3-prisma-schema-draft)):
`commits`, `prsOpened`, `prsMerged`, `prsClosedUnmerged`, `reviewsSubmitted`, `prsReviewed`
(distinct PRs reviewed **that day**), `reviewComments`, `achievements`, `active` (boolean).

- Week/month timeseries buckets sum daily values **except** `prs_reviewed`, which is recomputed
  from `RV` for the bucket (distinct counts are not additive). Medians and ratios are always
  computed from the fact tables for the requested range, never from snapshots.
- Rollups are idempotent: recomputing a date range deletes and rewrites those rows in one
  transaction.

---

## 5. Minimum-data rules

| Level | Rule | Result |
|---|---|---|
| Metric | `n < Min n` (see catalogue) | `status = insufficient_data`, value `null` in API; excluded from the score |
| Metric | Required data source not connected (issue metrics) | `status = not_applicable` |
| Dimension | No component metric available | dimension `available = false`, score `null`; its weight is redistributed (§6.4) |
| Overall | `periodDays < 7` **or** `prs_merged + prs_reviewed < 3` **or** fewer than 2 dimensions available | `status = insufficient_data`; no overall or dimension scores are shown; the UI says "Not enough activity in this period to compute a fair score — try a longer period." |

---

## 6. Impact score `impact@2.0.0`

### 6.1 Shape
- **Overall:** integer 0–100.
- **Four dimensions** (0–100, displayed as integers): **Delivery**, **Quality**,
  **Collaboration**, **Ownership**. (These replace v0.1's `featureDelivery`, `codeQuality`,
  `collaboration`, `leadership`. "Leadership" is not measurable from Git data and is captured
  qualitatively through achievements instead.)
- Computed for any supported period; the dashboard shows the selected period, history uses months.
- Display bands (copy owned by P04): 0–39 **Low signal** · 40–59 **Moderate** · 60–79 **Strong**
  · 80–100 **Very strong**. Copy always frames the score as "signal from your GitHub activity",
  never as performance.

### 6.2 Normalisation: absolute reference bands
Each scored metric is mapped to 0–100 by a **piecewise-linear band function** through fixed
anchor points `(x, y)`, clamped outside the first and last anchor:

```
band(x; (x0,y0)…(xk,yk)) = y0                         if x ≤ x0
                         = y(i-1) + (x − x(i-1)) / (x(i) − x(i-1)) × (y(i) − y(i-1))   for x(i-1) < x ≤ x(i)
                         = yk                         if x > xk
```

Absolute bands (not percentiles against other users, not a personal baseline) make the score
reproducible from the period's inputs alone and avoid ranking people. Anchors are informed by
public engineering research (DORA, Google engineering practices, the SmartBear review study) and
deliberately **saturate** so volume beyond a healthy level earns nothing. Your trend against your
own past is shown separately as deltas and history, not folded into the score.

Count metrics are scored on `per28(count)`; durations on business hours; ratios as-is.

### 6.3 Small-sample shrinkage (smoothing)
Ratio and median metrics are shrunk toward the neutral value 50 by their sample size `n`:

```
shrunk(s, n) = (n × s + k × 50) / (n + k)      with k = 3
```

Count metrics (`prs_merged`, `prs_reviewed`, `repos_contributed`, `two_way_repos`) and
`active_weeks_ratio` are **not** shrunk (their value already encodes the amount of evidence).
There is no cross-period smoothing in `impact@2.0.0`: a period's score depends only on that
period's data.

### 6.4 Components, weights and anchors

| Dimension (weight) | Component metric | Weight in dimension | Anchors `(x → score)` | Shrink |
|---|---|---|---|---|
| **Delivery (0.30)** | `per28(prs_merged)` | 0.50 | 0→0, 2→40, 4→60, 8→85, 12→100 | no |
| | `pr_cycle_time_median_hours` | 0.30 | 4→100, 24→85, 72→60, 168→30, 336→0 | yes (n = merged PRs with cycle time) |
| | `active_weeks_ratio` | 0.20 | 0→0, 0.5→50, 0.75→80, 1→100 | no |
| **Quality (0.25)** | `small_pr_ratio` | 0.40 | 0→0, 0.5→60, 0.8→90, 1→100 | yes |
| | `revert_rate` | 0.35 | 0→100, 0.05→80, 0.10→50, 0.25→0 | yes |
| | `merge_rate` | 0.25 | 0→0, 0.5→40, 0.8→80, 0.9→100 | yes |
| **Collaboration (0.30)** | `per28(prs_reviewed)` | 0.50 | 0→0, 2→40, 5→65, 10→90, 15→100 | no |
| | `review_turnaround_median_hours` | 0.30 | 2→100, 8→85, 24→65, 72→30, 168→0 | yes |
| | `review_balance` | 0.20 | 0→0, 0.3→70, 0.5→100, 1→100 | yes |
| **Ownership (0.15)** | `two_way_repos` | 0.60 | 0→0, 1→60, 2→80, 3→100 | no |
| | `repos_contributed` | 0.40 | 0→0, 1→40, 3→75, 5→100 | no |

Rules:
1. A component whose metric is `insufficient_data` is dropped and the remaining component
   weights in that dimension are renormalised to sum to 1.
2. `dimension = Σ (componentWeight × componentScore)` over available components.
3. A dimension with no available components is unavailable; overall weights are renormalised
   over available dimensions: `overall = Σ (w_d × D_d) / Σ w_d`.
4. `overall` is rounded **half-up to an integer** at the very end (`Math.floor(x + 0.5)`);
   dimension scores are stored with full precision and displayed rounded the same way.
   Intermediate values are never rounded.
5. Delivery, Collaboration and Ownership are always available when the overall threshold (§5)
   passes because their count components are always defined; Quality can be unavailable (no
   merged/closed PRs).

### 6.5 Worked example (golden test G-1)
User in `UTC`, period `month:2026-10` (31 days). Inputs:
`prs_merged = 6` (5 with ≤ 400 changed lines, 0 reverted), 1 PR closed unmerged,
`pr_cycle_time_median_hours = 30` (n = 6), active weeks 4 of 5 (ISO weeks 40–44 each contain an
October weekday), `prs_reviewed = 9`, `review_turnaround_median_hours = 6` (n = 8),
`two_way_repos = 2`, `repos_contributed = 3`.

| Component | Raw value | Band score | Shrunk | Weighted |
|---|---|---|---|---|
| per28(prs_merged) = 6×28/31 = 5.4194 | | 68.8710 | — | ×0.50 = 34.4355 |
| cycle time 30 h | | 81.8750 | (6×81.875+150)/9 = 71.2500 | ×0.30 = 21.3750 |
| active weeks 0.8 | | 84.0000 | — | ×0.20 = 16.8000 |
| **Delivery** | | | | **72.6105** |
| small PR ratio 5/6 | | 91.6667 | 77.7778 | ×0.40 = 31.1111 |
| revert rate 0 | | 100.0000 | 83.3333 | ×0.35 = 29.1667 |
| merge rate 6/7 | | 91.4286 | (7×91.4286+150)/10 = 79.0000 | ×0.25 = 19.7500 |
| **Quality** | | | | **80.0278** |
| per28(prs_reviewed) = 8.1290 | | 80.6452 | — | ×0.50 = 40.3226 |
| turnaround 6 h | | 90.0000 | (8×90+150)/11 = 79.0909 | ×0.30 = 23.7273 |
| review balance 9/15 = 0.6 | | 100.0000 | (15×100+150)/18 = 91.6667 | ×0.20 = 18.3333 |
| **Collaboration** | | | | **82.3832** |
| two-way repos 2 | | 80 | — | ×0.60 = 48 |
| repos contributed 3 | | 75 | — | ×0.40 = 30 |
| **Ownership** | | | | **78.0000** |

`overall = 0.30×72.6105 + 0.25×80.0278 + 0.30×82.3832 + 0.15×78 = 78.2050 → **78**`
(displayed dimensions: Delivery 73, Quality 80, Collaboration 82, Ownership 78).

Variant G-2 (re-weighting unit test of `combineDimensions`): Delivery 72.6105, Collaboration
82.3832, Ownership 78 and Quality unavailable →
`overall = (0.30×72.6105 + 0.30×82.3832 + 0.15×78) / 0.75 = 77.5975 → 78`.
P07 must include G-1 and G-2 plus threshold cases as golden tests.

### 6.6 Stored inputs (reproducibility)
`ImpactScore.inputs` (JSON, validated by a shared Zod schema) stores everything needed to
recompute the score without the database:

```json
{
  "scoreVersion": "impact@2.0.0",
  "metricsVersion": "metrics@2.0.0",
  "period": { "type": "month", "startDate": "2026-10-01", "endDate": "2026-10-31",
              "timezone": "UTC", "periodDays": 31 },
  "metrics": {
    "prs_merged": { "value": 6, "n": 6 },
    "pr_cycle_time_median_hours": { "value": 30, "n": 6 },
    "...": {}
  },
  "dimensions": {
    "delivery": { "available": true, "weight": 0.30, "score": 72.6105,
      "components": [ { "metric": "prs_merged", "input": 5.4194, "band": 68.871,
                        "shrunk": null, "weight": 0.5 } ] }
  },
  "overall": 78.205, "status": "ok",
  "evidence": { "prs_merged": ["pr_cuid1", "pr_cuid2"], "prs_reviewed": ["pr_cuid9"] }
}
```

A unit test re-runs `computeImpact(inputs.metrics, inputs.period)` and must reproduce `overall`
and every dimension exactly.

### 6.7 "How is this calculated?" text (UI, template)
> **Your impact score: {overall} ({band})** — a summary of signals from your GitHub activity in
> {periodLabel}, not a judgement of your performance.
>
> It combines four dimensions: **Delivery** {D} (PRs merged, cycle time, steady weeks),
> **Quality** {Q} (small PRs, reverts, merge rate), **Collaboration** {C} (PRs reviewed, review
> turnaround, review balance) and **Ownership** {O} (repositories where you both ship and
> review, breadth). Weights: 30 / 25 / 30 / 15.
>
> Each metric is compared with fixed reference ranges based on public engineering research —
> never with other people. Results from small samples are pulled toward the middle, and volume
> beyond a healthy level earns no extra points. Lines of code are not used.
> {if dimension unavailable: "{Dimension} wasn't scored this period because there wasn't enough data; the other dimensions were re-weighted."}
>
> Version {scoreVersion}. Only repositories you included are counted.

`ImpactScore.explanation` stores this text rendered for the period (plain text); the UI may add
links and the inputs table.

---

## 7. Evidence links (explainability)
Every metric value returned by the API includes `evidence`: the IDs of the records in its
numerator/sample (capped at 200 per metric; `evidenceTruncated: true` if more). The "Explain"
drawer lists them with links to GitHub. The same IDs feed the AI `EvidenceBuilder` (P08) as
stable refs (`PR-<number>@<repo>`, `REV-…`, `C-<sha7>`, `ACH-…`).

## 8. Where the LLM is used — and where it is not

| Use | LLM? |
|---|---|
| Any metric value, delta, impact score, dimension score, band label | **Never** |
| Metrics tables inside appraisal/promotion documents | **Never** — filled by the engine and merged into the document |
| Selecting which PRs are "significant" for a document | **Never** — deterministic `EvidenceBuilder` ranking (P08) |
| Narrative highlights for an impact score (F-29) | Yes — explicit request, cached per `(scoreVersion, inputsHash)`; must cite evidence refs; may not state numbers that are not present in the inputs |
| Resume bullets, appraisal and promotion prose | Yes — with mandatory citations; numbers must appear in the supplied metrics/evidence (eval-enforced, P08) |
| Achievement statements from a PR/commit (F-51) | Yes — fast model |
| Weekly digest summary (F-64) | Yes — fast model; numbers come from the engine |

## 9. Versioning
- `metrics@MAJOR.MINOR.PATCH` — bump MAJOR when a metric's meaning changes, MINOR when a metric is
  added, PATCH for bug fixes that change values. `impact@…` — bump on any change to components,
  anchors, weights, `k`, thresholds or rounding.
- Stored `ImpactScore` rows carry `scoreVersion`. A new version computes new rows lazily; old rows
  are retained for history display with a "calculated with an earlier version" note and purged
  after 13 months.
- The UI always shows the version in the explanation drawer.

## 10. Test obligations for P07
1. Golden dataset (documented in the test file) with hand-computed values for **every** metric in
   §3.1–§3.5 and the impact score (G-1, G-2, thresholds: `prs_merged + prs_reviewed = 2` → insufficient;
   `periodDays = 6` custom → invalid period).
2. `businessHours` cases: same day, across a weekend, across DST change in `Europe/Berlin` and
   `America/New_York`, `b ≤ a`.
3. Period boundaries: last day included; `Pacific/Auckland` and `America/Los_Angeles` month
   boundaries; leap year; ISO week 53.
4. Determinism: identical results across two runs; score changes only with `scoreVersion`.
5. Excluded repos change results; bot reviews don't set `firstReviewAt`; self-reviews ignored.
