# Design System — DevImpact AI v2.0

*Phase 04 · 2026-11-09 · Status: **binding** for P09–P12 after owner approval (D-020).
Tokens: [`tokens.css`](tokens.css). Contrast checker: [`scripts/check-contrast.mjs`](scripts/check-contrast.mjs).
Living reference: the [prototype](prototype/) (Artifact link in [`../PROGRESS.md`](../PROGRESS.md)).*

Contents: 1 Principles · 2 Brand expression · 3 Token architecture · 4 Foundations (colour, contrast,
chart palettes, type, space, shape, elevation, motion, layout) · 5 Components · 6 Data visualisation ·
7 Iconography · 8 Voice, tone & microcopy · 9 State patterns · 10 Accessibility specification ·
11 Handoff to P09

---

## 1. Principles

1. **Evidence first.** Every number can be traced: an info button on every metric, evidence chips on
   every AI claim, engine-made tables labelled "Calculated by DevImpact — not written by AI".
2. **Calm, not celebratory.** No confetti, streak flames, leaderboards or red/green judgement of
   volume. Deltas are descriptive (neutral ink + arrow). Semantic colour is reserved for *system
   state* (sync, validation, destructive actions), never for how well someone performed.
3. **Honest about uncertainty.** "Not enough data" and "Low sample" are first-class states with
   their own copy, never zeros or blanks.
4. **Dense but airy.** Information-rich screens (tables, metric rows) on a 4 px grid with generous
   section spacing; hairline borders instead of heavy cards and shadows.
5. **Every state is designed.** Loading, empty, partial, error and success exist for every view
   ([SCREENS.md](SCREENS.md)); errors say what happened and what to do.
6. **Accessible by construction.** WCAG 2.2 AA tokens, visible focus, keyboard paths for every
   action, data tables behind every chart, reduced motion honoured.

## 2. Brand expression (D-017: calm, professional, Linear-like)

| Axis | Choice | Why it fits |
|---|---|---|
| Neutrals | Cool "slate-ink" greys with a slight indigo bias (`#f6f7f9` canvas, `#ffffff` cards / `#0e1014` canvas, `#15171d` cards) | Reads as a precise tool; the bias ties neutrals to the accent instead of a default grey |
| Accent | One indigo "ink" (`#4351c8` light / `#8d97f2` dark) | Restrained, credible in front of a manager; distinct from GitHub green and alert colours |
| Type | **Instrument Sans** (UI + headings) · **JetBrains Mono** (evidence refs, SHAs, formulas only) | Crisp grotesque with open apertures at 13–14 px; mono only where content is code-like (subject detail, not decoration) |
| Shape | Radius by role: 4 px chips · 6 px controls · 8 px cards · 12 px dialogs | Hierarchy through shape, not one radius everywhere |
| Lines | 1 px hairlines, borders over shadows; shadows only on floating layers | Linear-like flatness, prints well |
| Motion | 80–320 ms, ease-out entering, no bouncing; one orchestrated moment — the streaming document | Movement explains change, never decorates |
| Signature | The **evidence chip** (`payments-api #1935`, mono, hairline) attached to every AI claim and metric | The product's thesis — "every claim backed by a PR" — made visible |

## 3. Token architecture

Three tiers, all in [`tokens.css`](tokens.css):

| Tier | Prefix / location | Example | Used by |
|---|---|---|---|
| Reference | `--ref-*` in `:root` | `--ref-indigo-600: #4351c8` | Only semantic tokens |
| Semantic | shadcn names + DevImpact additions in `:root` and `.dark` | `--primary`, `--surface-2`, `--subtle-foreground`, `--chart-1`, `--heat-3` | Components (via Tailwind utilities) |
| Tailwind theme | `@theme inline { --color-*: var(--*) }` | `bg-surface-2`, `text-subtle-foreground`, `border-input`, `rounded-md`, `shadow-md` | JSX |

- Dark mode: `.dark` on `<html>` (next-themes `attribute="class"`, `defaultTheme="system"`,
  `disableTransitionOnChange`). Add `@custom-variant dark (&:where(.dark, .dark *));` in globals.
- **Never** hard-code hex values or Tailwind palette colours (`text-red-500`, `bg-green-100`) in
  components — fixes UX-11. A lint rule (P09) can forbid palette classes outside `components/ui`.
- Token names are stable API: renaming one is a design-system change logged in DECISIONS.md.

## 4. Foundations

### 4.1 Colour — semantic roles

