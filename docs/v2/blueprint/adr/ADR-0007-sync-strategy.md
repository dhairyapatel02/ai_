# ADR-0007: Sync strategy — worker process, GraphQL search + contributions, incremental, webhooks

**Status:** Accepted (amends D-008: repo discovery via `contributionsCollection`, newest-first backfill, explicit API-call budget, Redis-independent status)
**Date:** 2026-11-09
**Deciders:** Phase 03

## Context
The v0.1.0 sync stores reviewed PRs as authored stubs (DATA-01), covers only 30 repos (DATA-03),
swallows errors (DATA-04), reads only default-branch commits with a hard-coded branch name
(DATA-05), makes 8,732 calls for 30 repos × 200 commits (PERF-01), writes row by row (PERF-02),
reports status from the queue (DATA-06, BUG-08/09) and has no incremental, scheduled or webhook
sync (GAP-01). ADR-0004 makes the data source a GitHub App.

## Decision

### Process model
- Dedicated **worker** process (`apps/api/src/worker.ts`) consumes BullMQ queues; the API only
  enqueues (ARCHITECTURE_V2 §2). One run per integration at a time (job id `sync:<integrationId>`).
- `SyncRun` rows are the source of truth for status/progress/history (status survives Redis loss).

### Fetch strategy (per run, window `[from, to]`)
| Stage | Call | Page size | Notes |
|---|---|---|---|
| Prepare | token refresh if needed; `GET /user` (first run) | — | 401/refresh failure → `NEEDS_REAUTH` |
| Repositories | `GET /user/installations`, `GET /user/installations/{id}/repositories` | 100 | plus repos discovered by later stages |
| Authored PRs | GraphQL `search(type: ISSUE, query: "is:pr author:<login> updated:<from>..<to>")` with nested PR fields, `reviews(first: 50)` summary, `timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT, CROSS_REFERENCED_EVENT], first: 20)` | 50 | split window recursively when `issueCount > 1000` (search cap) |
| Reviewed PRs | GraphQL search `is:pr reviewed-by:<login> -author:<login> updated:<from>..<to>` with `reviews(author: <login>, first: 20)` (+ `comments { totalCount }`), `timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], first: 20)` | 50 | self-reviews never stored |
| Commit repos | GraphQL `user.contributionsCollection(from, to) { commitContributionsByRepository(maxRepositories: 100) }` | ≤ 1-year span per call | gives repos with commits + counts |
| Commits | per included repo with commits: `repository.defaultBranchRef.target.history(author: {id: <nodeId>}, since, until, first: 100)` with `additions deletions changedFilesIfAvailable parents { totalCount } associatedPullRequests(first: 1)` | 100 | no N+1; real branch name stored |

- Writes: per page, one transaction with `createMany({ skipDuplicates })` + targeted `updateMany`;
  upsert keys per DATA_MODEL_V2 (natural keys match legacy rows).
- Octokit with `@octokit/plugin-throttling` + `@octokit/plugin-retry`, one instance per job;
  `GITHUB_API_URL` configurable for tests.

### API-call budget
```
calls ≈ 1 (prepare) + I + Σ_i ceil(repos_i / 100)          # installations + repo pages
      + Σ_w ceil(authoredPRs_w / 50) + Σ_w ceil(reviewedPRs_w / 50)   # per search window w
      + ceil(windowDays / 365)                              # contributionsCollection
      + Σ_r ceil(commits_r / 100)                           # history per repo with commits
```
**Reference fixture (P06 load test):** 1 installation, 50 repos × 300 commits in the window,
600 authored PRs, 900 reviewed PRs, 12-month window →
`1 + 1 + 1 + 12 + 18 + 1 + 150 = 184` requests. **Budget: ≤ 250 requests** and ≤ 2,500 GraphQL
cost points for an initial backfill of this fixture (vs 8,732 in v0.1). **Daily incremental** for a
typical user: ≤ 50 requests.

### Incremental, scheduled, webhooks
- Cursors: `Integration.syncCursor.{authoredPrsUpdatedAt, reviewedPrsUpdatedAt}`,
  `Repository.commitCursor`; query from `cursor − 1 h`; cursors advance only after their stage commits.
- Initial backfill: plan history window (12 months FREE), **newest 30 days first**, then
  `metrics.recompute`, then month-by-month backwards (dashboard renders within ~60 s).
- Schedule: hourly `sync.fanout` scheduler enqueues integrations whose `scheduleSlotMinute` falls in
  the hour → each `ACTIVE` integration syncs every 24 h; paused for `NEEDS_REAUTH`/`SUSPENDED`/`DISCONNECTED`.
- Webhooks (`POST /webhooks/github`): HMAC verify (timing-safe), idempotent via
  `WebhookDelivery.id = X-GitHub-Delivery`, 202 fast, `sync.targeted` job refetches the single
  PR/review/commit set. Events per ADR-0004.

### Failure handling
- Rate limit: if remaining < 200 (REST headers or GraphQL `rateLimit`), persist cursors, set
  `WAITING_RATE_LIMIT` with `resumeAt`, re-enqueue delayed. Never drop data.
- Per-repo errors recorded in `SyncRun.errors`; run ends `PARTIAL`; repo marked `accessible=false` on 404.
- Job attempts: 3 with exponential backoff for transient errors; terminal errors set `FAILED` with a
  safe `errorCode` (`GITHUB_REAUTH_REQUIRED`, `GITHUB_UNAVAILABLE`, `INTERNAL`).

### Provider abstraction
`ActivityProvider` interface (listRepositories, fetchAuthoredPullRequests, fetchReviewedPullRequests,
fetchCommits, fetchSingle(kind, id), verifyWebhook, parseWebhook, refreshToken, revokeToken) with
normalised DTOs in `packages/shared`; the orchestrator depends only on the interface (v2.1 adds
GitLab/Jira/Linear).

## Options Considered

### Option A: GraphQL search + contributions + per-repo history (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | ~2 % of v0.1 calls |
| Scalability | Bounded by activity, not by repo count or PR history |
| Team familiarity | Medium (GraphQL) |

**Pros:** fixes DATA-01 at the source (`author:` vs `reviewed-by:`), covers all repos, stats without N+1.
**Cons:** search 1000-result cap needs window splitting; GraphQL cost accounting.

### Option B: REST per repository (v0.1 approach, fixed)
**Pros:** simple. **Cons:** scales with repos × PR history; still N+1 for stats. Rejected.

### Option C: Events API (`/users/{u}/events`)
**Pros:** one feed. **Cons:** 90-day / 300-event limit; incomplete. Rejected (could seed "recent" only).

### Option D: Webhooks only after a one-off backfill
**Pros:** minimal polling. **Cons:** public repos without installation and missed deliveries leave gaps. Rejected; webhooks complement the daily incremental.

## Trade-off Analysis
Activity-scoped queries make cost proportional to the user's own work. Daily incremental plus
webhooks gives freshness with a safety net; persisted cursors and `SyncRun` make every run
resumable and observable.

## Consequences
- Easier: correct authored/reviewed separation, honest progress (reaches 100), rate-limit safety.
- Harder: GraphQL fixtures for tests; window-splitting logic; webhook-to-user resolution.
- Revisit: commits on non-default branches (not counted in v2.0 — documented caveat); GitHub Enterprise Server support (v2.1).

## Action Items
1. [ ] P06: implement stages, cursors, budget test (≤ 250 requests on the reference fixture), rate-limit reschedule test.
2. [ ] P06: webhook endpoint + signature/replay tests; `sync.fanout` scheduler.
3. [ ] P06: legacy data migration and purge (DATA_MODEL_V2 §5).
