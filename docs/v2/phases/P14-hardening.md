# Phase 14 — Hardening: QA, Security, Performance, Accessibility, Observability

| | |
|---|---|
| **Goal** | Prove v2 is production-ready: full regression of every user journey, security review, performance and load testing, accessibility audit, observability, backups and privacy compliance — and fix what is found. |
| **Type** | QA + code fixes |
| **Prerequisites** | P12 merged (P13 merged or explicitly out of scope) |
| **Parallel with** | — |
| **Effort** | 1–2 sessions |

## Context
All features are built. This phase does not add features; it finds and fixes defects and closes
operational gaps. Every finding gets an ID in `audit/ISSUES.md`; 🔴/🟠 must be fixed here; 🟡/⚪
either fixed or explicitly accepted for post-release.

## Read first
`blueprint/PRD.md` (NFRs, performance budgets), `blueprint/ARCHITECTURE_V2.md` (observability),
`audit/ISSUES.md` (all open rows), all phase handoffs in PROGRESS.md. Skills: `security-review`,
`design-skills:accessibility-audit`, `engineering:testing-strategy`, `engineering:deploy-checklist`.

## Tasks

### A. Functional QA
1. Write `docs/v2/qa/TEST_PLAN.md`: every PRD journey and screen state → test case (automated
   E2E ID or manual step). Fill gaps in the Playwright suite so every "Must" journey is automated:
   sign-in, onboarding, sync, dashboard, activity, KPIs, impact, career, every document type
   (generate/edit/export), achievements, goals, settings, data export, account deletion, sign-out.
2. Cross-browser run (Chromium + Firefox + WebKit via Playwright where installable) and mobile
   viewports. Record results in `docs/v2/qa/QA_REPORT.md`.
3. Re-run the P01 API probe script; compare with v1 results; all v1 🔴/🟠 issues must be closed.

### B. Security
4. Run `security-review` on the whole codebase; OWASP ASVS L1/L2-style checklist (authn, session,
   access control, validation, crypto, errors/logging, data protection, config).
5. `npm audit` (prod deps) → zero high/critical; Dependabot/Renovate config added.
6. Secret scanning (gitleaks or GitHub secret scanning) on full history; rotate anything found.
7. Verify: CSP + security headers on web; cookies `HttpOnly/Secure/SameSite`; CSRF strategy for
   cookie auth; SSRF not possible (self-managed GitLab URL validation if P13); webhook endpoints;
   rate limits; AI prompt-injection evals still pass; tokens never in logs (log grep test).
8. Write `docs/v2/qa/SECURITY_REPORT.md` with findings and fixes.

### C. Performance & load
9. Lighthouse on every main page (production build, seeded heavy user): performance,
   accessibility, best practices ≥ 90. Bundle analysis; fix regressions.
10. API load test (k6 or autocannon) on read endpoints (overview, timeseries, feed, documents list)
    at a documented target (e.g. 50 RPS, p95 < 300 ms) and a sync throughput test in the worker.
11. DB: check slow queries (`pg_stat_statements`), missing indexes, N+1s, connection pool sizing.

### D. Accessibility
12. Full WCAG 2.2 AA audit (`accessibility-audit` skill): automated axe on all pages + manual
    keyboard and screen-reader pass (landmarks, headings, chart alternatives, focus management in
    dialogs/drawers, streaming content announcements via `aria-live`). Report in
    `docs/v2/qa/A11Y_REPORT.md`; fix all A/AA failures.

### E. Observability & operations
13. Error tracking (Sentry or equivalent, env-gated) for web, API and worker with release tagging
    and PII scrubbing. OpenTelemetry traces (or at least structured logs with trace IDs) across
    web → API → worker → external calls.
14. Metrics/dashboards: request rates/latency/errors, queue depth/job failures, sync durations,
    AI tokens/cost per day, GitHub rate-limit headroom. Alert rules documented.
15. Bull Board (or equivalent) admin UI behind admin auth for queue inspection.
16. Graceful shutdown for API and worker (drain jobs), readiness vs liveness endpoints.
17. Backup/restore procedure for Postgres documented and tested once locally; data retention
    jobs (e.g. old SyncRuns, AiUsage aggregation) per DATA_MODEL_V2.
18. Privacy: verify data export/deletion, write `docs/PRIVACY.md` draft (data collected, purposes,
    retention, sub-processors incl. Anthropic, GitHub) and in-app links.

## Deliverables
```
docs/v2/qa/TEST_PLAN.md
docs/v2/qa/QA_REPORT.md
docs/v2/qa/SECURITY_REPORT.md
docs/v2/qa/A11Y_REPORT.md
docs/v2/qa/PERF_REPORT.md
docs/PRIVACY.md (draft)
```
plus fixes, expanded E2E suite, observability wiring, runbooks in `docs/runbooks/`.

## Acceptance criteria
- [ ] Every PRD "Must" journey has an automated E2E test; full suite green in CI.
- [ ] Zero open 🔴/🟠 issues in `audit/ISSUES.md`; 🟡/⚪ either fixed or accepted with rationale.
- [ ] `npm audit --omit=dev`: no high/critical; secret scan clean.
- [ ] Lighthouse ≥ 90 on all main pages; load test meets documented targets.
- [ ] WCAG 2.2 AA: no outstanding A/AA failures.
- [ ] Errors from web/API/worker reach the error tracker in a staging-like run; dashboards + alerts documented.
- [ ] Backup + restore tested once; runbooks exist for: sync failures, AI outage/quota, token revocation spike, DB restore.
- [ ] `npm run check` + CI green.

## Handoff
Release-readiness summary in PROGRESS.md: what's accepted risk, what's monitored, open low-priority items.
