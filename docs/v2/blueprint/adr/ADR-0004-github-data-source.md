# ADR-0004: GitHub data source — a GitHub App, separate from sign-in

**Status:** Accepted — **user decision (2026-11-09): "GitHub App"**
**Date:** 2026-11-09
**Deciders:** Project owner; Phase 03

## Context
v0.1.0 used one OAuth App with the `repo` scope (full read **and write** to all private repos —
SEC-05) for both sign-in and data, stored the token in plaintext (SEC-03), had no `state`
(SEC-04), no webhooks and no incremental sync (GAP-01). DevImpact only needs **read** access.

## Decision
1. **Sign-in** uses a GitHub **OAuth App** with identity scopes only (`read:user user:email`),
   handled by Better Auth (ADR-0003). Google sign-in users can connect GitHub as a data source.
2. **Data** comes from a **GitHub App** ("DevImpact AI"):
   - Repository permissions (read-only): **Metadata**, **Contents** (commit history/stats),
     **Pull requests**. Account permissions: none beyond email (optional). No write permissions.
   - Webhook events: `pull_request`, `pull_request_review`, `push`, `installation`,
     `installation_repositories`, `github_app_authorization`.
   - "Request user authorization (OAuth) during installation" enabled; **expiring user tokens**
     enabled (8 h access token, 6-month refresh token).
   - Sync calls use the **user-to-server token** (GraphQL search across installations + public
     repos; actions attributed to the user). Installation tokens (JWT-signed with the App private
     key) are used only for installation metadata and as a fallback for webhook-targeted fetches.
3. Users choose repositories on GitHub's install screen ("all" or "selected"), then can further
   include/exclude repos in DevImpact (F-11).
4. Connect flow uses a signed, single-use, 10-minute `state` bound to the user (HMAC with
   `OAUTH_STATE_SECRET` + Redis nonce) — ARCHITECTURE_V2 §5.
5. Disconnect revokes the user token (`DELETE /applications/{client_id}/token`); uninstall is
   linked to GitHub settings.

## Options Considered

### Option A: GitHub App (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium–High (app registration, private key, token refresh, installations) |
| Cost | Free |
| Scalability | Webhooks per installation; installation rate limits scale with repos; user tokens 5,000 req/h |
| Team familiarity | Medium |

**Pros:** least privilege (read-only, per repo); users see exactly what is shared; built-in
webhooks for all installed repos; expiring tokens limit blast radius.
**Cons:** private org repos require the org to install/approve the app — contributions there are
invisible until approved; more moving parts.

### Option B: OAuth App with minimal scopes
| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | Free |
| Scalability | 5,000 req/h per user; webhooks need per-repo admin rights |
| Team familiarity | High |

**Pros:** sees every repo the user can see. **Cons:** private repos still require `repo` (read+write);
no practical webhooks; long-lived tokens.

### Option C: GitHub App + OAuth App fallback
**Pros:** coverage where orgs block apps. **Cons:** two code paths, two permission stories. Rejected for v2.0 (revisit in v2.1 if activation data shows org-approval blocking users).

## Trade-off Analysis
Least privilege and webhooks outweigh the org-approval friction. Public-repo work is still
visible without installation (user tokens can read public data), and the onboarding explains how
to request org approval (`setup_action=request`).

## Consequences
- Easier: security story (fixes SEC-05; with ADR-0005 limits SEC-03 impact), webhooks (GAP-01),
  per-repo selection.
- Harder: token refresh logic, installation bookkeeping (`GitHubInstallation`), handling
  `installation_repositories` changes; local webhook testing needs `smee.io` or `gh webhook forward`.
- Legacy v0.1 OAuth tokens cannot be reused → migrated integrations become `NEEDS_REAUTH`
  (DATA_MODEL_V2 §5).
- Revisit: OAuth fallback (Option C) if > 20 % of connect attempts end in pending org approval.

## Action Items
1. [ ] P05: document GitHub App registration (permissions, events, callback/setup/webhook URLs) in README; implement connect/callback with state.
2. [ ] P06: token refresh, installations, webhook endpoint, `needs_reauth` handling.
3. [ ] P09/P10: onboarding and integrations UI for install, approval-pending and reconnect states.
