# ADR-0005: Encrypt provider tokens at rest (AES-256-GCM, versioned keys)

**Status:** Accepted (amends D-005: key-list format, AAD binding, legacy-token handling)
**Date:** 2026-11-09
**Deciders:** Phase 03

## Context
`Integration.accessToken` is plaintext (SEC-03). v2 stores GitHub App user access tokens (8 h)
and refresh tokens (6 months). A database or backup leak must not yield usable tokens.

## Decision
- **Algorithm:** AES-256-GCM via Node `crypto`, random 96-bit IV per encryption, 128-bit tag.
- **Format** (single text column): `v<keyVersion>.<base64url(iv)>.<base64url(ciphertext)>.<base64url(tag)>`.
- **AAD:** `integration:<integrationId>:<field>` — a ciphertext copied to another row or field fails to decrypt.
- **Keys:** `TOKEN_ENCRYPTION_KEYS="1:<base64 32 bytes>,2:<base64 32 bytes>"` and
  `TOKEN_ENCRYPTION_ACTIVE_KEY=2`. Encrypt with the active key; decrypt with the version in the
  prefix. Startup fails if the active key is missing or any key is not 32 bytes.
- **Rotation:** add a new key, switch active, run `prisma/scripts/reencrypt-tokens.ts`
  (idempotent), then remove the old key. Runbook in P14.
- **Handling rules:** tokens are decrypted only inside the GitHub provider at call time; never
  selected by list/read queries (Prisma `omit`/explicit `select`), never returned by the API,
  never logged (pino redaction), never put in job payloads (jobs carry `integrationId`).
- **Legacy tokens:** v0.1 OAuth App tokens are **dropped**, not encrypted — they cannot drive the
  GitHub App and keeping them only extends exposure (DATA_MODEL_V2 §5 P05-3). Affected
  integrations become `NEEDS_REAUTH`.
- **Sign-in tokens** in Better Auth's `account` table use the library's `encryptOAuthTokens`
  (keyed by `BETTER_AUTH_SECRET`).

## Options Considered

### Option A: Application-level AES-256-GCM with env keys (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | None |
| Scalability | Fine |
| Team familiarity | High |

**Pros:** portable across hosts; testable (round-trip, tamper, wrong-AAD tests). **Cons:** keys live in env/secret store; app compromise still exposes tokens in memory.

### Option B: Cloud KMS envelope encryption
**Pros:** HSM-backed keys, audit. **Cons:** ties to a cloud provider before hosting is chosen (ADR-0013). Kept as an upgrade path: the `v<n>` prefix allows a `kms` key type later.

### Option C: Postgres `pgcrypto`
**Pros:** transparent. **Cons:** key passes through SQL and logs; harder rotation. Rejected.

## Trade-off Analysis
Option A removes the DB-leak risk now with no vendor dependency; KMS can be added behind the same
interface once hosting is decided.

## Consequences
- Easier: passing SEC-03 acceptance ("DB inspection shows no plaintext tokens").
- Harder: key management and rotation are now operational duties.
- Revisit: KMS in P15 if the chosen host offers it cheaply.

## Action Items
1. [ ] P05: `TokenCipher` service + unit tests (round trip, tamper → error, wrong AAD → error, unknown version → error, rotation).
2. [ ] P05: env validation for key list; migration drops plaintext columns.
3. [ ] P14: rotation runbook and test.
