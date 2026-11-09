# Phase 15 — Release: Deployment, Documentation & v2.0.0

| | |
|---|---|
| **Goal** | Ship v2.0.0: production-grade images and deployment, CI/CD, environment and secrets management, complete documentation, changelog, tagged release. |
| **Type** | Ops + docs |
| **Prerequisites** | P14 merged (release-ready) |
| **Parallel with** | — |
| **Effort** | 1 session; requires the user for hosting accounts/secrets |

## Context
D-013 (hosting) may still need the user's final choice. Docker Compose self-hosting must always
work. The cloud session cannot create hosting accounts or hold real secrets: prepare everything,
then guide the user through the steps that need their credentials (use `request_credential` /
environment tools only if the user wants the session to deploy).

## Read first
`DECISIONS.md` (hosting), `blueprint/ARCHITECTURE_V2.md`, P14 reports and runbooks,
root `README.md`. Skills: `engineering:deploy-checklist`, `engineering:documentation`;
`vercel:deploy` / `vercel:deployments-cicd` if Vercel is chosen.

## USER DECISIONS
1. Final hosting platform(s) for web, API, worker, Postgres, Redis (recommend per D-013).
2. Domain name and email sender domain.
3. Whether this session should perform the deployment (needs credentials) or only prepare it.

## Tasks

### A. Production build & runtime
1. Multi-stage, minimal, non-root Docker images for api, worker, web (Next `standalone`);
   healthchecks; `prisma migrate deploy` as a release step (not on every container start in
   multi-replica setups).
2. `docker-compose.prod.yml` (or Compose profiles) with reverse proxy (Caddy/Traefik) + TLS for
   self-hosting; documented resource sizing.
3. Platform configs for the chosen hosting (e.g. `vercel.json`, `fly.toml`/`render.yaml`), with
   preview environments for PRs if supported.

### B. CI/CD
4. Release workflow: on tag `v*` → build & push images (GHCR), run migrations, deploy, smoke test
   (`/api/health`, sign-in page, E2E smoke against the deployed URL), rollback instructions.
5. Environments: dev / staging / production variables documented; secrets only in platform secret
   stores; `.env.example` complete and commented; env schemas validated at boot.

### C. Documentation
6. Root `README.md` rewritten for v2: what it is, screenshots, features, quick start (Compose),
   local development, architecture overview (link to blueprint), configuration reference.
7. `docs/` set: `SETUP_OAUTH.md` (GitHub/Google/others app registration with callback URLs and
   scopes), `DEPLOYMENT.md` (self-host + managed), `OPERATIONS.md` (runbooks index, monitoring,
   backups), `ARCHITECTURE.md` (final, condensed from blueprint), `API.md` (link to OpenAPI),
   `CONTRIBUTING.md`, `SECURITY.md` (vulnerability reporting), `PRIVACY.md` (final), user guide
   (`docs/USER_GUIDE.md`: onboarding, KPIs explained, documents, achievements, goals, FAQ incl.
   "how are scores calculated").
8. `CHANGELOG.md` (Keep a Changelog) with v2.0.0 summarising changes since v0.1.0 by area, and a
   migration note for anyone running v0.1.0 (DB migration path from DATA_MODEL_V2).
9. Update `.agents/skills/testing-frontend/SKILL.md` (or replace with a v2 testing skill) so future
   agents can run and test the stack.

### D. Release
10. Final full `npm run check` + E2E + deploy checklist (`engineering:deploy-checklist`).
11. Bump versions to `2.0.0` across workspaces; footer/about shows version.
12. Tag `v2.0.0`, create a GitHub release with notes (from CHANGELOG) and screenshots.
13. Post-release: verify production smoke, monitoring dashboards receiving data, error tracker
    clean for the first hour (if deployed in-session); list follow-ups (v2.1 backlog from
    deferred items, P13 if not done, manager/team features, billing) in `docs/v2/ROADMAP_V2_1.md`.
14. Mark the plan complete in PROGRESS.md.

## Acceptance criteria
- [ ] `docker compose -f docker-compose.prod.yml up` on a clean machine yields a working HTTPS app (or documented equivalent tested locally without TLS).
- [ ] Release workflow builds images and (if deployed) passes post-deploy smoke tests.
- [ ] A new developer can go from clone to running app with seed data using only README in < 15 minutes (walk through it in a fresh container and time it).
- [ ] All docs listed in task 7 exist and are accurate; CHANGELOG has v2.0.0.
- [ ] `v2.0.0` tag and GitHub release exist (or are prepared for the user to publish).
- [ ] ROADMAP_V2_1.md captures every deferred item from PROGRESS.md and ISSUES.md.

## Handoff
Final PROGRESS.md entry: release links, deployed URLs (if any), credentials the owner must rotate
or store, and the v2.1 roadmap pointer.

---

## Blueprint amendments (P03, 2026-11-09)
Appended by Phase 03; these take precedence over conflicting text above.

1. **Hosting (D-013 / ADR-0013):** the owner deferred the choice to this phase — USER DECISION 1
   stands. The platform must satisfy ADR-0013's constraints (SSE streaming ≥ 5 min without
   buffering, Redis Streams, separate worker process). Record the choice as an ADR superseding ADR-0013.
2. **Migration:** run P15-1 (`drop_legacy`) from DATA_MODEL_V2 §5.
3. **Roadmap:** `ROADMAP_V2_1.md` must include P13 (GitLab/Jira/Linear), manager/team views,
   Stripe billing, share links, in-app notifications (if deferred), issue metrics, OAuth-App
   fallback evaluation (ADR-0004), anchor recalibration `impact@2.1.0` (ADR-0008).
4. **OAuth setup docs:** two GitHub registrations (sign-in OAuth App + data GitHub App) and Google.