| Token | Light | Dark | Role |
|---|---|---|---|
| `--background` | `#f6f7f9` | `#0e1014` | App canvas |
| `--surface` / `--card` | `#ffffff` | `#15171d` | Cards, sidebar content, inputs |
| `--surface-2` / `--muted` / `--secondary` | `#eff1f4` | `#1c1f27` | Hover rows, wells, skeletons, badges, empty heat cells |
| `--surface-3` | `#e6e9ee` | `#242833` | Pressed / selected rows, progress track |
| `--popover` | `#ffffff` | `#1a1d24` | Menus, popovers, dialogs, tooltips |
| `--sidebar` | `#fbfbfc` | `#111318` | Sidebar background |
| `--foreground` | `#12141a` | `#e8eaef` | Primary text, numbers |
| `--muted-foreground` | `#575e6b` | `#a3a9b6` | Secondary text, labels |
| `--subtle-foreground` | `#636a77` | `#8b919e` | Tertiary: timestamps, captions, placeholders, axis text |
| `--border` | `#e1e4ea` | `#262a34` | Decorative hairlines (cards, dividers) |
| `--border-strong` | `#c9ced6` | `#353a46` | Table header rules, outline buttons, chips |
| `--input` | `#828999` | `#646b7a` | Form-control boundary (≥ 3:1, WCAG 1.4.11) |
| `--primary` / `--primary-hover` | `#4351c8` / `#3843b0` | `#8d97f2` / `#a2aaf5` | Primary buttons, switch on, progress, selected markers |
| `--primary-foreground` | `#ffffff` | `#0e1014` | Text on primary |
| `--accent` / `--accent-foreground` | `#eceefc` / `#3e4bc0` | `#1f2340` / `#b3b9f7` | Active nav item, selected chips, soft emphasis |
| `--link` | `#3e4bc0` | `#a5adf6` | Inline links (always underlined) |
| `--ring` | `#4f5bd5` | `#8d97f2` | Focus ring |
| `--success` / `--success-soft` | `#17784a` / `#e7f5ee` | `#4cc38a` / `#12281e` | Sync ok, goal on target, saved |
| `--warning` / `--warning-soft` | `#8a5a00` / `#fbf3e1` | `#e5b54a` / `#2b2410` | Needs reconnection, rate limited, uncited claim, low sample |
| `--destructive` / `--destructive-soft` | `#c2352b` / `#fcecea` | `#f07a70` / `#2e1714` | Errors, failed sync, delete |
| `--info` / `--info-soft` | `#3e4bc0` / `#eceefc` | `#a5adf6` / `#1f2340` | Informational banners (backfill in progress) |

**Rules.**
- Status colour always comes with an icon **and** text ("Needs reconnection"), never colour alone.
- Metric deltas use `--foreground`/`--muted-foreground` with ↗ ↘ — arrows, not colour — because a
  drop in commits is not "bad". (Exception: none in v2.0.)
- Score bands use the accent ramp only (no traffic lights): Low signal · Moderate · Strong · Very strong.
- The accent appears at most once as a solid fill per view region (one primary button per area).

### 4.2 Typography

Load with `next/font/google`: `Instrument_Sans({ subsets: ['latin'], variable: '--font-sans', weight: ['400','500','600','700'] })`
and `JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', weight: ['400','500'] })`.

| Token / utility | Size / line | Weight | Use |
|---|---|---|---|
| `text-4xl` | 48 / 52, −0.025em | 600 | Impact score on `/kpis/impact` |
| `text-3xl` | 36 / 40, −0.025em | 600 | Impact score on dashboard card |
| `text-2xl` | 28 / 34, −0.015em | 600 | Page title (h1); stat values (desktop) |
| `text-xl` | 22 / 28, −0.015em | 600 | Mobile h1, stat values (mobile), dialog title |
| `text-lg` | 18 / 26 | 600 | Section titles inside documents; metric values |
| `text-md` | 16 / 24 | 400 | Document reading body (15.5–16 px, 1.65), mobile form inputs |
| `text-base` | 14 / 20 | 400 / 500 | **UI default**: body, buttons, nav, table cells (13 px in dense tables) |
| `text-sm` | 13 / 18 | 400 / 500 | Secondary text, labels, chips, dense tables |
| `text-caption` | 12 / 16 | 400 / 500 | Captions, badges, axis ticks, timestamps |
| `font-mono` | 11.5–12 px | 400 | Evidence refs, SHAs, formulas, metric keys, `?period=` |

- Numbers that align in columns use `tabular-nums`; hero numbers keep proportional figures.
- Headings use `text-wrap: balance`; body ≤ 70 ch (`--reading-max` 720 px for documents).
- Sentence case everywhere except proper nouns; no all-caps labels.

### 4.3 Spacing, layout and breakpoints
- 4 px base (Tailwind default scale). Common steps: 4, 8, 12, 16, 20, 24, 32, 48.
- Page gutter 24 px (≥ 1024) / 16 px (< 1024), plus safe-area insets. Content max width 1280 px;
  documents and settings forms 720–760 px.
- Card padding 16 px; card header 14 px top; list rows ≥ 48 px tall; table cells 10 × 12 px.
- Grids: dashboard 4 stat cards → 2 columns < 1024 → 2 columns (compact) < 768; main/side 2:1 →
  stacked < 1024; settings single column.
- Breakpoints: `sm` 640 · `md` 768 (bottom bar below) · `lg` 1024 (sidebar at and above) · `xl` 1280.
  Minimum supported width 360 px (PRD says 390; designs are checked at 390 and survive 360).

### 4.4 Contrast — checked pairs (WCAG 2.2 AA)

