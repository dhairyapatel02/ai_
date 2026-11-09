# ADR-0001: Keep the npm-workspaces monorepo; no Turborepo for v2.0

**Status:** Accepted
**Date:** 2026-11-09
**Deciders:** Phase 03 (planner proposal D-001, confirmed by the P01 audit)

## Context
v0.1.0 is a ~4.5k-line npm-workspaces monorepo (`apps/web`, `apps/api`, `packages/shared`). The
audit found the layout sensible but `packages/shared` unused (DEBT-01) and the root `build`
script building `shared` last. v2 adds a worker entry point, many shared Zod schemas, period
utilities and metric metadata used by both apps.

## Decision
- Keep **npm workspaces** with three packages: `apps/web`, `apps/api` (HTTP + worker entries),
  `packages/shared`.
- `packages/shared` becomes the single source of truth for Zod schemas (API contract, document
  content, env fragments), enums, period utilities and metric metadata. Both apps import it.
- Build order via workspace scripts: `shared` → `api` → `web` (`npm run build -w packages/shared && …`
  or `tsc -b` project references). P02 owns the exact scripts.
- **Turborepo is not adopted** for v2.0. Revisit if CI build time exceeds 10 minutes or a fourth
  package is added.
- The worker lives in `apps/api` (`src/worker.ts`) — same code, different entry (ADR-0007).

## Options Considered

### Option A: npm workspaces (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | None |
| Scalability | Fine for 3 packages |
| Team familiarity | High; already in place |

**Pros:** zero migration; native to npm; simple CI. **Cons:** no task caching; manual build order.

### Option B: npm workspaces + Turborepo
| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | Free (remote cache optional) |
| Scalability | Better task graph and caching |
| Team familiarity | Medium |

**Pros:** cached builds, parallel tasks. **Cons:** another tool and config for marginal gains at this size.

### Option C: Separate repositories
**Pros:** independent deploys. **Cons:** shared schemas become a published package; contract drift returns. Rejected.

### Option D: Separate `apps/worker` package
**Pros:** clear boundary. **Cons:** duplicates Nest modules/providers or requires extracting a library; v2.0 worker shares almost all API services. Rejected for v2.0.

## Trade-off Analysis
The codebase is small; build orchestration is not a bottleneck. Making `shared` real removes the
largest source of drift at no tooling cost.

## Consequences
- Easier: one install, one lockfile, shared types end-to-end.
- Harder: build order must be maintained by scripts; no caching.
- Revisit: Turborepo when CI > 10 min; `apps/worker` split if worker deps diverge (e.g. Chromium).

## Action Items
1. [ ] P02: root scripts build `shared` first; both apps depend on `@devimpact/shared`.
2. [ ] P05: migrate request schemas into `packages/shared/src/schemas/`.
