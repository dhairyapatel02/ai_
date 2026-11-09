# Phase 09 — Frontend Foundation & App Shell

| | |
|---|---|
| **Goal** | Upgrade the web stack and build the foundation all v2 pages sit on: design system implementation, app shell (responsive nav, command palette, theming), auth screens, onboarding wizard, typed data layer, error/loading patterns. |
| **Type** | Code (web) |
| **Prerequisites** | P04 (design) and P05 (auth/API conventions) merged |
| **Parallel with** | P06–P08 |
| **Effort** | 1 session (large) |

## Context
v0.1.0 web: Next.js 14.2.3, React 18, Tailwind 3, five hand-copied shadcn components, all pages
client components, desktop-only sidebar, `useAuth().apiFetch` with no caching, spinner-only
loading, no error boundaries, no dark mode, no onboarding. P04 produced the design system
(`design/DESIGN_SYSTEM.md`, `design/tokens.css`), IA, flows and screen specs. D-002 (versions)
and D-010 (data layer) are binding.

## Read first
`design/IA.md`, `design/FLOWS.md`, `design/DESIGN_SYSTEM.md`, `design/tokens.css`,
`design/SCREENS.md` (shell, sign-in, onboarding, 404/500), `blueprint/API_CONTRACT_V2.md`,
frontend ADR. Skills: `vercel:nextjs` / `nextjs-ai-skills:next-best-practices`,
`vercel:next-upgrade`, `vercel:shadcn`, `nextjs-ai-skills:react-best-practices`,
`design-skills:accessibility-audit`.

## Objectives
1. Web app on the confirmed versions (Next.js latest stable major, React 19, Tailwind v4, current shadcn/ui).
2. Design tokens + components implemented exactly per DESIGN_SYSTEM.md, light/dark.
3. App shell per IA: grouped sidebar (collapsible), mobile nav, top bar with global period
   picker, user menu, sync indicator, ⌘K command palette.
4. Auth screens and onboarding wizard working against the real API (P05/P06 endpoints).
5. A typed data layer and reusable states (skeleton, empty, error, partial) used by every page.

## Tasks
1. Upgrade Next.js/React (use official codemods), Tailwind v4 (migrate config to CSS-first
   `@theme` with tokens from `design/tokens.css`), ESLint config for Next, fix breakages. Re-init
   shadcn/ui via CLI and install the components listed in P04's handoff.
2. Theme: `next-themes` (system/light/dark), no flash on load, chart palettes from tokens.
3. Layout & routing: route groups `(auth)`, `(onboarding)`, `(app)`; middleware protecting `(app)`;
   `loading.tsx`, `error.tsx`, `not-found.tsx` per group with designed states; global error page.
4. App shell components: `AppSidebar` (groups, active state, collapse, keyboard accessible),
   `MobileNav` (sheet/drawer), `TopBar` (page title, global `PeriodPicker`, `SyncIndicator`,
   `UserMenu`), `CommandPalette` (navigate, trigger sync, generate document, toggle theme).
5. Data layer: `packages/shared` Zod schemas → typed `apiClient` (fetch wrapper: credentials,
   envelope unwrapping, typed `ApiError` with error codes, 401 → redirect to sign-in) + TanStack
   Query provider, query-key factory, defaults (staleTime, retries for idempotent GETs), SSE helper
   hook (`useEventSource`) for P11, polling hook for sync progress.
6. Shared state components: `PageHeader`, `StatCard` (value, delta, trend, info tooltip),
   `ChartCard`, `EmptyState` (illustration/icon, copy, CTA), `ErrorState` (retry, error code),
   `Skeleton` variants, `DataTable` (sortable, paginated), `InfoPopover` ("How is this calculated?"),
   `ConfirmDialog`, toasts (`sonner`). Replace every `alert()`.
7. Rebuild the v0.1 components to the design system: `ImpactScoreCard`, `ActivityHeatmap`,
   `SyncStatusBadge`, `DateRangePicker` (missing in v1), `GenerateButton` (with progress), and
   `DocumentPreview` (placeholder for P11). Each with Vitest tests and states.
8. Sign-in page (GitHub, Google; dev-login button only in dev) and sign-out.
9. Onboarding wizard per FLOWS.md: welcome → connect GitHub (OAuth via P05) → choose repos
   (P06 endpoint; if P06 not merged, feature-flag the step) → first sync with live progress →
   redirect to dashboard. Resumable; skippable steps per design.
10. Keep existing pages working inside the new shell (they will be rebuilt in P10/P11); remove the
    old `Sidebar` and `auth-context.tsx`.
11. Accessibility baseline: skip link, focus rings, landmarks, `axe` check in Playwright for the
    shell, sign-in and onboarding.
12. E2E (Playwright): sign-in (dev-login in test env) → onboarding with mocked GitHub (or seeded
    integration) → dashboard shell renders; mobile nav works at 390px; theme toggle persists.

## Deliverables
Upgraded web app, tokens/theme, shell, command palette, data layer, state components, rebuilt
core components, auth + onboarding screens, tests, screenshots of shell/onboarding (light/dark,
desktop/mobile) in `docs/v2/screenshots/p09/`, PROGRESS.md.

## Acceptance criteria
- [ ] `next build` passes on the new major version; no React/Next deprecation warnings in build output.
- [ ] Every route group has `loading.tsx`, `error.tsx`; unknown route shows designed 404.
- [ ] Shell usable at 390px, 768px, 1440px; keyboard-only navigation works; axe: 0 serious/critical violations on shell, sign-in, onboarding.
- [ ] Light/dark themes match tokens; no theme flash on reload.
- [ ] No component uses `fetch` directly — all API calls go through `apiClient` + TanStack Query.
- [ ] No `alert()` anywhere (`grep`).
- [ ] Onboarding completes end-to-end in E2E.
- [ ] Screenshots committed; `npm run check` + CI green.

## Handoff
Document: how to add a page (route + query hook + states), component catalogue location, the
query-key conventions, and any API gaps found.

---

## Blueprint amendments (P03, 2026-11-09)
Appended by Phase 03; these take precedence over conflicting text above.

1. **Auth client (ADR-0003):** Better Auth React client; `apiClient` gets JWTs from
   `/api/auth/token` (browser) or `auth.api.getToken` (server) and sends `Authorization: Bearer`.
   Remove the `/auth/me` alias usage and the old `auth-context.tsx`.
2. **SSE (ADR-0010):** `useEventStream` is **fetch-based** (EventSource cannot send the Bearer
   header) with `Last-Event-ID` reconnect.
3. **Onboarding:** GitHub App install/authorize flow including the "org approval pending" state;
   repos step uses `GET/PATCH /repos`; first sync via `GET /sync/status` polling (or `/sync/stream`).
4. **No team/billing UI** (D-014). Period state in the URL using the shared `parsePeriod`.
