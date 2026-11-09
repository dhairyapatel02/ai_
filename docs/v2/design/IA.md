# Information Architecture — DevImpact AI v2.0

*Phase 04 · 2026-11-09 · Status: **binding** for P09–P12 once the owner approves the prototype
(see [`../DECISIONS.md`](../DECISIONS.md) D-020). Routes here supersede the provisional ones in
[`../blueprint/TRACEABILITY.md`](../blueprint/TRACEABILITY.md) (updated in the same PR).*

Related: [FLOWS](FLOWS.md) · [SCREENS](SCREENS.md) · [DESIGN_SYSTEM](DESIGN_SYSTEM.md) ·
[prototype](prototype/) · [PRD §4–§5](../blueprint/PRD.md)

---

## 1. The core loop drives the structure

**Connect → See impact → Capture wins → Generate documents.**

| Loop stage | Where it lives | Entry points |
|---|---|---|
| Connect | `/onboarding/*` (first run), `/settings/integrations` | First sign-in, "Connect GitHub" empty states, reconnect banner |
| See impact | **Overview** group: Dashboard, Activity, KPIs (+ Impact detail), Career | Default landing page, global period picker |
| Capture wins | **Create** group: Achievements, Goals | "Add achievement" (dashboard header, ⌘K, `A`), "Turn into achievement" on any PR |
| Generate documents | **Create** group: Documents (library + studio + viewer) | "Draft appraisal" (dashboard), "Next step" card, "New" menu, ⌘K |

The navigation groups mirror the loop, so the sidebar reads as the product's story from top to
bottom. Settings are a third, quiet group.

## 2. Sitemap

```
/                              → redirect: /dashboard (signed in, onboarding done) | /onboarding (not done) | /sign-in
/sign-in                       Sign in (GitHub, Google; dev-only demo button)
/onboarding                    → redirect to the current step (UserSettings.onboardingStep)
  /onboarding/connect          Step 1 · Connect GitHub data (install GitHub App)
  /onboarding/pending          Step 1b · Organization approval pending (setupAction=request)
  /onboarding/repositories     Step 2 · Review repositories (include/exclude)
  /onboarding/sync             Step 3 · First sync with live progress
/integrations/github/callback  GitHub App setup/authorise callback (no UI beyond a spinner/error; routes to onboarding or settings)

OVERVIEW
/dashboard                     Dashboard                         ?period=
/activity                      Activity explorer                 ?period= &type= &repo= &q=   (+ detail drawer ?item=<feedItemId>)
/kpis                          KPIs (5 sections)                 ?period=  #delivery … #consistency  (+ explain drawer ?metric=<key>)
/kpis/impact                   Impact score detail               ?period=
/career                        Career timeline                   ?year=
/career/print                  Print view of the timeline        ?year=

CREATE
/documents                     Documents library                 ?type= &q= &sort=
/documents/new                 Choose a document type
/documents/new/appraisal       Appraisal studio                  ?period=
/documents/new/promotion       Promotion studio
/documents/new/resume          Resume studio
/documents/:id                 Document viewer / editor          ?version=
/achievements                  Achievements journal              ?category= &period=   (+ /achievements/new dialog route optional)
/goals                         Goals

SETTINGS
/settings                      → redirect: /settings/profile
/settings/integrations         GitHub connection, repositories, sync history, planned providers
/settings/profile              Name, time zone, roles, default period, sign-in methods, sessions
/settings/notifications        Weekly digest, sync problems, document ready
/settings/privacy              Repositories counted, AI redaction, export data, delete account
/settings/plan                 Plan & usage (no billing)

SYSTEM
/not-found (404)  ·  error boundary (500)  ·  /unsubscribe?token=  (public, no shell)
```

Changes from the provisional routes in TRACEABILITY §1: onboarding steps get their own paths;
`/documents/new` (type picker) and `/career/print` added; `/integrations/github/callback` named;
`/unsubscribe` named (public page for F-63). Everything else is unchanged.

