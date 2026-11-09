# ADR-0006: API conventions

**Status:** Accepted (amends D-006: cursor pagination by default, period grammar, error-code list, SSE rules)
**Date:** 2026-11-09
**Deciders:** Phase 03

## Context
v0.1.0 returns errors with 200/201 (API-01), validates nothing (API-02), has unbounded pagination
(SEC-06), leaks internals in errors (SEC-12), and its envelope differs from the v2 plan (API-05).
Shared Zod schemas exist but are unused (DEBT-01).

## Decision
The normative rules are in [API_CONTRACT_V2 §1–§3](../API_CONTRACT_V2.md#1-conventions). In summary:
- **Envelope** `{ success: true, data, meta? }` / `{ success: false, error: { code, message, details?, requestId } }`
  produced by a global response interceptor and exception filter; correct HTTP status codes;
  stable error codes (API_CONTRACT_V2 §2).
- **Validation:** a `ZodValidationPipe` with schemas from `packages/shared`; strict objects;
  query coercion only. Max body 256 KB.
- **Pagination:** opaque **cursor** (`cursor`, `limit` 1–100, default 20) with
  `meta { nextCursor, hasMore, total? }`. (Amendment: cursor instead of page numbers — stable under
  inserts from sync, efficient on indexed timestamps.)
- **Periods:** one `period` grammar (`month:2026-10`, `quarter:2026-Q4`, `half:2026-H2`,
  `year:2026`, `custom:A..B`) resolved in the user's timezone by shared utilities. Explicit
  `from`/`to` local dates accepted where noted.
- **Ownership:** every lookup scoped by `userId`; others' IDs → 404.
- **SSE:** `text/event-stream`, resumable with `Last-Event-ID`, 15 s heartbeats, authenticated with
  the Bearer header (clients use fetch-based readers).
- **OpenAPI 3.1** generated from Zod (`zod-openapi` or equivalent) at `/api/docs` outside production.
- **No URI versioning** in v2.0; deprecations announced with `Deprecation`/`Sunset` headers.
- **Rate-limit classes** (API_CONTRACT_V2 §1.1), Redis-backed throttler.

## Options Considered

### Option A: Zod pipe + envelope interceptor + cursor pagination (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Low–Medium |
| Cost | None |
| Scalability | Cursor pagination scales with data |
| Team familiarity | High |

**Pros:** one schema source for API, OpenAPI and web; consistent errors. **Cons:** cursors don't support "jump to page N" (UI uses infinite scroll / next-prev).

### Option B: class-validator DTOs (Nest default)
**Pros:** idiomatic Nest. **Cons:** duplicates Zod schemas the web needs; spec mandates Zod. Rejected.

### Option C: Offset pagination (`page`, `limit`)
**Pros:** simple, page numbers. **Cons:** duplicates/skips under concurrent sync inserts; slow deep pages. Rejected except `total` counts where cheap.

### Option D: GraphQL API
**Pros:** flexible queries. **Cons:** larger change, harder caching/rate limiting; REST suits the screens. Rejected.

## Trade-off Analysis
Zod-everywhere is mandated by the spec and gives end-to-end types; cursor pagination matches the
feed/table UIs designed in P04.

## Consequences
- Easier: typed client (ADR-0010), generated docs, uniform error UX.
- Harder: every existing endpoint must be migrated (P05 owns infrastructure; later phases follow).
- Revisit: URI versioning only if a public third-party API is offered.

## Action Items
1. [ ] P05: interceptor, exception filter, Zod pipe, throttler classes, OpenAPI, request IDs.
2. [ ] P05: integration test that iterates all routes asserting 401 without a token.
3. [ ] P07: shared `parsePeriod` (with property tests).
