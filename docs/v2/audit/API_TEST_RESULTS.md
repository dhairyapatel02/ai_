# API Test Results — v0.1.0 (Phase 01 audit)

Black-box probes of **every** API endpoint (20 routes), run on 2026-11-09 against the baseline
(`npm run dev:api`, Node 22, local Postgres 15 + Redis 7 via Docker), DB seeded with
[`scripts/seed-fixture.ts`](scripts/seed-fixture.ts) (Alice = main user, Bob = second tenant).

- **Probe script:** [`scripts/probe-api.sh`](scripts/probe-api.sh) (phases `all`, `gen-mock`,
  `destructive`, `auth-extra`); raw results: [`logs/api-probes.jsonl`](logs/api-probes.jsonl);
  tables rendered by [`scripts/render-api-results.py`](scripts/render-api-results.py).
- **AI happy path:** the API was restarted with `ANTHROPIC_BASE_URL=http://localhost:4010` pointing
  at [`scripts/mock-anthropic.mjs`](scripts/mock-anthropic.mjs) (local env override only — the SDK
  honours it; no code change). Every prompt the API sent is captured in
  [`logs/ai-prompts/`](logs/ai-prompts/). One probe with the dummy key against the real Anthropic API
  is recorded in the cross-cutting section.
- **"As"** = the `x-user-id` header sent: `alice`/`bob` IDs, `none`, or a forged ID.
- **Verdict:** ✅ correct · ⚠️ works but violates conventions/has caveats · ❌ defect. Issue IDs
  refer to [`ISSUES.md`](ISSUES.md).

## Summary

| Result | Count |
|---|---|
| Probes executed | 87 (+ 9 cross-cutting checks) |
| ✅ correct | 9 |
| ⚠️ caveat (mostly wrong status codes, API-01) | 34 |
| ❌ defect | 44 |

