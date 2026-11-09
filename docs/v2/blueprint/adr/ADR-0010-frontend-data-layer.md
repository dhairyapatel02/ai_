# ADR-0010: Frontend data layer — typed client on shared Zod schemas + TanStack Query

**Status:** Accepted (amends D-010: Bearer-JWT client, fetch-based SSE, URL-state period)
**Date:** 2026-11-09
**Deciders:** Phase 03

## Context
v0.1.0 pages are all client components using `useEffect` + `useState`, two `apiFetch`
implementations (DEBT-06), no HTTP status checks, duplicate requests (BUG-11), a request waterfall
behind `auth/me` (PERF-04), leaked polling intervals (BUG-10), no error/loading boundaries (UX-05/07).
ADR-0003 requires a Bearer JWT on API calls.

## Decision
- **Typed API client** (`apps/web/src/lib/api/`): `apiClient.get/post/patch/delete(path, { schema })`
  — attaches the JWT (`authClient.token()` cached until 60 s before expiry; server side
  `auth.api.getToken`), parses the envelope with the shared Zod schema, throws `ApiError { code,
  status, details, requestId }`, on 401 refreshes the token once then redirects to `/sign-in`.
- **TanStack Query v5**: provider in the `(app)` layout; query-key factory (`qk.metrics.overview(period)`);
  defaults `staleTime` 30 s, `retry` 2 for idempotent GETs on network/5xx only, no retry on 4xx;
  mutations invalidate affected keys.
- **Server Components** render shells and prefetch first-paint queries (`HydrationBoundary`);
  interactive widgets are client components.
- **SSE:** `useEventStream(url)` built on `fetch` + `ReadableStream` (supports `Authorization` and
  `Last-Event-ID` reconnect). `EventSource` is not used.
- **Polling:** `useSyncStatus` with `refetchInterval` driven by state (2 s running, 30 s waiting, off idle).
- **Global period** lives in the URL (`?period=month:2026-10`), parsed with the shared `parsePeriod`.
- **States:** `loading.tsx` / `error.tsx` per route group; shared `EmptyState`, `ErrorState`,
  `Skeleton` components; no `alert()`.

## Options Considered

### Option A: TanStack Query + typed fetch client (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Low–Medium |
| Cost | Small bundle |
| Scalability | Mature caching/dedup |
| Team familiarity | High |

**Pros:** dedup, caching, polling, devtools; works with RSC prefetch. **Cons:** two data paths (RSC prefetch + client).

### Option B: RSC-only data fetching + Server Actions
**Pros:** less client JS. **Cons:** dashboards need polling, SSE, optimistic updates; API is a separate service. Rejected as the sole approach.

### Option C: SWR
**Pros:** lighter. **Cons:** weaker mutation/invalidation story. Rejected.

### Option D: Generated OpenAPI client (orval etc.)
**Pros:** zero handwritten paths. **Cons:** Zod schemas already shared directly; generation adds a build step. Deferred.

## Consequences
- Easier: fixes BUG-10/11, DEBT-06, PERF-04, UX-05/07 patterns.
- Harder: token caching logic in the browser; SSE reader maintenance.
- Revisit: OpenAPI-generated client if endpoint count grows a lot.

## Action Items
1. [ ] P09: apiClient, query provider, key factory, `useEventStream`, `useSyncStatus`, state components.
2. [ ] P09: lint rule / grep check — no direct `fetch` to the API in components.