> **Prototype note.** The Artifact host only passes plain `#name` fragments, so the prototype uses
> `#dashboard`, `#kpis`, `#impact`, `#account-integrations`… (names starting with `settings` are
> reserved by the host). The table in §8 maps each prototype hash to the real route.

## 3. Navigation model

### 3.1 Desktop (≥ 1024 px): grouped sidebar
- Fixed left sidebar, 240 px, `--sidebar` surface, hairline right border.
- Top: wordmark, then a search button that opens the command palette (`⌘K` hint).
- Groups with small labels: **Overview** (Dashboard, Activity, KPIs, Career) · **Create** (Documents,
  Achievements, Goals) · **Settings** (Integrations, Profile, Notifications, Privacy & data, Plan & usage).
- Active item: `--accent` wash + `--accent-foreground` text + `aria-current="page"`. Child routes
  (e.g. `/kpis/impact`, `/documents/:id`) keep their parent item active.
- Badges on items carry state, never counts for their own sake: a status dot on *Integrations* when
  the connection needs attention; a spinner on *Documents* while a generation runs in the background.
- Footer: sync status (dot + text, links to Integrations) and the account button (menu: Profile,
  Plan & usage, Keyboard shortcuts, Sign out).
- Collapsible to a 56 px icon rail (`[` shortcut) — Should, P09.

### 3.2 Top bar (all widths)
Left → right: (mobile: menu button) · breadcrumb/page title · **period picker** (only on pages
whose data depends on the period) · sync status chip (desktop) · search (mobile) · theme toggle ·
**New** menu (primary; hidden < 768 px where the page header carries the primary action).

### 3.3 Tablet (768–1023 px)
Sidebar hidden; menu button opens the same navigation in a left drawer. Content uses two-column
grids where they fit.

### 3.4 Mobile (< 768 px): bottom bar + drawer
- Bottom tab bar (56 px + safe-area): **Home** (Dashboard), **Activity**, **KPIs**, **Docs**, **More**
  (opens the navigation drawer with every destination, Settings and Sign out).
- Rationale: the four most frequent destinations are one tap away (Jakob's law, Fitts's law); the
  complete list is always one more tap (fixes UX-01). Create actions are in page headers and ⌘K.
- Dialogs become bottom sheets; drawers become full-screen sheets.

## 4. Global period control

The period is global state for Overview pages and lives in the URL (ADR-0010, API_CONTRACT §3.4):
`?period=month:2026-11 | quarter:2026-Q4 | half:2026-H2 | year:2026 | custom:2026-09-15..2026-11-08`.

| Rule | Behaviour |
|---|---|
| Default | No `?period` → the user's `defaultPeriodType` containing today (month by default). The URL is **not** rewritten, so "today's month" links stay evergreen |
| Scope | Applies to Dashboard, Activity, KPIs, Impact. Career uses `?year`. Documents choose their own period in the studio (pre-filled from the global period when opened from an Overview page) |
| Persistence | Navigating between Overview pages carries `?period` along (links are built with the current search params). Not persisted server-side; the default type is a Profile setting |
| Presets | This month · Last month · This quarter · Last quarter · This half · Last half · This year · Last year · Custom range |
| Custom | Two date inputs, 7–366 days, start not in the future; inline errors ("Choose at least 7 days"). Applied with a button, not on change |
| In-progress label | A period containing today shows an "In progress" badge; deltas compare **to the same elapsed point** of the previous period ("vs same point last month", KPI §3.7) |
| Display | Button label = period label (`November 2026`, `Q4 2026`, `H2 2026`, `Sep 15 – Nov 8, 2026`); mobile shows `Nov 2026` (never two-digit years — "Nov 26" reads as a date) |
| Shareability | The picker footer shows the URL form; copying the address bar reproduces the view (deep links, F-31) |
| Time zone | All periods are local dates in `UserSettings.timezone` (D-019). The time zone appears in explain drawers and Profile |

