# Phase 13 — Additional Integrations (optional for v2.0)

| | |
|---|---|
| **Goal** | Add GitLab, Jira and Linear as data sources through the provider abstraction built in P06, and surface issue-tracker data in metrics and documents. |
| **Type** | Code (API + worker + web) |
| **Prerequisites** | P06 merged (P07/P10 recommended). Run only if P03 confirmed integrations are in v2.0 scope; otherwise schedule after release as v2.1. |
| **Parallel with** | P12 |
| **Effort** | 1–2 sessions (one provider family per session if needed: GitLab; Jira + Linear) |

## Context
The original spec lists GitLab, Jira and Linear; v0.1.0 only shows them as "Coming soon", and the
`Issue` model is unused. P06 defined `ActivityProvider` and normalised DTOs so new providers
should not require orchestrator changes.

## Read first
`DECISIONS.md` (scope decision), P06 handoff + `apps/api/src/sync/` provider interface,
`blueprint/KPI_METHODOLOGY.md` (issue metrics: issues closed, story points, cycle time),
`blueprint/DATA_MODEL_V2.md` (`Issue`), `design/SCREENS.md` (integrations).

## Tasks
1. **GitLab** provider (gitlab.com + self-managed base URL): OAuth (PKCE, refresh tokens),
   projects, commits, merge requests (as PRs), MR approvals/notes (as reviews), webhooks with
   secret token verification. Map to normalised DTOs; provider field on records.
2. **Jira Cloud** provider: OAuth 2.0 (3LO) with refresh, accessible resources (sites), issues
   assigned/resolved by the user (JQL, incremental by `updated`), story points field discovery
   (configurable custom field), status category mapping to `IssueStatus`, priority mapping,
   webhooks (or polling if webhooks not feasible).
3. **Linear** provider: OAuth, GraphQL issues assigned/completed by the user, estimates as story
   points, cycles/projects, webhooks with signature verification.
4. Identity matching: link provider identities to the user (emails/usernames) and allow manual
   linking; avoid double counting when the same work appears in GitHub + GitLab mirrors.
5. Metrics: implement issue-based metrics from KPI_METHODOLOGY (if defined) in the P07 engine;
   rollups include provider dimension.
6. AI: EvidenceBuilder includes issues (refs like `JIRA-ABC-123`); prompts handle issue evidence.
7. UI: integrations page live cards with connect/disconnect/status/history per provider, provider
   filter in Activity explorer, issues in feed and timeline.
8. Tests: recorded fixtures per provider (MSW), token refresh, webhook verification, mapping
   tables (status/priority), identity de-duplication, metrics with mixed providers.

## Acceptance criteria
- [ ] Each provider: connect → initial sync → incremental sync → webhook/poll update → disconnect, covered by tests with fixtures.
- [ ] No changes required in the orchestrator core for new providers (only registrations) — or the change is justified in PROGRESS.md.
- [ ] Issue metrics appear in KPIs and evidence in generated documents.
- [ ] Tokens encrypted; refresh flows tested; revoked tokens → `needs_reauth`.
- [ ] `npm run check` + CI green.

## Handoff
Document per-provider app registration steps (README), field mappings, known limitations.

---

## Blueprint amendments (P03, 2026-11-09)

**This phase is SKIPPED for v2.0** (user decision D-018, ADR-0014: "Out — v2.1"). Do not start it
before v2.0 is released. P14's prerequisite becomes "P12 merged". The provider abstraction is
still built in P06. P15 must carry this phase into `docs/v2/ROADMAP_V2_1.md`; the issue-metric
definitions in KPI_METHODOLOGY §3.6 are ready for it.
