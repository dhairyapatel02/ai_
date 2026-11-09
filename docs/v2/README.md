# DevImpact AI — Version 2.0 Execution Plan

This folder is the operating manual for turning v0.1.0 (built by a previous AI agent) into a
polished, production-ready **Developer KPI Measurement Tool — v2.0**.

The work is split into **15 phases**. Each phase runs in its **own fresh Claude Code session**
and is fully self-contained: the session reads a few files in this folder and has everything it
needs. No knowledge of earlier chat conversations is required.

---

## How to run a phase (for the human)

1. Make sure the previous phase's PR is merged into the integration branch (see
   [Branching protocol](#branching-protocol)).
2. Start a new Claude Code session on this repository.
3. Paste the kickoff prompt below, replacing `NN` and the file name:

```text
You are executing Phase NN of the DevImpact AI v2.0 plan.

Before doing anything else, read these files in order:
1. docs/v2/README.md            (plan, conventions, definition of done)
2. docs/v2/00-CONTEXT.md        (product + current-state context)
3. docs/v2/PROGRESS.md          (what previous phases delivered, open handoff notes)
4. docs/v2/DECISIONS.md         (decisions already made — do not re-litigate)
5. docs/v2/phases/PNN-<name>.md (your instructions)

Then execute the phase file: complete every task, satisfy every acceptance criterion, and
follow the Definition of Done in README.md. Ask me only for decisions the phase file marks
as "USER DECISION". When finished, update PROGRESS.md, commit, push, and open a PR
into the integration branch.
```

4. Review the PR (each phase file lists what to check), merge it, then start the next phase.

> Tip: phases marked "can run in parallel" may be started in separate sessions at the same time
> once their prerequisites are merged.

---

## Phase overview

| # | Phase | Type | Prerequisites | Key output |
|---|---|---|---|---|
| 01 | [Audit & Discovery](phases/P01-audit-and-discovery.md) | Analysis (no feature code) | — | Audit report, architecture map, ID'd issue backlog, runtime test results |
| 02 | [Engineering Foundation & Stabilization](phases/P02-engineering-foundation.md) | Code | 01 | Green build, lint, tests, CI, migrations, seed data, worker entry |
| 03 | [V2 Blueprint: Product, KPIs & Architecture](phases/P03-v2-blueprint.md) | Design (docs) | 01 | PRD, KPI methodology, ADRs, data model v2, API contract v2 |
| 04 | [UX/UI Design System & Prototype](phases/P04-ux-ui-design.md) | Design (docs + prototype) | 03 | IA, flows, wireframes, tokens, clickable prototype |
| 05 | [Backend Platform: Auth, Security, API Conventions](phases/P05-backend-platform.md) | Code | 02, 03 | Real auth, encrypted tokens, Zod validation, error handling, rate limits |
| 06 | [Data Ingestion & Sync Engine v2](phases/P06-sync-engine.md) | Code | 05 | Correct, incremental, scheduled, webhook-driven GitHub sync with history |
| 07 | [Metrics Engine & Impact Score v2](phases/P07-metrics-engine.md) | Code | 06 | Deterministic KPI engine, rollups, explainable impact score, metrics API |
| 08 | [AI Layer v2](phases/P08-ai-layer.md) | Code | 07 | Structured, streamed, cached, evidence-linked generation with evals |
| 09 | [Frontend Foundation & App Shell](phases/P09-frontend-foundation.md) | Code | 04, 05 | Upgraded Next.js, design system, shell, auth UI, data layer, onboarding |
| 10 | [Frontend: Insights Pages](phases/P10-frontend-insights.md) | Code | 07, 09 | Dashboard, Activity, KPIs, Career, Integrations |
| 11 | [Frontend: AI Document Studio](phases/P11-frontend-document-studio.md) | Code | 08, 09 | Resume, Appraisal, Promotion, Documents library, exports |
| 12 | [Product Extensions](phases/P12-product-extensions.md) | Code | 10, 11 | Achievements journal, goals, digests, settings, plan limits |
| 13 | [Additional Integrations (optional)](phases/P13-additional-integrations.md) | Code | 06 (+12) | GitLab, Jira, Linear via provider abstraction |
| 14 | [Hardening: QA, Security, Perf, A11y, Observability](phases/P14-hardening.md) | QA + Code | 12 | Full E2E suite, security & a11y audits fixed, monitoring |
| 15 | [Release: Deployment, Docs & v2.0.0](phases/P15-release.md) | Ops + Docs | 14 | Prod images, deploy guide, docs, changelog, `v2.0.0` tag |

### Dependency graph

```
P01 ──► P02 ──────────────┐
  └───► P03 ──► P04 ──────┼──────────────► P09 ──┬──► P10 ──┐
          └───────────────┴─► P05 ──► P06 ──► P07 ┤          ├──► P12 ──► P14 ──► P15
                                       │          └► P08 ──► P11 ┘    ▲
                                       └──────────────► P13 (optional)┘
```

Parallelisable pairs (once prerequisites merge): **P02 ∥ P03**, **P04 ∥ P05**,
**P09 ∥ P06–P08**, **P10 ∥ P11**, **P13** any time after P06.

---

## Branching protocol

- **Integration branch:** `main`.
  - *One-time human step before Phase 01:* merge the planning PR that added this folder into the
    current default branch (`devin/1780303918-devimpact-ai-scaffold`), then create `main` from
    it and make `main` the default branch on GitHub. Close PR #1 (it targets the empty
    `init-branch`) with a note that `main` supersedes it.
  - If `main` does not exist when a session starts, use the repository's default branch as the
    integration branch and note it in `PROGRESS.md`.