## 5. Command palette (⌘K / Ctrl K)

Opened from the sidebar search button, the mobile search icon, or the shortcut. Fuzzy search over:

| Group | Items |
|---|---|
| Go to | Every navigation destination (with `G` shortcuts shown as hints) |
| Actions | Sync GitHub now · New appraisal · New promotion packet · New resume bullets · Add achievement · Add goal · Change period… · Switch theme |
| Documents | The 5 most recently updated documents, then server search (`GET /documents?q=`) when the query has ≥ 2 characters |
| Help | How metrics work (opens KPIs explain for the impact score) · Keyboard shortcuts |

Pattern: `role="dialog"` with a `combobox` input controlling a `listbox`; ↑/↓ move, Enter runs,
Esc closes and returns focus to the trigger. Disabled actions (e.g. "Sync now" while a sync runs)
show the reason as a hint instead of disappearing.

### Keyboard shortcuts
`⌘K` palette · `G D` Dashboard · `G A` Activity · `G K` KPIs · `G C` Career · `G O` Documents ·
`A` Add achievement · `?` shortcut list · `Esc` close. Single-key shortcuts can be turned off in the
shortcut list (WCAG 2.1.4) and never fire while typing in a field.

## 6. URL and state conventions

| State | Where it lives |
|---|---|
| Page, period, filters, sort, year, selected version | URL (path + search params) — shareable, back-button friendly |
| Open drawer for an item/metric | URL search param (`?item=`, `?metric=`) so a drawer can be linked and Back closes it |
| Dialogs (add achievement, disconnect, delete) | Component state; not linkable (except optional `/achievements/new`) |
| Theme | `next-themes` (localStorage + `class` on `<html>`), system by default |
| Sidebar collapsed, "View as table" toggles, dismissed "Next step" cards | localStorage (per device conveniences) |
| Document drafts | Server (autosave → `PATCH /documents/:id`, versioned) |

## 7. Page-level primary actions

| Page | Primary action | Secondary |
|---|---|---|
| Dashboard | Draft appraisal (or the current "Next step") | Add achievement |
| Activity | — (exploration) | Turn into achievement (per item) |
| KPIs | — | Explain (per metric), Impact score |
| Impact detail | Generate highlights (AI, quick quota) | Explain components |
| Career | — | Print view |
| Documents | New document | Filters, search |
| Studio | Generate | — |
| Document viewer | Export | Edit, Regenerate, Versions |
| Achievements | Add achievement | Category filters |
| Goals | Add goal | — |
| Integrations | Sync now / Reconnect | Manage on GitHub, Disconnect |

## 8. Prototype hash → app route

| Prototype `#hash` | Route |
|---|---|
| `#sign-in` | `/sign-in` |
| `#onboarding-connect` · `#onboarding-pending` · `#onboarding-repos` · `#onboarding-sync` | `/onboarding/connect` · `/onboarding/pending` · `/onboarding/repositories` · `/onboarding/sync` |
| `#dashboard` · `#activity` · `#kpis` · `#impact` · `#career` | `/dashboard` · `/activity` · `/kpis` · `/kpis/impact` · `/career` |
| `#documents` · `#new-document` · `#new-appraisal` · `#new-promotion` · `#new-resume` · `#document` | `/documents` · `/documents/new` · `/documents/new/appraisal` · `/documents/new/promotion` · `/documents/new/resume` · `/documents/:id` |
| `#achievements` · `#goals` | `/achievements` · `/goals` |
| `#account-integrations` · `#account-profile` · `#account-notifications` · `#account-privacy` · `#account-plan` | `/settings/integrations` · `/settings/profile` · `/settings/notifications` · `/settings/privacy` · `/settings/plan` |
| `#server-error` · any unknown hash | 500 boundary · 404 |
