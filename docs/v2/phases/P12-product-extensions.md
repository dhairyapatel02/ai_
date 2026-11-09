# Phase 12 — Product Extensions

| | |
|---|---|
| **Goal** | Add the features that turn a metrics viewer into a career OS: achievements journal, goals, digests/notifications, complete settings (profile, notifications, privacy & data, plan/usage). |
| **Type** | Code (API + web + worker) |
| **Prerequisites** | P10 and P11 merged |
| **Parallel with** | P13 |
| **Effort** | 1 session (large). Split into 12a/12b if the PRD scope is large. |

## Context
Code activity alone misses much of an engineer's impact (mentoring, incidents, design docs,
interviews, cross-team work). v0.1.0 settings page is static (non-functional notification
toggles, plan badge only). The PRD (`blueprint/PRD.md`) defines which of these features are
"Must" vs "Should" for v2.0 — **implement only what the PRD marks in scope** and log the rest.

## Read first
`blueprint/PRD.md` (feature priorities), `blueprint/DATA_MODEL_V2.md` (`Achievement`, `Goal`,
`UserSettings`), `blueprint/API_CONTRACT_V2.md`, `design/SCREENS.md` (Achievements, Goals,
Settings), P08 handoff (generators usable for digests), P11 handoff.

## Tasks

### A. Achievements journal ("brag document")
1. Model/migration + CRUD API: title, description, date, category (delivery, quality, mentoring,
   incident, leadership, learning, other), impact statement, links, linked evidence refs
   (PRs/commits), visibility. Zod schemas in shared.
2. UI: list/timeline with filters, quick-add dialog (also from ⌘K and dashboard), "Turn into
   achievement" from Activity explorer (P10) pre-filled via the P08 enhance endpoint.
3. Feed achievements into: activity feed, career timeline, metrics where defined, and the P08
   `EvidenceBuilder` (so documents cite them).

### B. Goals
4. Model/migration + API: goal (title, description, target date, status, optional metric target
   e.g. "review turnaround < 24h", linked achievements/evidence). Progress computed from P07 metrics
   where a metric target exists.
5. UI: goals list + detail with progress, link evidence, include goals in appraisal generation
   ("Goals for next period" section can propose new goals).

### C. Notifications & digests
6. Email provider abstraction (Resend/SES/SMTP via env; console transport in dev).
7. Weekly digest job (worker, user's timezone, opt-in): metrics deltas, notable PRs, suggested
   achievements to capture; optional AI summary using P08 (fast model, cached). Unsubscribe link
   (signed token).
8. In-app notifications (optional per PRD): sync failures, needs-reauth, document ready.

### D. Settings
9. Profile (name, avatar, role/level, timezone — used by P07 periods), Notifications (functional
   toggles), Privacy & data (repo include/exclude shortcut, redact private repo names in AI
   output toggle, **export all my data** as JSON/ZIP job, **delete my account**), Plan & usage
   (current plan, AI usage vs quota from `/me/usage`; billing integration only if PRD includes it —
   otherwise a "contact/upgrade" placeholder).

### E. Plan limits
10. Central `Entitlements` service (plan → limits: AI generations/month, history window, number of
    integrations, digests). Enforce in API, reflect in UI (disabled states + upgrade copy).

### F. Tests
11. Unit/integration tests for every new endpoint (auth, ownership, validation), digest job with
    fake clock + timezone cases, data export completeness, account deletion cascade (no orphan
    rows), entitlements enforcement. E2E: add achievement → appears in timeline → included as a
    citation in a generated appraisal (mocked AI).

## Deliverables
Achievements, goals, notifications/digests, full settings, entitlements, tests, screenshots in
`docs/v2/screenshots/p12/`, PROGRESS.md (with any PRD features deferred).

## Acceptance criteria
- [ ] Every PRD "Must" feature assigned to P12 is implemented and E2E-tested, or explicitly deferred with the owner's agreement noted in DECISIONS.md.
- [ ] Achievements appear in feed, timeline and as citable evidence in generated documents.
- [ ] Digest email renders (snapshot test) and respects timezone + opt-out; unsubscribe works without login.
- [ ] Data export contains all user-owned records; account deletion leaves zero rows for the user (test).
- [ ] Plan limits enforced server-side and reflected in UI.
- [ ] No non-functional settings controls remain.
- [ ] `npm run check` + CI green.

## Handoff
List deferred features, email provider config, and anything P14 should load/security-test specifically.

---

## Blueprint amendments (P03, 2026-11-09)
Appended by Phase 03; these take precedence over conflicting text above.

1. **Scope per PRD §5.5:** Must — achievements journal + evidence, goals with metric targets,
   weekly digest email (opt-in), notification preferences, data export, account deletion UI,
   plan & usage page, entitlements. Should — AI digest summary. Could — monthly digest, in-app
   notification centre (defer to v2.1 if time is short; no owner approval needed for Could items).
2. **No billing (D-014):** Plan & usage shows plan, quota usage and "contact us to upgrade"; PRO is
   assigned via an admin script (document it).
3. **Entitlements (PRD §6):** FREE — 1 integration, 12-month history, 15 generations, 100 quick
   actions/month; PRO — 1 integration, 36-month history, 150 / 1,000.
4. **Data export** is a synchronous streamed JSON download (`GET /me/export`, 3/day) — no ZIP or job
   needed; contents per API_CONTRACT_V2 §5.
5. **Schema:** P12-1 in DATA_MODEL_V2 §5; goal progress semantics in API_CONTRACT_V2 §16.
