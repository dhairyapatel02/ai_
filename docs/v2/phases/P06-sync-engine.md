# Phase 06 — Data Ingestion & Sync Engine v2

| | |
|---|---|
| **Goal** | Make GitHub data ingestion correct, complete, efficient, incremental, scheduled, real-time (webhooks) and observable — and design it so other providers can plug in later. |
| **Type** | Code (API + worker) |
| **Prerequisites** | P05 merged |
| **Parallel with** | P09 (frontend foundation) |
| **Effort** | 1 session (large) |

## Context
v0.1.0 sync (`apps/api/src/sync/sync.processor.ts`, `apps/api/src/github/github.service.ts`):
always re-fetches 6 months; only top 30 repos (reviews: 15); paginates every PR in each repo;
one `getCommit` call per commit; swallows rate-limit errors; stores reviewed PRs as the user's
own PRs (stub "PR #n"); branch hard-coded `main`; no webhooks; no scheduled sync; status read by
scanning the whole queue. See `DATA-*`/`PERF-*` issues and D-008 / sync ADR.

## Read first
Sync ADR + `blueprint/ARCHITECTURE_V2.md` (sync flow), `blueprint/DATA_MODEL_V2.md`,
`blueprint/API_CONTRACT_V2.md` (integrations, repos, sync, webhooks), `audit/ISSUES.md` (target 06),
`audit/ARCHITECTURE_CURRENT.md` (sync sequence).

## Objectives
1. Correct data: authored PRs, reviewed PRs and reviews are distinct; no inflated counts.
2. Complete data: all repos the user selects (not an arbitrary top 30), commits on all branches
   that reached the default branch, PR stats needed by the KPI methodology.
3. Efficient: GraphQL/Search-based fetching, bounded API calls, rate-limit aware.
4. Incremental + scheduled + webhook-driven; idempotent and resumable.
5. Observable: persisted `SyncRun` history, live progress, actionable errors.
6. Provider abstraction ready for GitLab/Jira/Linear (P13).

## Tasks

### A. Data model
1. Migration for sync-related parts of DATA_MODEL_V2: `Repository` (externalId, fullName,
   isPrivate, defaultBranch, included flag, lastSyncedAt), `PullRequest` new fields (additions,
   deletions, changedFiles, isDraft, closedAt, firstReviewAt, authorLogin, `isAuthoredByUser`
   or separate relation per ADR), `PullRequestReview` decoupled from PR authorship, `SyncRun`
   (id, integrationId, trigger: initial|manual|scheduled|webhook, status, startedAt, finishedAt,
   counts JSON, error, cursor), integration cursors. Data migration: convert v0.1.0 stub PRs into
   reviewed-PR records and stop counting them as authored.

### B. Provider abstraction
2. Define `ActivityProvider` interface (listRepositories, fetchCommits, fetchPullRequests,
   fetchReviews, fetchIssues?, verifyWebhook, parseWebhook) + normalised DTOs in
   `packages/shared`. Implement `GitHubProvider`. The sync orchestrator depends only on the interface.

### C. GitHub fetching
3. Octokit with `@octokit/plugin-throttling` + `@octokit/plugin-retry`; central rate-limit
   accounting; on exhaustion, reschedule the job at reset time instead of failing.
4. Repositories: list accessible repos, persist them, default `included = true` for repos with
   user activity in the window; respect user include/exclude (API endpoint `PATCH /repos/:id`).
5. Authored PRs: GraphQL search `is:pr author:<login> updated:>=<cursor>` with fields needed by
   KPIs (createdAt, mergedAt, closedAt, additions, deletions, changedFiles, isDraft, first review
   time, review count). Reviewed PRs: `is:pr reviewed-by:<login> -author:<login>` + the user's
   reviews/comments on them.
6. Commits: per included repo, `history(author: {id}, since: cursor)` on the default branch via
   GraphQL (stats included, no N+1). Store real branch name. De-duplicate by sha.
7. Batch DB writes in transactions (`createMany … skipDuplicates` + targeted updates); upserts
   keyed by provider external IDs.

### D. Orchestration
8. Worker (from P02 `worker.ts`) consumes `sync` queue. Job types: `initial-backfill`
   (configurable window, default 12 months or per PRD), `incremental` (from cursor), `webhook-event`.
   Job id = `sync:<integrationId>` to prevent concurrent runs; attempts with exponential backoff.
9. Scheduled incremental sync every 24h per active integration via BullMQ repeatable jobs (or a
   scheduler job that fans out); jittered.
10. Progress reporting: `SyncRun` updated per stage (repos → PRs → reviews → commits → rollups)
    with counts and percentage; `GET /sync/status` and `GET /sync/runs` read from DB, not the queue.
    Optional SSE `GET /sync/stream` for live progress (else polling contract).
11. After a successful run, enqueue a `metrics-recompute` job for affected date ranges (consumed
    in P07; create the queue + no-op handler now if P07 isn't merged).

### E. Webhooks
12. `POST /api/webhooks/github` (public, raw body): verify `X-Hub-Signature-256` (HMAC, timing-safe),
    idempotency via `X-GitHub-Delivery`, handle `push`, `pull_request`, `pull_request_review`,
    `installation*` (if GitHub App). Enqueue targeted updates. Document setup (App webhook or
    per-repo hooks per ADR) and local testing (smee.io or `gh webhook forward`).

### F. Token lifecycle
13. Detect revoked/expired tokens (401) → mark integration `needs_reauth`, stop schedules, surface
    in API for the UI. Refresh tokens if the chosen mechanism uses them (GitHub App user tokens).

### G. Tests
14. Recorded GitHub fixtures (GraphQL + REST JSON) under `apps/api/test/fixtures/github/`, served by
    MSW/nock. Tests: authored vs reviewed separation (un-skip the P02 stub-PR test), incremental
    cursor behaviour, idempotent re-run (no duplicates), rate-limit reschedule, revoked token,
    webhook signature valid/invalid/replayed, repo exclusion respected, data migration of stubs.
15. A load-ish test: fixture of 50 repos × 300 commits proves bounded API call count (assert on
    the number of mocked requests).

## Deliverables
Migration(s), provider interface + GitHub provider, orchestrator, worker jobs, scheduler,
webhook endpoint, repo include/exclude API, sync status/history API, fixtures + tests, README
section "How sync works" + webhook setup, PROGRESS.md.

## Acceptance criteria
- [ ] Reviewing someone else's PR never increases the user's authored-PR count (test).
- [ ] Re-running the same sync produces zero new rows (test).
- [ ] Incremental sync only requests data newer than the cursor (asserted via mock request log).
- [ ] API call count for the 50×300 fixture is below the budget documented in the sync ADR.
- [ ] Rate-limit exhaustion reschedules the job; no silent data loss (errors recorded on `SyncRun`).
- [ ] Webhook with bad signature → 401; replayed delivery ignored; valid `pull_request` event updates the PR.
- [ ] 24h repeatable job registered for each active integration (test or inspection script).
- [ ] `GET /sync/status` reads from DB and reflects stage + progress; works after Redis restart.
- [ ] Revoked token → integration status `needs_reauth` and schedule paused.
- [ ] `npm run check` + CI green.

## Human review checklist
Optionally connect a real GitHub account locally, run a sync, and compare counts with your GitHub profile.

## Handoff
Document the job types/queues, cursor semantics, API-call budget, how to replay a webhook locally,
and any GitHub fields not yet captured.
