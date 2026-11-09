# ADR-0003: Authentication — Better Auth in the web app, short-lived JWTs to the API

**Status:** Accepted — **user decision (2026-11-09): "Better Auth in web"**
**Date:** 2026-11-09
**Deciders:** Project owner; Phase 03

## Context
v0.1.0 has no authentication: the API trusts an `x-user-id` header (SEC-01) and a public
`dev-login` creates/returns any account (SEC-02). An unused NextAuth v4 route ships with
advisories (SEC-09, SEC-15). v2 needs GitHub + Google sign-in, sessions stored in Postgres, and a
way for a separately deployed NestJS API (possibly on another origin) to trust requests.

## Decision
1. **Better Auth** runs inside `apps/web` (`/api/auth/[...all]` route handler) with the Prisma
   adapter on the shared Postgres database.
   - Social providers: **GitHub** (a dedicated OAuth App, scopes `read:user user:email`) and
     **Google** (`openid email profile`).
   - `account.encryptOAuthTokens: true`; `accountLinking` enabled for trusted providers
     (`github`, `google`) on verified email — also links legacy v0.1 users by email.
   - Session cookie: `HttpOnly`, `Secure` (prod), `SameSite=Lax`, 30-day rolling expiry.
   - `plan` exposed as an `additionalField` with `input: false`.
2. **JWT plugin** issues API tokens: EdDSA (Ed25519), `sub = userId`, `iss = AUTH_JWT_ISSUER`,
   `aud = devimpact-api`, `exp = 15 min`; keys in the `jwks` table; public keys at `/api/auth/jwks`.
3. **NestJS** verifies tokens in a global `AuthGuard` using `jose.createRemoteJWKSet(AUTH_JWKS_URL)`
   (cached, refetch on unknown `kid`), checks `iss`, `aud`, `exp`, `nbf` (60 s clock tolerance),
   loads nothing else (stateless) and sets `req.user = { id }`. `@CurrentUser()` and `@Public()`
   decorators. The `x-user-id` header is removed everywhere.
4. **Clients:** RSC/server code gets a token via `auth.api.getToken({ headers })`; the browser
   gets one from `GET /api/auth/token` (cached in memory until 60 s before expiry) and sends
   `Authorization: Bearer`. The API uses no cookies, so CSRF does not apply to it.
5. **Dev login:** web route `POST /api/dev-login` signs in a seeded user (Better Auth
   email/password provider enabled only when `NODE_ENV !== 'production' && ENABLE_DEV_LOGIN === 'true'`).
   The route returns 404 otherwise; a unit test proves it in a production build.
6. **Sign-in identity ≠ data source** (ADR-0004): sign-in tokens are never used to read activity.

## Options Considered

### Option A: Better Auth in web + JWT/JWKS to API (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | Free, self-hosted |
| Scalability | Stateless API verification; sessions in Postgres |
| Team familiarity | Medium; TypeScript-first, Prisma adapter |

**Pros:** actively maintained (the Auth.js team now maintains Better Auth); built-in JWT/JWKS,
account linking, rate limiting, session management; works across origins.
**Cons:** newer library — pin exact versions; JWT revocation is bounded by the 15-minute TTL.

### Option B: Auth.js v5 in web
| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | Free |
| Scalability | Similar |
| Team familiarity | Higher (NextAuth lineage) |

**Pros:** familiar. **Cons:** maintenance mode; JWT-for-external-API needs custom signing; v4 → v5 migration anyway.

### Option C: NestJS-owned auth (Passport + httpOnly cookies)
**Pros:** one auth surface in the API. **Cons:** cookies across web/API origins need a shared parent
domain and CSRF protection; rebuild session management ourselves. Rejected.

## Trade-off Analysis
Keeping sessions next to the UI gives the best sign-in UX and middleware-based route protection,
while JWT/JWKS keeps the API stateless and origin-independent. The accepted cost is up to 15
minutes of token validity after sign-out; destructive actions require a fresh session check on
the web side before calling the API.

## Consequences
- Easier: real multi-user isolation (fixes SEC-01/02/15, GAP-06, API-03); hosting-neutral topology.
- Harder: two places to configure auth (web issues, API verifies); key rotation must be documented.
- Revisit: shorter TTL or a revocation list if security review (P14) requires it.

## Action Items
1. [ ] P05: Better Auth + Prisma adapter + JWT plugin; `AuthGuard` with JWKS; remove all 17 `x-user-id` reads.
2. [ ] P05: `/api/dev-login` gated; production-build test.
3. [ ] P05: README — create GitHub OAuth App (sign-in) and Google OAuth client, callback URLs.
4. [ ] P09: full sign-in UI, middleware route protection for `(app)`.
5. [ ] P14: verify cookie flags, JWT validation edge cases, key rotation runbook.