Generated by `node docs/v2/design/scripts/check-contrast.mjs --md` from `tokens.css`.
Text ≥ 4.5:1 (all UI text is < 18.66 px bold, so the large-text exception is not relied on);
non-text UI ≥ 3:1 (1.4.11); the heatmap's lowest step uses the ordinal floor 2:1 (cells always have
a tooltip and a table alternative, so colour is not the only carrier).

| Pair (foreground on background) | Role | Min | Light | Dark | Result |
|---|---|---|---|---|---|
| `foreground` on `background` | Body text on canvas | 4.5:1 | 17.17 (#12141a / #f6f7f9) | 15.82 (#e8eaef / #0e1014) | ✅ |
| `foreground` on `surface` | Body text on card | 4.5:1 | 18.41 (#12141a / #ffffff) | 14.88 (#e8eaef / #15171d) | ✅ |
| `foreground` on `surface-2` | Body text on sunken/hover | 4.5:1 | 16.27 (#12141a / #eff1f4) | 13.69 (#e8eaef / #1c1f27) | ✅ |
| `foreground` on `surface-3` | Body text on selected row | 4.5:1 | 15.13 (#12141a / #e6e9ee) | 12.23 (#e8eaef / #242833) | ✅ |
| `muted-foreground` on `background` | Secondary text on canvas | 4.5:1 | 6.09 (#575e6b / #f6f7f9) | 8.08 (#a3a9b6 / #0e1014) | ✅ |
| `muted-foreground` on `surface` | Secondary text on card | 4.5:1 | 6.52 (#575e6b / #ffffff) | 7.60 (#a3a9b6 / #15171d) | ✅ |
| `muted-foreground` on `surface-2` | Secondary text on sunken/hover | 4.5:1 | 5.77 (#575e6b / #eff1f4) | 6.99 (#a3a9b6 / #1c1f27) | ✅ |
| `subtle-foreground` on `background` | Tertiary text on canvas | 4.5:1 | 5.08 (#636a77 / #f6f7f9) | 6.02 (#8b919e / #0e1014) | ✅ |
| `subtle-foreground` on `surface` | Tertiary text on card | 4.5:1 | 5.44 (#636a77 / #ffffff) | 5.67 (#8b919e / #15171d) | ✅ |
| `subtle-foreground` on `surface-2` | Tertiary text on sunken (placeholder in filled input) | 4.5:1 | 4.81 (#636a77 / #eff1f4) | 5.21 (#8b919e / #1c1f27) | ✅ |
| `sidebar-foreground` on `sidebar` | Nav text on sidebar | 4.5:1 | 17.80 (#12141a / #fbfbfc) | 15.44 (#e8eaef / #111318) | ✅ |
| `sidebar-accent-foreground` on `sidebar-accent` | Active nav item | 4.5:1 | 6.12 (#3e4bc0 / #eceefc) | 8.16 (#b3b9f7 / #1f2340) | ✅ |
| `primary-foreground` on `primary` | Primary button label | 4.5:1 | 6.46 (#ffffff / #4351c8) | 7.11 (#0e1014 / #8d97f2) | ✅ |
| `primary-foreground` on `primary-hover` | Primary button label (hover) | 4.5:1 | 8.08 (#ffffff / #3843b0) | 8.71 (#0e1014 / #a2aaf5) | ✅ |
| `accent-foreground` on `accent` | Selected chip / soft accent | 4.5:1 | 6.12 (#3e4bc0 / #eceefc) | 8.16 (#b3b9f7 / #1f2340) | ✅ |
| `link` on `surface` | Link on card | 4.5:1 | 7.06 (#3e4bc0 / #ffffff) | 8.45 (#a5adf6 / #15171d) | ✅ |
| `link` on `background` | Link on canvas | 4.5:1 | 6.59 (#3e4bc0 / #f6f7f9) | 8.98 (#a5adf6 / #0e1014) | ✅ |
| `secondary-foreground` on `secondary` | Secondary button label | 4.5:1 | 16.27 (#12141a / #eff1f4) | 13.69 (#e8eaef / #1c1f27) | ✅ |
| `destructive-foreground` on `destructive` | Destructive button label | 4.5:1 | 5.47 (#ffffff / #c2352b) | 7.00 (#0e1014 / #f07a70) | ✅ |
| `destructive` on `surface` | Error text on card | 4.5:1 | 5.47 (#c2352b / #ffffff) | 6.59 (#f07a70 / #15171d) | ✅ |
| `destructive` on `destructive-soft` | Error text in error banner | 4.5:1 | 4.77 (#c2352b / #fcecea) | 6.18 (#f07a70 / #2e1714) | ✅ |
| `success` on `surface` | Success text on card | 4.5:1 | 5.49 (#17784a / #ffffff) | 8.09 (#4cc38a / #15171d) | ✅ |
| `success` on `success-soft` | Success text in banner | 4.5:1 | 4.89 (#17784a / #e7f5ee) | 7.03 (#4cc38a / #12281e) | ✅ |
| `warning` on `surface` | Warning text on card | 4.5:1 | 5.93 (#8a5a00 / #ffffff) | 9.42 (#e5b54a / #15171d) | ✅ |
| `warning` on `warning-soft` | Warning text in banner | 4.5:1 | 5.37 (#8a5a00 / #fbf3e1) | 8.10 (#e5b54a / #2b2410) | ✅ |
| `info` on `info-soft` | Info text in banner | 4.5:1 | 6.12 (#3e4bc0 / #eceefc) | 7.22 (#a5adf6 / #1f2340) | ✅ |
| `input` on `surface` | Form control border on card | 3:1 | 3.51 (#828999 / #ffffff) | 3.35 (#646b7a / #15171d) | ✅ |
| `input` on `background` | Form control border on canvas | 3:1 | 3.27 (#828999 / #f6f7f9) | 3.56 (#646b7a / #0e1014) | ✅ |
| `ring` on `surface` | Focus ring on card | 3:1 | 5.54 (#4f5bd5 / #ffffff) | 6.69 (#8d97f2 / #15171d) | ✅ |
| `ring` on `background` | Focus ring on canvas | 3:1 | 5.17 (#4f5bd5 / #f6f7f9) | 7.11 (#8d97f2 / #0e1014) | ✅ |
| `primary` on `surface` | Primary button / switch-on / selected marker vs card | 3:1 | 6.46 (#4351c8 / #ffffff) | 6.69 (#8d97f2 / #15171d) | ✅ |
| `success` on `surface` | Status dot (ok) vs card | 3:1 | 5.49 (#17784a / #ffffff) | 8.09 (#4cc38a / #15171d) | ✅ |
| `warning` on `surface` | Status dot (warning) vs card | 3:1 | 5.93 (#8a5a00 / #ffffff) | 9.42 (#e5b54a / #15171d) | ✅ |
| `destructive` on `surface` | Status dot (error) vs card | 3:1 | 5.47 (#c2352b / #ffffff) | 6.59 (#f07a70 / #15171d) | ✅ |
| `chart-1` on `surface` | Chart series 1 | 3:1 | 5.54 (#4f5bd5 / #ffffff) | 5.13 (#7480ea / #15171d) | ✅ |
| `chart-2` on `surface` | Chart series 2 | 3:1 | 3.33 (#0e9f84 / #ffffff) | 5.45 (#16a083 / #15171d) | ✅ |
| `chart-3` on `surface` | Chart series 3 | 3:1 | 3.50 (#b57f00 / #ffffff) | 5.87 (#c08a10 / #15171d) | ✅ |
| `chart-5` on `surface` | Single-series emphasis / line | 3:1 | 6.46 (#4351c8 / #ffffff) | 6.69 (#8d97f2 / #15171d) | ✅ |
| `heat-1` on `surface` | Heatmap lowest active step (ordinal floor 2:1) | 2:1 | 2.39 (#9aa2ee / #ffffff) | 2.43 (#3f4bb0 / #15171d) | ✅ |

Disabled controls (50 % opacity) are exempt from 1.4.3 but always carry a reason in text nearby.

### 4.5 Chart palettes (validated)

Validated with the dataviz skill's `validate_palette.js` (OKLab ΔE, Machado CVD simulation):

| Palette | Light (on `#ffffff`) | Dark (on `#15171d`-class `#14161c`) | Result |
|---|---|---|---|
| Categorical (3 series, `--chart-1..3`) | `#4f5bd5` indigo · `#0e9f84` teal · `#b57f00` amber | `#7480ea` · `#16a083` · `#c08a10` | **All checks pass, all-pairs**: lightness band, chroma ≥ 0.10, CVD ΔE worst 11.8 light / 10.9 dark (target ≥ 8), normal-vision ΔE worst 18.5 / 18.8 (floor 15), contrast ≥ 3:1 |
| Sequential heat ramp (`--heat-1..4`) | `#9aa2ee → #6b76e2 → #4350c8 → #2b358f` | `#3f4bb0 → #5562d0 → #7d88ec → #b0b7f7` | **Ordinal checks pass**: monotone lightness, adjacent ΔL ≥ 0.06, single hue (spread 6°), lightest step 2.39:1 / 2.45:1 |
| Single-series emphasis (`--chart-5`) | `#4351c8` | `#8d97f2` | ≥ 3:1 on surface |
| De-emphasis (`--chart-muted`, `--chart-4`) | `#a9afba`, `#828999` | `#4f5562`, `#646b7a` | Sparklines and "Other"/previous period only; never the only identity carrier |

Assignment is **fixed, never cycled**: Commits = 1, PRs merged = 2, Reviews = 3 — the same in every
chart. A fourth series folds into "Other" (`--chart-4`) or becomes a small multiple.

### 4.6 Shape and elevation

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | 4 px | Badges, chips, refs, kbd, bar ends (heat cells 2 px) |
| `--radius-sm` | 6 px | Buttons, inputs, selects, menu items, segmented controls |
| `--radius-md` | 8 px | Cards, popovers, banners, toasts |
| `--radius-lg` | 12 px | Dialogs, sheets, command palette |
| `--shadow-xs/sm` | — | Inputs on focus, selected segment |
| `--shadow-md` | — | Popovers, menus, toasts, tooltips |
| `--shadow-lg` | — | Dialogs, drawers |

Cards rest on borders, no shadow. Dark mode adds a faint 1 px white ring to floating layers.

### 4.7 Motion

| Token | Duration | Easing | Use |
|---|---|---|---|
| `--duration-instant` | 80 ms | ease-out | Hover / press colour |
| `--duration-fast` | 140 ms | ease-out | Menus, tooltips, switches, popovers (fade + 2 % scale) |
| `--duration-base` | 200 ms | ease-out in / ease-in out | Drawers (24 px slide), dialogs, sheets, accordions |
| `--duration-slow` | 320 ms | ease-out | Progress bars, onboarding stage transitions |

- Streaming text appears at reading pace with a 2 px caret; completed sections settle without movement.
- No entrance animations on page load; skeleton shimmer is the only ambient motion.
- `prefers-reduced-motion: reduce` → durations 0, no shimmer, no caret blink, no spinner rotation
  (static icon + text), streaming shows whole sections at once.

## 5. Component inventory (→ shadcn/ui)

States for every interactive component: default, hover, focus-visible (2 px `--ring`, 2 px offset),
active, disabled (50 % + reason), loading where async. All targets ≥ 24 × 24 px (2.5.8); primary
touch targets ≥ 40 px on mobile.

### 5.1 shadcn primitives (install in P09)

| Component | shadcn | Variants | Notes / states |
|---|---|---|---|
| Button | `button` | `default` (primary), `secondary` (outline on surface), `ghost`, `destructive`, `destructive-outline`, `link`; sizes `sm` 28, `default` 32, `lg` 40, `icon` | Loading: spinner replaces leading icon, label stays ("Generating…"), `aria-busy`. Labels are verb + object, sentence case |
| Badge | `badge` | `neutral`, `accent`, `success`, `warning`, `danger`, `outline` | 22 px, 12 px text; status badges always include an icon |
| Card | `card` | flat (border) | Header (title + meta + action), body, footer |
| Input / Textarea / Label | `input`, `textarea`, `label` | — | Visible label always; helper text below; error: `aria-invalid`, red border, message with icon linked by `aria-describedby` (fixes UX-08) |
| Select | `select` | — | Native `<select>` acceptable for simple lists on mobile |
| Switch | `switch` | — | 40 × 24; label is the setting name; saves immediately with a "Saved" toast |
| Radio group | `radio-group` | `card` style for consequential choices (disconnect keep/purge) | |
| Segmented control | `toggle-group` (`type="single"`) | — | Role, format, year, default period |
| Tabs | `tabs` | underline | KPI section jump links use anchors, not tab panels |
| Dialog / Alert dialog | `dialog`, `alert-dialog` | — | Bottom sheet < 768 px; destructive confirmations use alert-dialog with typed confirmation where irreversible |
| Sheet | `sheet` | `right` (detail, explain drawers, 520 px), `left` (mobile nav, 300 px) | Full-screen < 768 px |
| Popover | `popover` | — | Period picker, citation popover |
| Dropdown menu | `dropdown-menu` | — | New, Export, Regenerate, account, row actions |
| Command | `command` | — | ⌘K palette (cmdk) |
| Tooltip | `tooltip` | — | Only supplementary text; never the only place information lives |
| Toast | `sonner` | success, error, info, with action (Undo / Open / View) | Bottom-right; above bottom bar on mobile; `aria-live` polite (errors assertive) |
| Skeleton | `skeleton` | — | Shapes mirror the final layout |
| Progress | `progress` | — | Sync, quota meters, goals |
| Table | `table` | dense (13 px) | Becomes stacked rows < 768 px |
| Separator, Scroll area, Avatar, Collapsible, Accordion | `separator`, `scroll-area`, `avatar`, `collapsible`, `accordion` | — | Accordion for sync-run error details |
| Calendar + date range | `calendar` (react-day-picker) | — | Custom period range; native date inputs acceptable fallback |
| Form | `form` (react-hook-form + zod resolver) | — | Zod schemas from `packages/shared` |
| Sidebar | `sidebar` | grouped, collapsible rail | Desktop shell |
| Breadcrumb | `breadcrumb` | — | Top bar |
| Chart | `chart` (Recharts wrapper) | — | Uses `--chart-*` tokens; see §6 |

### 5.2 Custom components (build in P09–P11)

| Component | Purpose | Anatomy / behaviour |
|---|---|---|
| `AppShell` | Grouped sidebar + top bar + bottom bar + drawer | §3 of IA.md; skip link; `main` landmark focus on route change |
| `PeriodPicker` | Global period (URL state) | Preset list with check, custom range form with validation, URL footer; label + "In progress" badge |
| `SyncStatus` | Chip + sidebar footer item | Dot + text from `GET /sync/status`; states: synced (relative time), syncing (%), paused until HH:MM, needs reconnection, failed, not connected |
| `StatCard` | Dashboard stat | Label + info button, value, delta (neutral arrow + "vs same point last month"); states: loading, insufficient, no comparison |
| `DeltaText` | Descriptive change | Arrow icon + visually hidden "up/down" + bold amount + comparison label |
| `MetricRow` | KPI list row | Name + Scored/Low sample badges, definition, value + n, delta, sparkline, explain button; insufficient: "Not enough data · n = 2 of 3 needed" |
| `ExplainDrawer` | "How is this calculated?" | Definition, value/n/min n, good range, formula (mono), 6-month chart + table, caveats, anti-gaming, evidence list |
| `ImpactScoreCard` / `ImpactBands` / `DimensionBars` | Score display | Number + `/ 100` + band badge, 4-segment band scale, four labelled bars with values; insufficient state |
| `EvidenceChip` (`ref`) | Citation | Mono short ref (`payments-api #1935`), full ref in `aria-label`, opens popover (title, repo, date, GitHub link); flagged variant "No evidence linked" |
| `ActivityHeatmap` | 12-month contributions | 53 × 7 grid, 11 px cells, 5 levels by quartile of active days, month labels, tooltip per cell, scrolls to newest on small screens, "View as table" (monthly totals) |
| `ActivityChart` | Stacked columns | Day ≤ 45 days, week ≤ 200 days, month above; legend + tooltip + table |
| `Sparkline` | 6-month trend | 96 × 28, de-emphasis line, accent end dot, gaps for insufficient months, `aria-hidden` (value is in the row) |
| `FeedItem` | Unified activity row | Icon by type, verb + title, repo/meta, time; opens detail drawer |
| `ItemDrawer` | PR / review / commit / achievement detail | Metrics wells, timeline, "Turn into achievement", GitHub link |
| `NextStepCard` | Next best action | One recommendation with reason ("Shown because…"), primary + "Not now" |
| `OnboardingStepper` / `SyncStages` | Wizard | 3 labelled bars with `aria-current="step"`; stage list with done/active/pending icons + counts; progressbar with value |
| `DocumentRenderer` / `DocumentEditor` | Rendered document | Section headings, claims with chips, engine tables with badge; edit mode = per-section rich text (Tiptap or contenteditable) with autosave status |
| `StreamingStatus` | Generation progress | "Writing section 2 of 5 · Key accomplishments", Stop button, polite announcement per section |
| `VersionList` | Document history | v N · source · date · Restore |
| `QuotaMeter` | AI usage | Label, used of limit, bar, reset date |
| `EmptyState` / `ErrorState` | Designed states | Icon tile, title, one-sentence reason, primary + secondary action, request ID for errors |
| `Banner` | Page-level status | info / warning / danger; icon, title, body, actions |
| `PlannedProviderCard` | GitLab/Jira/Linear | Dashed border, "Planned for v2.1", **no** button (D-018) |

## 6. Data visualisation rules

Grounded in the dataviz method: pick the form first, colour last; validated palettes; legends for
≥ 2 series; hover layer by default; table view always.

| Metric / question | Form | Notes |
|---|---|---|
| Dashboard numbers (commits, PRs merged, PRs reviewed, impact) | **Stat tile** (no chart) | Value + delta + comparison label |
| Activity over the period | **Stacked columns** (commits, PRs merged, reviews) | Bars ≤ 24 px, 4 px rounded top, 2 px surface gap between segments, interval auto (day/week/month) |
| Contributions over 12 months | **Calendar heatmap** | Sequential indigo ramp, quartile buckets of active days, weekends shown but labelled "never scored" |
| Impact score history | **Line** (single series, 0–100 fixed axis, ticks at band edges 40/60/80) | Gaps for insufficient months, end-value label, markers r = 4 with 2 px surface ring |
| Dimension scores | **Horizontal bars** 0–100 with value labels | One hue (accent); labels carry identity — no categorical colours needed |
| Score band | **Segmented band scale** (4 segments) | Current band filled; labels beneath |
| KPI trend per metric | **Sparkline** (6 months) | Context only; the drawer shows a proper column chart + table |
| Metric over months (drawer) | **Columns** single series | Values in tooltip and table |
| Quota, goals, sync | **Meter / progress** | Text "3 of 15" always visible |

**Axes & grid.** One y-axis only (never dual). Gridlines hairline `--chart-grid`, baseline
`--chart-axis`; 3 ticks (0, mid, max) rounded to clean numbers; x labels thinned to fit (≥ 56–64 px
apart). Text uses `--subtle-foreground`, never the series colour.

**Legends & labels.** Legend above the plot for ≥ 2 series; single series named by the card title.
Direct labels only for the endpoint/extreme. Never a number on every bar.

**Tooltips.** Crosshair band on hover, tooltip lists every series + total, follows the pointer and
flips at edges. Tooltips are supplementary: every chart has a "View as table" toggle and an
`aria-label` summary ("Stacked columns of commits, PRs merged and reviews per day for November 2026").

**Number formatting** (locale-aware via `Intl.NumberFormat`, English UI):

| Unit | Display | Example |
|---|---|---|
| count | integer, thousands separator; compact ≥ 10,000 on axes | `1,284` · axis `12K` |
| hours (business) | 1 decimal + " h" | `30.0 h`, `6.4 h` |
| ratio | integer % | `83%` (delta in points: `↗ 9 pts`) |
| score | integer 0–100, half-up rounding (KPI §6.4) | `78 / 100` |
| repos / days / weeks | integer + unit word where ambiguous | `3 repositories` |
| dates | `Nov 9, 2026`; same year `Nov 9`; weekday in feeds `Mon, Nov 9`; ranges `Sep 15 – Nov 8, 2026` | never `11/9/2026` |
| times | 24-hour `16:32` in the user's time zone | "Paused until 16:32" |
| relative | `12 min ago`, `3 h ago`, `yesterday`, then date | sync status, feed today |
| missing | `—` with an explanation nearby ("Not enough data") | never `0` for unknown |

## 7. Iconography

- **lucide** (`lucide-react`, already a dependency), 16 px in UI, 20 px in the bottom bar and empty
  states, stroke 1.75, `currentColor`, `aria-hidden` (the adjacent text names the thing).
- Icon-only buttons need an `aria-label` and a tooltip.
- Fixed meanings: `git-merge` PR merged · `git-pull-request` opened · `git-pull-request-closed` closed ·
  `message-square-text` review · `git-commit-horizontal` commit · `award` achievement · `target` goal ·
  `gauge` impact/KPIs · `info` explain · `sparkles` AI action (only on buttons that call Claude) ·
  `calculator` engine-made · `triangle-alert` warning · `circle-alert` error · `circle-check` success ·
  `refresh-cw` sync · `plug` integration · `lock` private repository.
- No emoji in the UI.

## 8. Voice, tone & microcopy

**Voice:** a precise, supportive colleague who has the data. Plain words, short sentences, second
person, sentence case. Specific numbers over adjectives. Never hype, never judgement.

| Context | Tone | Example |
|---|---|---|
| Routine | Efficient | "Saved" · "Sync finished — 3 new items." |
| First run | Patient, concrete | "DevImpact reads your pull requests, reviews and commits (read-only) and turns them into KPIs you can explain. It takes about 3 minutes." |
| Metrics | Neutral, framed as signal | "Signal from your GitHub activity — not a judgement of your performance." |
| Waiting | Legible | "Writing section 2 of 5 · Key accomplishments" |
| Errors | Calm, actionable, no blame, no apology | "Couldn't load your dashboard. The DevImpact API didn't respond. Your data is safe. [Try again]" |
| Destructive | Serious, explicit | "Delete your account? Everything is deleted immediately and can't be recovered." |

**Rules.**
- Buttons: verb + object ("Generate", "Export", "Add achievement", "Reconnect GitHub", "Delete account").
  Never "OK", "Submit", "Click here". The same action keeps the same name through the flow
  ("Generate" → "Appraisal ready").
- Empty states: what's missing + why it matters + one action. Errors: what failed + likely cause +
  what to do (+ request ID for system errors). Validation: field + requirement ("Choose at least 7 days").
- Numbers: numerals always; units spelled as in §6. No "!" except never.
- Metric names, definitions, caveats and band labels come verbatim from
  [KPI_METHODOLOGY](../blueprint/KPI_METHODOLOGY.md) (served by `GET /metrics/definitions`).
- Don't say "AI-powered" in UI chrome; mark AI actions with the `sparkles` icon and say what they do.
- Fairness copy appears where numbers appear: "Lines of code are never used as a KPI." ·
  "Weekends are shown but never scored."
- Quota copy names the reset date: "You've used all 15 generations for November. They reset on December 1."

## 9. State patterns (applies to every screen — see SCREENS.md per screen)

| State | Pattern |
|---|---|
| **Loading** | Route-level `loading.tsx` skeleton mirroring the layout (cards, rows, chart blocks), shimmer, `aria-busy`; visually hidden "Loading…" status. Never a lone full-page spinner (UX-07). Keep previous data visible when only the period changes (TanStack `placeholderData`) with a thin top progress bar |
| **Empty — no integration** | Checklist/empty state with "Connect GitHub" primary action; no zero-filled cards |
| **Empty — syncing** | Info banner with progress and the recent-first message; panels show data for what's ready and hatch heatmap cells still importing |
| **Empty — no data in range** | Per-panel message: "No activity in Q3 2026" + "Try a longer period" chip; metric rows show "Not enough data · n = 0 of 3" |
| **Partial** | Show what's available; label low samples; impact score shows re-weighting note; failed repositories listed in sync history |
| **Error** | `error.tsx` boundary per route with Retry + request ID; inline panel errors for independent widgets so one failing query doesn't blank the page; toasts for action failures; never show raw upstream JSON (UX-05) |
| **Success** | Toast with result and next step (Open/View/Undo); inline "Saved · v3" for autosave |
| **Rate limited / quota** | Disabled primary action with reason and reset time; 429 toast with retry time |

## 10. Accessibility specification (WCAG 2.2 AA)

**Landmarks & structure.** `header` (top bar), `nav` "Main" (sidebar) and "Primary" (bottom bar),
`main#main` (focus target on route change), one `h1` per page, section `h2`s, skip link as first
focusable element. `<html lang="en">`.

**Focus order.** Skip link → sidebar search → nav items (in group order) → sync status → account →
top bar (menu, breadcrumb links, period, theme, New) → page header actions → content in visual
order. Drawers/dialogs trap focus, focus the first field (forms) or the close button (read-only),
and return focus to the trigger on close. Popovers: ↑/↓ moves between items, Esc closes and returns
focus. After route change focus moves to `main` (without scrolling jumps). Focus is never hidden
under the sticky top bar (2.4.11: `scroll-padding-top: var(--topbar-height)`).

**Keyboard.** Every action reachable without a pointer; ⌘K palette; `G` + key navigation; `A` add
achievement; `?` shortcut list; single-key shortcuts can be turned off (2.1.4) and are ignored in
fields. Charts are not keyboard-interactive; their data is in the table toggle.

**ARIA for components.**
- Charts: `role="img"` + descriptive `aria-label` summary; "View as table" button with
  `aria-expanded` revealing a real `<table>` with caption. Heatmap container is focusable when it
  scrolls. Tooltips are `aria-hidden` (mouse convenience only). Sparklines `aria-hidden`.
- Period picker: button `aria-haspopup="dialog"` + `aria-expanded`; presets are buttons with a
  visible check for the current one.
- Filters: chips are toggle buttons with `aria-pressed`.
- Switches: `role="switch"` + `aria-checked` + label.
- Stepper: `<ol>` with `aria-current="step"`; progress: `role="progressbar"` with `aria-valuenow/min/max`.
- Streaming: a polite live region announces "Writing section 2 of 5" once per section and
  "Appraisal ready, 96% of claims cited" at the end; the document body itself is not live.
- Toasts: `role="status"` (errors `role="alert"`); actionable toasts stay ≥ 7 s and their action is
  also available elsewhere (Undo on the list item, Open in Documents).
- Evidence chips: buttons with `aria-label="Evidence PR-harbor-io/payments-api#1935"`.
- Deltas: arrow icons are `aria-hidden`; a visually hidden "up"/"down" precedes the amount.
- Status: colour + icon + text everywhere (1.4.1).

**Contrast.** §4.4 (39 pairs pass in both themes). Focus ring 2 px `--ring` + 2 px offset (≥ 3:1
against both surfaces).

**Target size.** ≥ 24 × 24 px for every control (info buttons 28, chips 28, switches 40 × 24, refs 24
outside prose; inline citation chips in sentences use the inline exception). Mobile primary targets ≥ 40 px.

**Forms.** Visible labels, helper text, inline errors on submit/blur linked via `aria-describedby`,
focus moves to the first invalid field, `autocomplete` on name/email, no placeholder-only labels,
16 px inputs on mobile.

**Reflow & zoom.** Layout works at 320 CSS px (400 % zoom) without horizontal page scroll; only
tables/heatmap scroll inside their own containers. Text spacing overrides don't clip.

**Reduced motion.** §4.7. **Authentication** (3.3.8): OAuth only, no cognitive tests.
**Consistent help** (3.2.6): "How is this calculated?" and the shortcut list live in the same places.

**Verification done in P04:** axe-core 4.10 (WCAG 2.0/2.1/2.2 A + AA rules) on 18 prototype routes
× light/dark × 1440/390 → **0 violations** after fixes; Playwright overflow check on 25 routes at 1440
and 390 → no horizontal overflow; keyboard pass on palette, drawers, dialogs, popovers. P14 repeats
this on the real app (Playwright + axe in CI).

## 11. Handoff to P09

- **Token file:** `docs/v2/design/tokens.css` → copy to `apps/web/src/styles/tokens.css` and import after
  `@import "tailwindcss";`. Keep the checker working (update its path) and run it in CI.
- **Fonts:** Instrument Sans + JetBrains Mono via `next/font/google` (variables `--font-sans`, `--font-mono`).
- **Theme:** `next-themes` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`,
  `disableTransitionOnChange`; theme toggle cycles System → Light → Dark and is also in ⌘K.
- **shadcn components to install:** `button badge card input textarea label select switch radio-group
  toggle-group tabs dialog alert-dialog sheet popover dropdown-menu command tooltip sonner skeleton
  progress table separator scroll-area avatar collapsible accordion calendar form sidebar breadcrumb chart`.
- **Custom components:** §5.2 (AppShell, PeriodPicker, SyncStatus, StatCard, DeltaText, MetricRow,
  ExplainDrawer, ImpactScoreCard, DimensionBars, EvidenceChip, ActivityHeatmap, ActivityChart,
  Sparkline, FeedItem, ItemDrawer, NextStepCard, OnboardingStepper, SyncStages, DocumentRenderer,
  DocumentEditor, StreamingStatus, VersionList, QuotaMeter, EmptyState, ErrorState, Banner,
  PlannedProviderCard).
- **Reference implementation:** the prototype's `app.js` shows every state and the exact copy; its
  `data.js` contains a faithful JS port of `metrics@2.0.0`/`impact@2.0.0` (reproduces golden test G-1
  = 78.2050) that P07 may use as an extra cross-check.