- **Phase branches:** each session works on the branch the harness assigns it (or
  `v2/pNN-<slug>` if free to choose). Start it from the latest integration branch:
  `git fetch origin main && git checkout -B <branch> origin/main`.
- **One PR per phase** into `main`, titled `Phase NN: <name>`. The PR body lists deliverables,
  acceptance-criteria checklist (ticked), and known follow-ups.
- Never force-push `main`. Never commit secrets or real `.env` files.

---

## Definition of Done (applies to every phase)

A phase is done only when **all** of these hold:

1. Every task in the phase file is completed, or explicitly deferred in `PROGRESS.md` with a
   reason and a target phase.
2. Every acceptance criterion in the phase file is met and ticked in the PR body.
3. From Phase 02 onwards, these commands pass from the repo root (names may be refined in P02;
   the current names live in the root `package.json`):
   `npm run lint` · `npm run typecheck` · `npm test` · `npm run build`
4. New behaviour has tests (unit for logic, integration for API, E2E for critical user flows
   from Phase 09 on). Tests never call the real Anthropic or GitHub APIs — use mocks/fixtures.
5. Docs updated: any changed setup step → root `README.md`; any decision → `DECISIONS.md`;
   any env var → `.env.example` + env schema.
6. `docs/v2/PROGRESS.md` updated: phase status, summary of what changed, deviations, handoff
   notes for the next phase, new issues discovered (added to `docs/v2/audit/ISSUES.md`).
7. Work committed with clear messages, pushed, PR opened.

## Engineering conventions

- **TypeScript strict** everywhere. No `any` without a comment explaining why.
- **Zod** is the single source of validation truth; schemas live in `packages/shared` and are
  shared by API (validation pipe) and web (forms + response parsing).
- **API envelope:** `{ success: true, data } | { success: false, error: { code, message, details? } }`
  with correct HTTP status codes (adopted in P05; see DECISIONS.md).
- **Prompts** live in `apps/api/src/prompts/` (one file per prompt, versioned).
- **Claude usage:** model IDs come from config (`ANTHROPIC_MODEL_*` env vars), never hard-coded
  in services. Before writing Claude API code, load the `claude-api` skill for current model IDs,
  SDK usage, streaming and structured output.
- **Seed data:** use the seed script (from P02) for local work and screenshots; never require a
  real GitHub account to develop UI.
- **Commits:** conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
- **Keep scope tight.** If you find work that belongs to another phase, log it in
  `docs/v2/audit/ISSUES.md` and `PROGRESS.md` instead of doing it.

## Files in this folder

| File | Purpose | Maintained by |
|---|---|---|
| `README.md` | This plan, protocol, DoD | Update only if the plan itself changes |
| `00-CONTEXT.md` | Product + current-state context, preliminary findings | P01 refreshes; later phases append "state changes" |
| `ORIGINAL_SPEC.md` | The v1 brief | Read-only |
| `PROGRESS.md` | Phase tracker + handoff notes | Every phase |
| `DECISIONS.md` | Decision log (proposed defaults → confirmed ADRs) | P03 owns; every phase may append |
| `phases/PNN-*.md` | Self-contained phase instructions | Read-only during execution (log deviations in PROGRESS) |
| `audit/` | Created by P01 (audit report, issues backlog, test results) | P01 creates; all phases update ISSUES.md |
| `blueprint/` | Created by P03 (PRD, KPI spec, ADRs, data model, API contract) | P03 creates |
| `design/` | Created by P04 (IA, flows, wireframes, tokens, prototype) | P04 creates |
