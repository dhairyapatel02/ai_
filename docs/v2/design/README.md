# DevImpact AI v2.0 — Design (Phase 04)

| File | What it is |
|---|---|
| [IA.md](IA.md) | Sitemap, routes, navigation (desktop sidebar, mobile bottom bar + drawer), period control, ⌘K, URL conventions |
| [FLOWS.md](FLOWS.md) | 10 user flows with Mermaid diagrams, branches, APIs and key copy |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Principles, tokens, contrast results, chart palettes, type, motion, components → shadcn/ui, data-viz rules, voice & tone, state patterns, accessibility spec, P09 handoff |
| [tokens.css](tokens.css) | The CSS variables + Tailwind v4 `@theme inline` bridge P09 imports |
| [SCREENS.md](SCREENS.md) | Every screen: purpose, layout, components, endpoints, five states, desktop/mobile |
| [HEURISTIC_REVIEW.md](HEURISTIC_REVIEW.md) | Nielsen + WCAG 2.2 AA self-review of the prototype and the fixes applied |
| [prototype/](prototype/) | Clickable HTML prototype (published as a private Artifact; link in `../PROGRESS.md`) |
| [scripts/check-contrast.mjs](scripts/check-contrast.mjs) | `node docs/v2/design/scripts/check-contrast.mjs [--md]` — WCAG contrast for every token pair |

Run the prototype locally: `npx serve docs/v2/design/prototype` (or `python3 -m http.server` in that
folder). It loads Google Fonts and lucide from public CDNs. Use the dashed **Prototype** button to
switch scenarios (first run, syncing, loading, API error, sync failed, needs reconnection, rate
limited, quota used up).
