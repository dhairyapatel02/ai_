# Phase 05 — Backend Platform: Auth, Security & API Conventions

| | |
|---|---|
| **Goal** | Replace the fake auth with real authentication, secure the API, and establish the API conventions (validation, errors, envelope, pagination, rate limits, logging) every later backend phase builds on. |
| **Type** | Code (API + minimal web wiring for sign-in) |
| **Prerequisites** | P02 (harness, CI) and P03 (confirmed auth ADR, API contract, data model) merged |
| **Parallel with** | P04 |
| **Effort** | 1 session (large) |

## Context
Today every controller reads `req.headers['x-user-id']`; the web app auto-calls a public
`/auth/dev-login`; OAuth tokens are plaintext; OAuth has no `state`; errors return HTTP 200;
request bodies are not validated; there is no rate limiting. These are the 🔴/🟠 `SEC-*` and
`API-*` items in `audit/ISSUES.md`. The chosen auth design is in `DECISIONS.md` (D-003) and its ADR.

## Read first
`DECISIONS.md` (auth, token encryption, API conventions ADRs), `blueprint/ARCHITECTURE_V2.md`
(auth flow), `blueprint/API_CONTRACT_V2.md`, `blueprint/DATA_MODEL_V2.md`, `audit/ISSUES.md`
(target = 05). Skill: `security-review` for a final self-review.

## Objectives
1. Real sign-in (GitHub + Google) with verified sessions; API derives the user from a verified
   credential only.
2. Tokens encrypted at rest; OAuth flows CSRF-safe.
3. Uniform validation, errors and response envelope with correct HTTP codes.
4. Abuse controls: rate limits (stricter for AI), security headers, CORS, request size limits.
5. Structured logging with request IDs and no secret leakage.

## Tasks

### A. Schema migration (auth + platform parts only)
1. Apply the auth-related parts of `DATA_MODEL_V2` via a Prisma migration: auth library tables
   (accounts/sessions/verification), `Integration` changes (encrypted token columns, scopes,
   status), `UserSettings` (timezone). Write a data migration for existing rows. Other model
   changes belong to P06–P08 — don't do them here unless the ADR requires it.

### B. Authentication
2. Implement sign-in in the web app per the ADR (e.g. Better Auth / Auth.js v5 with GitHub and
   Google providers, Prisma adapter). Minimal identity scopes.
3. Implement the API side: global `AuthGuard` that verifies the session/JWT, attaches
   `req.user`, and a `@CurrentUser()` decorator. `@Public()` decorator for health/webhooks.
4. Remove **all** `x-user-id` reads (17 call sites) — replace with `@CurrentUser()`.
5. Gate `dev-login` behind `NODE_ENV !== 'production' && ENABLE_DEV_LOGIN === 'true'`; it must
   be impossible to enable in production builds. Keep it for E2E tests and local demo with seed data.
6. Web: minimal sign-in page and route protection (middleware) so the existing pages keep working
   with real auth; replace localStorage user-id logic in `auth-context.tsx` with the session.
   (Full UI redesign is P09 — keep this functional, not pretty.)
7. `GET /api/me` (and keep `/api/auth/me` as alias if the contract says so), `DELETE /api/me`
   (account deletion with cascade — required for privacy), sign-out.

### C. Integrations security
8. Token encryption service (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`, key-version prefix, unit tests
   incl. tamper detection). Migrate existing plaintext tokens. Tokens are never selected by list
   endpoints nor logged.
9. GitHub connect flow: signed, expiring `state` bound to the user (stored server-side or HMAC),
   verified on callback; PKCE if the provider supports it. Handle denied consent and errors.
   Implement per the GitHub App vs OAuth App ADR.
10. Disconnect: confirm-able, revoke the token at GitHub when possible; behaviour for existing
    synced data per ADR (keep vs purge, user choice).

### D. API conventions
11. Zod validation pipe using schemas from `packages/shared`; migrate every existing endpoint's
    params/query/body to shared schemas (cap `limit` ≤ 100, validate dates, enums, IDs).
12. Global exception filter + response interceptor producing the D-006 envelope with correct
    status codes and stable error codes (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
    `VALIDATION_FAILED`, `RATE_LIMITED`, `CONFLICT`, `UPSTREAM_ERROR`, `INTERNAL`).
13. Ownership checks: every resource lookup scoped by `userId`; return 404 (not 500) for others'
    IDs. Add integration tests proving cross-user access is impossible for every resource.
14. OpenAPI generation from Zod schemas, served at `/api/docs` outside production.

### E. Hardening
15. `helmet`, strict CORS (configured origins), body size limit, `@nestjs/throttler` backed by
    Redis: default tier and a strict AI tier (per user per minute + per day).
16. Structured logging (`nestjs-pino`): request id, user id, latency; redact auth headers,
    cookies, tokens, `ANTHROPIC_API_KEY`.
17. Upgrade Next.js at least to the latest patched 14.2.x if P02 didn't (the major upgrade is P09).
18. Run the `security-review` skill on the diff; fix findings.

### F. Tests
19. Unit: encryption, guard, state signing, exception filter. Integration: auth required on every
    non-public route (generated test iterating the router), ownership tests, validation failures
    return 400 with details, rate limit returns 429. E2E: sign in via dev-login in test env →
    dashboard loads. Un-skip any P02 known-bug tests fixed here.

## Deliverables
Auth implementation (web + API), migration(s), encryption service, validation/exception/
envelope infrastructure, throttling, logging, OpenAPI, tests, updated `.env.example`, README
auth setup section (how to create GitHub/Google OAuth apps, callback URLs), PROGRESS.md.

## Acceptance criteria
- [ ] `grep -r "x-user-id" apps/` returns nothing.
- [ ] Requests without valid credentials to any non-public route → 401 (proved by a generated test over all routes).
- [ ] User A cannot read/modify/delete any of user B's resources (tests per resource).
- [ ] `dev-login` returns 404 in a production build even if `ENABLE_DEV_LOGIN=true`.
- [ ] DB inspection shows no plaintext tokens; decrypt round-trip and tamper tests pass.
- [ ] OAuth callback with missing/invalid/expired `state` is rejected.
- [ ] Invalid input → 400 with `VALIDATION_FAILED` and field details; errors never return 200.
- [ ] AI endpoints are rate-limited (429 test).
- [ ] Logs contain request IDs and no tokens/secrets (test or manual evidence).
- [ ] `npm run check` and CI green; P01 API probe script re-run and results appended to `audit/API_TEST_RESULTS.md` (v2 column).

## Human review checklist
Create real GitHub/Google OAuth apps per the README and sign in locally once.

## Handoff
Document: how to get a session in tests/E2E, new env vars, the error-code list, and the pattern
for adding a new endpoint (schema in shared → controller → test).
