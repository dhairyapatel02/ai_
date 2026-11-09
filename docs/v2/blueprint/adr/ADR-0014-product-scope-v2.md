# ADR-0014: Product scope for v2.0 — individual engineers, GitHub only, no billing

**Status:** Accepted — **user decisions (2026-11-09): "Individual only" and "Integrations out — v2.1"**
**Date:** 2026-11-09
**Deciders:** Project owner; Phase 03

## Context
The original spec mentions GitLab/Jira/Linear, plans (FREE/PRO/TEAM/ENTERPRISE) and implies
manager use. The audit shows the individual core (auth, sync, metrics, documents) must be rebuilt
first. Scope must be fixed so P04–P15 plan against one target.

## Decision
**In v2.0:** the individual engineer experience end-to-end on GitHub — sign-in, GitHub App
connection and repo selection, sync with history, dashboard/activity/KPIs/impact/career, all three
document types with streaming, citations, editing, versions and exports, achievements journal,
goals, weekly digest, settings incl. privacy (export/delete), plan limits (FREE/PRO enforced, no
billing). Full list with priorities: [PRD §5](../PRD.md#5-feature-list-moscow-owning-phase).

**Out (v2.1 roadmap):**
- Manager/team views (organisations, members, sharing) — data model stays team-ready.
- Stripe billing and self-serve upgrades — PRO assigned by admin.
- GitLab, Jira, Linear providers — **Phase 13 is skipped**; P06 still builds the provider abstraction.
- Shareable document links, in-app notification centre (unless time allows in P12), issue metrics.

## Options Considered
| Option | Assessment |
|---|---|
| **A. Individual only (chosen)** | Smallest scope that delivers the core value; lowest risk |
| B. + team views | +2 sessions; consent/privacy design; risks diluting the individual experience |
| C. + billing | Stripe integration, webhooks, tax — no revenue need before validation |
| D. + team + billing | Largest; deferred |

## Consequences
- Easier: P10–P12 focus on polish and trust; P14 has a smaller surface to harden.
- Harder: issue-tracker metrics (story points) unavailable; org-repo coverage depends on GitHub App approval.
- Revisit: v2.1 planning after launch metrics (PRD §8).

## Action Items
1. [ ] P13 phase file amended: skipped for v2.0.
2. [ ] P15: `docs/v2/ROADMAP_V2_1.md` includes every out-of-scope item above.