**Headline:** authentication does not exist. Setting `x-user-id` to another user's ID reads
(AUTH-8, INT-3, ACT-8, ACT-17, DOC-6, SYNC-8), spends AI budget for (GEN-R12) and **deletes**
(DEST-1, DEST-2 → cascade wipes all of Bob's activity, DEST-3) that user's data, and
`POST /auth/dev-login` returns any account given only its email (AUTH-2). Ownership checks inside
queries *do* work (INT-11, DOC-5, DOC-7) — the problem is purely who the caller claims to be.
Every error comes back as 200/201 (API-01); bad input causes 500s or leaks internals (BUG-04,
SEC-12).

## Endpoint coverage (≥ 3 probes each: happy · invalid · unauthorised/forged)

| Endpoint | Happy | Invalid input | Unauthorised / forged / other tenant |
|---|---|---|---|
| `POST /auth/dev-login` | AUTH-1 | AUTH-3, AUTH-4 | AUTH-2 (victim email) |
| `POST /auth/github` | AUTH-9 | AUTH-10, AUTH-14 | AUTH-14 (forged) |
| `POST /auth/google` | AUTH-11 | AUTH-12 | AUTH-13 (forged) |
| `GET /auth/me` | AUTH-6 | — (no input) | AUTH-5, AUTH-7, AUTH-8 |
| `GET /integrations` | INT-1 | — (no input) | INT-2, INT-3 |
| `POST /integrations/github/connect` | INT-4 | — (no input) | INT-5, INT-6 |
| `POST /integrations/github/callback` | INT-8 (real GitHub, bogus code) | INT-7, INT-10 | INT-9 |
| `DELETE /integrations/:id` | DEST-2 | INT-12 | INT-11, INT-13 |
| `POST /sync/trigger` | SYNC-1 | SYNC-2 (duplicate) | SYNC-3, SYNC-4 |
| `GET /sync/status` | SYNC-5 | — (no input) | SYNC-6, SYNC-7, SYNC-8 |
| `GET /activity/commits` | ACT-1, ACT-9 | ACT-2..6 | ACT-7, ACT-8 |
| `GET /activity/prs` | ACT-10 | ACT-11, ACT-12 | ACT-13 |
| `GET /activity/summary` | ACT-14 | ACT-15 | ACT-16, ACT-17 |
| `POST /generate/resume` | GEN-R1 | GEN-8, GEN-R7, GEN-R8, GEN-R10, GEN-R11 | GEN-5 |
| `POST /generate/appraisal` | GEN-R2 | GEN-R5 | GEN-6 |
| `POST /generate/promotion` | GEN-R3 | GEN-R6, GEN-R9 | GEN-7 |
| `GET /generate/impact-score` | GEN-1, GEN-R4 | GEN-2, GEN-3 | GEN-4, GEN-R12 |
| `GET /documents` | DOC-1 | DOC-2, DOC-10 | DOC-3 |
| `GET /documents/:id` | DOC-4 | DOC-5 (other tenant's id) | DOC-6 |
| `DELETE /documents/:id` | DEST-1 | DOC-8 | DOC-7, DOC-9 |

## Cross-cutting checks

Output: [`logs/api-extra-checks.txt`](logs/api-extra-checks.txt).

| Check | Result | Verdict |
|---|---|---|
| Date range `from=2026-10-23&to=2026-10-23` on a day with 4 commits | `total: 0`; with `to=2026-10-23T23:59:59Z` → `total: 4` | ❌ BUG-05 |
| `limit=100000` | returned 292 of 292 rows | ❌ SEC-06 |
| `limit=-5` | 5 rows (oldest), `limit: -5` echoed | ❌ SEC-06 |
| PR list composition for Alice | 106 rows: 65 stubs `"PR #n"`, 33 `MERGED` | ❌ DATA-01 |
| Response headers | `X-Powered-By: Express`; no helmet headers | ❌ SEC-08 |
| CORS preflight from `https://evil.example` | `Access-Control-Allow-Origin: http://localhost:3000` (fixed origin → browser blocks evil origin) | ✅ |
| 200 × `POST /auth/dev-login` burst | 200 × 201, 200 new users created | ❌ SEC-07, SEC-02 |
| 200 KB JSON body | `413 request entity too large` (Express default 100 KB) | ✅ |
| Resume generation with the dummy key against the **real** Anthropic API | `201 {"success":false,"error":"401 {\"type\":\"error\",...\"invalid x-api-key\"},\"request_id\":\"req_…\"}"}` after **3.2 s** (3 attempts) | ❌ AI-04, SEC-12, API-01 |

## Sync job behaviour observed through the API

`SYNC-1/2` queued two jobs for Alice back-to-back (no de-duplication). The in-process BullMQ
worker ran both immediately and both failed with `HttpError: Bad credentials` (the fixture token is
fake). `/sync/status` then reported `status: failed` with the failed job's finish time as
`lastSync`, and the Integrations page showed a green **"Synced"** badge (BUG-08,
`screenshots/interaction-1440-connect-after-failed-sync.png`). Detailed processor behaviour against
a fake GitHub is in [`ARCHITECTURE_CURRENT.md §5`](ARCHITECTURE_CURRENT.md#5-sync-engine-deep-dive).

## Probe results

### Auth

| Probe | Request | As | Status | ms | Response (truncated) | Verdict |
|---|---|---|---|---|---|---|
| AUTH-1 | `POST /auth/dev-login` body `{}`<br>dev-login, empty body (what the web app calls) | none | 201 | 9 | `{"success":true,"data":{"id":"cmw8whz2p000011so1wvyr54s","email":"dev@devimpact.ai","name":"Dev User","avatar":null,"plan":"FREE","createdAt":"2026-11…` | ❌ SEC-02 — public, creates/returns shared "Dev User"; 201 status |
| AUTH-2 | `POST /auth/dev-login` body `{"email":"alice@audit.local"}`<br>dev-login with a victim's email -> account takeover | none | 201 | 4 | `{"success":true,"data":{"id":"cmw8wea2c0000149om69b8jf5","email":"alice@audit.local","name":"Alice Auditor","avatar":null,"plan":"FREE","createdAt":"2…` | ❌ SEC-02 — returns Alice's full account given only her email (takeover) |
| AUTH-3 | `POST /auth/dev-login` body `{"email":"not-an-email","name":""}`<br>dev-login with invalid email / empty name | none | 201 | 5 | `{"success":true,"data":{"id":"cmw8whz5y000111sogh4kmivs","email":"not-an-email","name":"Dev User","avatar":null,"plan":"FREE","createdAt":"2026-11-09T…` | ❌ SEC-02, API-02 — invalid email accepted, new account created |
| AUTH-4 | `POST /auth/dev-login` body `garbage`<br>dev-login with non-JSON body | none | 201 | 4 | `{"success":true,"data":{"id":"cmw8whz2p000011so1wvyr54s","email":"dev@devimpact.ai","name":"Dev User","avatar":null,"plan":"FREE","createdAt":"2026-11…` | ⚠️ API-02 — non-JSON body ignored, falls back to default user |
| AUTH-5 | `GET /auth/me`<br>me without header | none | 200 | 2 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 — "Not authenticated" with HTTP 200 |
| AUTH-6 | `GET /auth/me`<br>me as alice | cmw8wea2c00001 | 200 | 6 | `{"success":true,"data":{"id":"cmw8wea2c0000149om69b8jf5","email":"alice@audit.local","name":"Alice Auditor","avatar":null,"plan":"FREE","createdAt":"2…` | ✅ Returns profile + integration list (no tokens) |
| AUTH-7 | `GET /auth/me`<br>me with forged id | forged-user-id | 200 | 4 | `{"success":false,"error":"User not found"}` | ⚠️ API-01 — 200 "User not found" |
| AUTH-8 | `GET /auth/me`<br>me impersonating bob (just set header) | cmw8wea8900h01 | 200 | 4 | `{"success":true,"data":{"id":"cmw8wea8900h0149oeju8wkdo","email":"bob@audit.local","name":"Bob Victim","avatar":null,"plan":"FREE","createdAt":"2026-1…` | ❌ SEC-01 — impersonation: Bob's profile returned by setting a header |
| AUTH-9 | `POST /auth/github` body `{}`<br>auth/github stub, empty body | none | 201 | 2 | `{"success":true,"data":{"message":"GitHub OAuth handled by NextAuth.js on frontend"}}` | ❌ API-03 — stub returns success |
| AUTH-10 | `POST /auth/github`<br>auth/github stub, no body | none | 201 | 1 | `{"success":true,"data":{"message":"GitHub OAuth handled by NextAuth.js on frontend"}}` | ❌ API-03 — stub, no body still success |
| AUTH-11 | `POST /auth/google` body `{"code":"x"}`<br>auth/google stub | none | 201 | 2 | `{"success":true,"data":{"message":"Google OAuth handled by NextAuth.js on frontend"}}` | ❌ API-03 — stub |
| AUTH-12 | `POST /auth/google`<br>auth/google stub, no body | none | 201 | 2 | `{"success":true,"data":{"message":"Google OAuth handled by NextAuth.js on frontend"}}` | ❌ API-03 — stub, no body |
| AUTH-13 | `POST /auth/google` body `{"code":1}`<br>auth/google stub with forged x-user-id | forged-user-id | 201 | 8 | `{"success":true,"data":{"message":"Google OAuth handled by NextAuth.js on frontend"}}` | ❌ API-03 — forged header ignored, success |
| AUTH-14 | `POST /auth/github` body `{"code":["a"]}`<br>auth/github stub with forged x-user-id + invalid code type | forged-user-id | 201 | 2 | `{"success":true,"data":{"message":"GitHub OAuth handled by NextAuth.js on frontend"}}` | ❌ API-02/03 — invalid body type accepted |

### Integrations

| Probe | Request | As | Status | ms | Response (truncated) | Verdict |
|---|---|---|---|---|---|---|
| INT-1 | `GET /integrations`<br>list as alice | cmw8wea2c00001 | 200 | 15 | `{"success":true,"data":[{"id":"cmw8wea2i0002149osmryfek3","provider":"GITHUB","metadata":{"name":"Alice Auditor","avatar":null,"username":"alice"},"cr…` | ✅ Lists provider + metadata, token not exposed |
| INT-2 | `GET /integrations`<br>list without header | none | 200 | 2 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 — 200 for unauthenticated |
| INT-3 | `GET /integrations`<br>list impersonating bob | cmw8wea8900h01 | 200 | 4 | `{"success":true,"data":[{"id":"cmw8wea8a00h2149ofj90qa1n","provider":"GITHUB","metadata":{"name":"Bob Victim","avatar":null,"username":"bob"},"created…` | ❌ SEC-01 — Bob's integrations via header |
| INT-4 | `POST /integrations/github/connect`<br>github/connect as alice (inspect OAuth URL: state?) | cmw8wea2c00001 | 201 | 1 | `{"success":true,"data":{"url":"https://github.com/login/oauth/authorize?client_id=dummy-client-id&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconnect…` | ❌ SEC-04, SEC-05 — OAuth URL without `state`, scope `repo` |
| INT-5 | `POST /integrations/github/connect`<br>github/connect without header | none | 201 | 2 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 — 201 for unauthenticated |
| INT-6 | `POST /integrations/github/connect`<br>github/connect with forged id (no user check) | forged-user-id | 201 | 2 | `{"success":true,"data":{"url":"https://github.com/login/oauth/authorize?client_id=dummy-client-id&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconnect…` | ❌ SEC-01 — any non-empty header accepted (no user lookup) |
| INT-7 | `POST /integrations/github/callback` body `{}`<br>github/callback missing code | cmw8wea2c00001 | 201 | 2 | `{"success":false,"error":"Authorization code is required"}` | ⚠️ API-01 — validation error with 201 |
| INT-8 | `POST /integrations/github/callback` body `{"code":"bogus"}`<br>github/callback bogus code (hits github.com) | cmw8wea2c00001 | 201 | 123 | `{"success":false,"error":"Failed to exchange GitHub code for token"}` | ⚠️ API-01 — upstream failure with 201 (real call to github.com) |
| INT-9 | `POST /integrations/github/callback` body `{"code":"bogus"}`<br>github/callback without header | none | 201 | 2 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 — 201 for unauthenticated |
| INT-10 | `POST /integrations/github/callback` body `{"code":12345}`<br>github/callback code as number | cmw8wea2c00001 | 201 | 37 | `{"success":false,"error":"Failed to exchange GitHub code for token"}` | ⚠️ API-02 — numeric code not rejected, forwarded to GitHub |
| INT-11 | `DELETE /integrations/cmw8wea8a00h2149ofj90qa1n`<br>delete bob's integration as alice | cmw8wea2c00001 | 200 | 15 | `{"success":false,"error":"Integration not found"}` | ✅ Ownership enforced (Alice cannot delete Bob's) — but status 200 |
| INT-12 | `DELETE /integrations/nope`<br>delete nonexistent integration | cmw8wea2c00001 | 200 | 4 | `{"success":false,"error":"Integration not found"}` | ⚠️ API-01 — 200 "not found" |
| INT-13 | `DELETE /integrations/cmw8wea8a00h2149ofj90qa1n`<br>delete without header | none | 200 | 2 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 — 200 for unauthenticated |

### Sync

| Probe | Request | As | Status | ms | Response (truncated) | Verdict |
|---|---|---|---|---|---|---|
| SYNC-1 | `POST /sync/trigger`<br>trigger as alice (fake token -> job will fail in worker) | cmw8wea2c00001 | 201 | 6 | `{"success":true,"data":{"jobId":"1","status":"queued"}}` | ⚠️ Queued; job later fails (fake token) — see SYNC-5 |
| SYNC-2 | `POST /sync/trigger`<br>trigger again immediately (dedupe?) | cmw8wea2c00001 | 201 | 4 | `{"success":true,"data":{"jobId":"2","status":"queued"}}` | ❌ DATA-06 — second concurrent job queued, no de-duplication |
| SYNC-3 | `POST /sync/trigger`<br>trigger without header | none | 201 | 1 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 — 201 for unauthenticated |
| SYNC-4 | `POST /sync/trigger`<br>trigger with forged id | forged-user-id | 201 | 3 | `{"success":false,"error":"GitHub integration not connected"}` | ⚠️ API-01 — 201 with error |
| SYNC-5 | `GET /sync/status`<br>status as alice after failed jobs | cmw8wea2c00001 | 200 | 4 | `{"success":true,"data":{"status":"failed","jobId":"2","progress":0,"lastSync":"2026-11-09T06:49:22.163Z"}}` | ❌ BUG-08 — failed job's finish time reported as `lastSync` |
| SYNC-6 | `GET /sync/status`<br>status without header | none | 200 | 1 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 |
| SYNC-7 | `GET /sync/status`<br>status as forged id | forged-user-id | 200 | 3 | `{"success":true,"data":{"status":"idle","lastSync":null}}` | ⚠️ SEC-01 — forged id gets "idle" instead of 401 |
| SYNC-8 | `GET /sync/status`<br>status impersonating bob | cmw8wea8900h01 | 200 | 3 | `{"success":true,"data":{"status":"idle","lastSync":null}}` | ❌ SEC-01 — Bob's sync status via header |

### Activity

| Probe | Request | As | Status | ms | Response (truncated) | Verdict |
|---|---|---|---|---|---|---|
| ACT-1 | `GET /activity/commits`<br>commits as alice (default page) | cmw8wea2c00001 | 200 | 6 | `{"success":true,"data":{"data":[{"id":"cmw8wea2z0086149o1wnyalf8","userId":"cmw8wea2c0000149om69b8jf5","integrationId":"cmw8wea2i0002149osmryfek3","sh…` | ✅ Paginated commits (default 20) |
| ACT-2 | `GET /activity/commits?limit=100000`<br>commits limit=100000 (unbounded) | cmw8wea2c00001 | 200 | 7 | `{"success":true,"data":{"data":[{"id":"cmw8wea2z0086149o1wnyalf8","userId":"cmw8wea2c0000149om69b8jf5","integrationId":"cmw8wea2i0002149osmryfek3","sh…` | ❌ SEC-06 — returned all 292 rows |
| ACT-3 | `GET /activity/commits?limit=abc`<br>commits limit=abc | cmw8wea2c00001 | 200 | 2 | `{"success":false,"error":"Invalid page or limit"}` | ⚠️ API-01 — validation error with 200 |
| ACT-4 | `GET /activity/commits?page=0`<br>commits page=0 | cmw8wea2c00001 | 500 | 4 | `{"statusCode":500,"message":"Internal server error"}` | ❌ BUG-04 — page=0 → negative skip → 500 |
| ACT-5 | `GET /activity/commits?limit=-5`<br>commits limit=-5 | cmw8wea2c00001 | 200 | 5 | `{"success":true,"data":{"data":[{"id":"cmw8wea2x0007149orsfyjv6z","userId":"cmw8wea2c0000149om69b8jf5","integrationId":"cmw8wea2i0002149osmryfek3","sh…` | ❌ SEC-06 — negative limit accepted (returns oldest rows) |
| ACT-6 | `GET /activity/commits?from=garbage`<br>commits from=garbage | cmw8wea2c00001 | 500 | 4 | `{"statusCode":500,"message":"Internal server error"}` | ❌ BUG-04 — invalid date → 500 |
| ACT-7 | `GET /activity/commits`<br>commits without header | none | 200 | 1 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 |
| ACT-8 | `GET /activity/commits?limit=2`<br>commits impersonating bob | cmw8wea8900h01 | 200 | 3 | `{"success":true,"data":{"data":[{"id":"cmw8wea8b00hj149opisrgx2d","userId":"cmw8wea8900h0149oeju8wkdo","integrationId":"cmw8wea8a00h2149ofj90qa1n","sh…` | ❌ SEC-01 — Bob's commits via header |
| ACT-9 | `GET /activity/commits?from=2026-11-09&to=2026-11-09&limit=1`<br>commits to=today (date-only => midnight UTC, today excluded) | cmw8wea2c00001 | 200 | 4 | `{"success":true,"data":{"data":[],"total":0,"page":1,"limit":1}}` | ⚠️ BUG-05 — see date-range check below (same-day range returns 0) |
| ACT-10 | `GET /activity/prs?limit=5`<br>prs as alice (stub PR rows visible?) | cmw8wea2c00001 | 200 | 6 | `{"success":true,"data":{"data":[{"id":"cmw8wea7x00gh149ou434ctdf","userId":"cmw8wea2c0000149om69b8jf5","integrationId":"cmw8wea2i0002149osmryfek3","nu…` | ❌ DATA-01 — first page is all stub rows "PR #50xx" (reviewed PRs) |
| ACT-11 | `GET /activity/prs?limit=100000`<br>prs limit=100000 | cmw8wea2c00001 | 200 | 4 | `{"success":true,"data":{"data":[{"id":"cmw8wea7x00gh149ou434ctdf","userId":"cmw8wea2c0000149om69b8jf5","integrationId":"cmw8wea2i0002149osmryfek3","nu…` | ❌ SEC-06 — unbounded |
| ACT-12 | `GET /activity/prs?from=garbage`<br>prs from=garbage | cmw8wea2c00001 | 500 | 2 | `{"statusCode":500,"message":"Internal server error"}` | ❌ BUG-04 — 500 |
| ACT-13 | `GET /activity/prs`<br>prs without header | none | 200 | 1 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 |
| ACT-14 | `GET /activity/summary?from=2026-05-09&to=2026-11-09`<br>summary as alice, last 6 months | cmw8wea2c00001 | 200 | 17 | `{"success":true,"data":{"totalCommits":292,"totalPRs":106,"totalReviews":65,"totalIssues":0,"topRepos":[{"repo":"acme/platform-infra","commits":65},{"…` | ❌ DATA-01 — totalPRs 106 (41 authored + 65 stubs) |
| ACT-15 | `GET /activity/summary?from=garbage`<br>summary from=garbage | cmw8wea2c00001 | 500 | 3 | `{"statusCode":500,"message":"Internal server error"}` | ❌ BUG-04 — 500 |
| ACT-16 | `GET /activity/summary`<br>summary without header | none | 200 | 2 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 |
| ACT-17 | `GET /activity/summary`<br>summary impersonating bob | cmw8wea8900h01 | 200 | 6 | `{"success":true,"data":{"totalCommits":17,"totalPRs":17,"totalReviews":9,"totalIssues":0,"topRepos":[{"repo":"acme/web-app","commits":5},{"repo":"acme…` | ❌ SEC-01 — Bob's summary |

### Documents

| Probe | Request | As | Status | ms | Response (truncated) | Verdict |
|---|---|---|---|---|---|---|
| DOC-1 | `GET /documents`<br>list as alice | cmw8wea2c00001 | 200 | 4 | `{"success":true,"data":{"data":[{"id":"cmw8wea8700gz149ormyk51ue","userId":"cmw8wea2c0000149om69b8jf5","type":"RESUME","content":{"bullets":[{"text":"…` | ✅ Own documents listed |
| DOC-2 | `GET /documents?limit=100000`<br>list limit=100000 | cmw8wea2c00001 | 200 | 4 | `{"success":true,"data":{"data":[{"id":"cmw8wea8700gz149ormyk51ue","userId":"cmw8wea2c0000149om69b8jf5","type":"RESUME","content":{"bullets":[{"text":"…` | ❌ SEC-06 — unbounded |
| DOC-3 | `GET /documents`<br>list without header | none | 200 | 1 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 |
| DOC-4 | `GET /documents/cmw8wea8700gz149ormyk51ue`<br>get own doc | cmw8wea2c00001 | 200 | 4 | `{"success":true,"data":{"id":"cmw8wea8700gz149ormyk51ue","userId":"cmw8wea2c0000149om69b8jf5","type":"RESUME","content":{"bullets":[{"text":"Engineere…` | ✅ Own document |
| DOC-5 | `GET /documents/cmw8wea8x00ix149odzuzr5b3`<br>get bob's doc as alice (ownership check) | cmw8wea2c00001 | 200 | 3 | `{"success":false,"error":"Document not found"}` | ✅ Ownership enforced — but 200 "not found" |
| DOC-6 | `GET /documents/cmw8wea8x00ix149odzuzr5b3`<br>get bob's doc impersonating bob | cmw8wea8900h01 | 200 | 4 | `{"success":true,"data":{"id":"cmw8wea8x00ix149odzuzr5b3","userId":"cmw8wea8900h0149oeju8wkdo","type":"RESUME","content":{"bullets":[{"text":"Engineere…` | ❌ SEC-01 — Bob's document via header |
| DOC-7 | `DELETE /documents/cmw8wea8x00ix149odzuzr5b3`<br>delete bob's doc as alice | cmw8wea2c00001 | 200 | 13 | `{"success":false,"error":"Document not found"}` | ✅ Ownership enforced — but 200 |
| DOC-8 | `DELETE /documents/nope`<br>delete nonexistent doc | cmw8wea2c00001 | 200 | 4 | `{"success":false,"error":"Document not found"}` | ⚠️ API-01, BUG-12 |
| DOC-9 | `DELETE /documents/cmw8wea8x00ix149odzuzr5b3`<br>delete without header | none | 200 | 2 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 |
| DOC-10 | `GET /documents?page=abc`<br>list page=abc | cmw8wea2c00001 | 200 | 1 | `{"success":false,"error":"Invalid page or limit"}` | ⚠️ API-01 |

### Generation — validation & auth

| Probe | Request | As | Status | ms | Response (truncated) | Verdict |
|---|---|---|---|---|---|---|
| GEN-1 | `GET /generate/impact-score?month=11&year=2026`<br>impact-score current month (cached) | cmw8wea2c00001 | 200 | 4 | `{"success":true,"data":{"id":"cmw8wea7z00gl149o7s0x5zhn","userId":"cmw8wea2c0000149om69b8jf5","month":11,"year":2026,"overall":66,"featureDelivery":74…` | ⚠️ Cached LLM score returned (AI-01: score itself is LLM-generated) |
| GEN-2 | `GET /generate/impact-score?month=abc&year=2026`<br>impact-score month=abc | cmw8wea2c00001 | 200 | 4 | `{"success":false,"error":"\nInvalid `this.prisma.impactScore.findUnique()` invocation in\n/home/user/ai_/apps/api/src/generate/generate.service.ts:71:…` | ❌ BUG-04, SEC-12 — Prisma error text + server file path leaked |
| GEN-3 | `GET /generate/impact-score`<br>impact-score missing params | cmw8wea2c00001 | 200 | 1 | `{"success":false,"error":"month and year are required"}` | ⚠️ API-01 — 200 with error |
| GEN-4 | `GET /generate/impact-score?month=1&year=2026`<br>impact-score without header | none | 200 | 1 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 |
| GEN-5 | `POST /generate/resume` body `{"dateRange":{"from":"2026-01-01","to":"2026-06-30"},"role":…`<br>resume without header | none | 201 | 2 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 — 201 for unauthenticated |
| GEN-6 | `POST /generate/appraisal` body `{"period":"monthly","month":1,"year":2026}`<br>appraisal without header | none | 201 | 2 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 |
| GEN-7 | `POST /generate/promotion` body `{"currentRole":"a","targetRole":"b"}`<br>promotion without header | none | 201 | 2 | `{"success":false,"error":"Not authenticated"}` | ⚠️ API-01 |
| GEN-8 | `POST /generate/resume` body `{}`<br>resume empty body | cmw8wea2c00001 | 201 | 3 | `{"success":false,"error":"Cannot read properties of undefined (reading 'from')"}` | ❌ BUG-07, SEC-12 — TypeError message returned with 201 |

### Generation — happy path & abuse (mock Anthropic)

| Probe | Request | As | Status | ms | Response (truncated) | Verdict |
|---|---|---|---|---|---|---|
| GEN-R1-mock | `POST /generate/resume` body `{"dateRange":{"from":"2026-05-09","to":"2026-11-09"},"role":…`<br>resume valid | cmw8wea2c00001 | 201 | 71 | `{"success":true,"data":{"document":{"id":"cmw8wj6po0001x8alarw1qm8g","userId":"cmw8wea2c0000149om69b8jf5","type":"RESUME","content":{"bullets":[{"text…` | ❌ BUG-14 — response nests `bullets.bullets` (page renders an empty card); prompt mislabels total PRs as "merged" (AI-07); new document row every call (AI-03) |
| GEN-R2-mock | `POST /generate/appraisal` body `{"period":"quarterly","month":11,"year":2026}`<br>appraisal valid (quarterly) | cmw8wea2c00001 | 201 | 13 | `{"success":true,"data":{"document":{"id":"cmw8wj6s70003x8alpc6vpgtz","userId":"cmw8wea2c0000149om69b8jf5","type":"APPRAISAL","content":{"metrics":{"pr…` | ⚠️ Works; same caveats |
| GEN-R3-mock | `POST /generate/promotion` body `{"currentRole":"Senior Engineer","targetRole":"Staff Enginee…`<br>promotion valid | cmw8wea2c00001 | 201 | 13 | `{"success":true,"data":{"document":{"id":"cmw8wj6u50005x8alhbrb6hn8","userId":"cmw8wea2c0000149om69b8jf5","type":"PROMOTION","content":{"whyReady":"Co…` | ⚠️ Works; stub "PR #n" titles fed as Notable Work (AI-07) |
| GEN-R4-mock | `GET /generate/impact-score?month=1&year=2020`<br>impact-score uncached empty month (Jan 2020) -> LLM call | cmw8wea2c00001 | 200 | 11 | `{"success":true,"data":{"id":"cmw8wj6vx0007x8aloyi7hspp","userId":"cmw8wea2c0000149om69b8jf5","month":1,"year":2020,"overall":72,"featureDelivery":75,…` | ❌ AI-01, API-04 — GET triggers LLM call and stores a score for a month with 0 activity |
| GEN-R5-mock | `POST /generate/appraisal` body `{"period":"weird","month":13,"year":1900}`<br>appraisal invalid period/month/year accepted? | cmw8wea2c00001 | 201 | 11 | `{"success":true,"data":{"document":{"id":"cmw8wj6xi0009x8alldu3kwol","userId":"cmw8wea2c0000149om69b8jf5","type":"APPRAISAL","content":{"metrics":{"pr…` | ❌ BUG-07 — invalid period/month/year accepted, paid call made |
| GEN-R6-mock | `POST /generate/promotion` body `{}`<br>promotion empty body -> 'undefined' roles in prompt | cmw8wea2c00001 | 201 | 12 | `{"success":true,"data":{"document":{"id":"cmw8wj6z5000bx8alhygay39v","userId":"cmw8wea2c0000149om69b8jf5","type":"PROMOTION","content":{"whyReady":"Co…` | ❌ BUG-07 — prompt says "Current Role: undefined" |
| GEN-R7-mock | `POST /generate/resume` body `{"dateRange":{"from":"2026-05-09","to":"2026-11-09"},"role":…`<br>resume role=100KB string (no length limit) | cmw8wea2c00001 | 201 | 25 | `{"success":true,"data":{"document":{"id":"cmw8wj71g000dx8al29nbvkdv","userId":"cmw8wea2c0000149om69b8jf5","type":"RESUME","content":{"bullets":[{"text…` | ❌ SEC-07 — 100 KB role → 203,078-char prompt accepted |
| GEN-R8-mock | `POST /generate/resume` body `{"dateRange":{"from":"2026-05-09","to":"2026-11-09"},"role":…`<br>resume role containing $& (String.replace pattern) | cmw8wea2c00001 | 201 | 11 | `{"success":true,"data":{"document":{"id":"cmw8wj739000fx8aleb78qvfe","userId":"cmw8wea2c0000149om69b8jf5","type":"RESUME","content":{"bullets":[{"text…` | ❌ AI-05 — prompt became "Role: backend {{role}} lead" |
| GEN-R9-mock | `POST /generate/promotion` body `{"currentRole":"Senior $` Engineer","targetRole":"Staff"}`<br>promotion targetRole contains $` (prompt corruption) | cmw8wea2c00001 | 201 | 13 | `{"success":true,"data":{"document":{"id":"cmw8wj75e000hx8alw92mkhdf","userId":"cmw8wea2c0000149om69b8jf5","type":"PROMOTION","content":{"whyReady":"Co…` | ❌ AI-05 — `$`` spliced the prompt prefix into the role |
| GEN-R10-mock | `POST /generate/resume` body `{"dateRange":{"from":"2026-05-09","to":"2026-11-09"},"role":…`<br>resume role FORCE_400 -> retried non-retryable 400? | cmw8wea2c00001 | 201 | 3018 | `{"success":false,"error":"400 {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"mock 400\"}}"}` | ❌ AI-04, SEC-12 — non-retryable 400 retried 3× (3.0 s), raw error returned |
| GEN-R11-mock | `POST /generate/resume` body `{"dateRange":{"from":"2026-05-09","to":"2026-11-09"},"role":…`<br>resume role FORCE_PROSE -> greedy regex over 2 JSON objects | cmw8wea2c00001 | 201 | 3016 | `{"success":false,"error":"Unexpected non-whitespace character after JSON at position 62 (line 1 column 63)"}` | ❌ AI-03 — greedy regex over prose with two JSON objects → parse error, 3 billed calls |
| GEN-R12-mock | `GET /generate/impact-score?month=2&year=2020`<br>impact-score impersonating bob (spends quota on bob's behalf) | cmw8wea8900h01 | 200 | 9 | `{"success":true,"data":{"id":"cmw8wjbwz000jx8alaqlj36sy","userId":"cmw8wea8900h0149oeju8wkdo","month":2,"year":2020,"overall":72,"featureDelivery":75,…` | ❌ SEC-01 — LLM spend and DB write on Bob's account via header |

### Cross-cutting

| Probe | Request | As | Status | ms | Response (truncated) | Verdict |
|---|---|---|---|---|---|---|
| MISC-1 | `GET /does-not-exist`<br>unknown route | none | 404 | 2 | `{"message":"Cannot GET /api/does-not-exist","error":"Not Found","statusCode":404}` | ⚠️ Nest default 404 shape (not the envelope) |
| MISC-2 | `OPTIONS /activity/commits`<br>CORS preflight from evil origin | none | 204 | 1 | `` | ✅ Preflight OK; CORS origin is a fixed allow-list (see cross-cutting checks) |

### Destructive impersonation (run last)

| Probe | Request | As | Status | ms | Response (truncated) | Verdict |
|---|---|---|---|---|---|---|
| DEST-1 | `DELETE /documents/cmw8wea8x00ix149odzuzr5b3`<br>delete bob's document impersonating bob | cmw8wea8900h01 | 200 | 4 | `{"success":true,"data":{"message":"Document deleted"}}` | ❌ SEC-01 — Bob's document deleted by setting a header |
| DEST-2 | `DELETE /integrations/cmw8wea8a00h2149ofj90qa1n`<br>disconnect bob's integration impersonating bob (cascade-deletes activity) | cmw8wea8900h01 | 200 | 5 | `{"success":true,"data":{"message":"Integration disconnected"}}` | ❌ SEC-01, DATA-07 — Bob's integration deleted; cascade wipes his activity |
| DEST-3 | `GET /activity/summary`<br>bob's commits after disconnect | cmw8wea8900h01 | 200 | 20 | `{"success":true,"data":{"totalCommits":0,"totalPRs":0,"totalReviews":0,"totalIssues":0,"topRepos":[],"impactScore":66}}` | ❌ DATA-07 — Bob now has 0 commits / 0 PRs |
