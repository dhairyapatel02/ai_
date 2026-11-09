# DevImpact AI v2.0 — Product Requirements Document

*Phase 03 · 2026-11-09 · Status: **binding** for P04–P15. Changes require a new entry in
[`../DECISIONS.md`](../DECISIONS.md).*

Related: [KPI methodology](KPI_METHODOLOGY.md) · [Architecture](ARCHITECTURE_V2.md) ·
[Data model](DATA_MODEL_V2.md) · [API contract](API_CONTRACT_V2.md) ·
[Traceability](TRACEABILITY.md) · [ADRs](adr/README.md)

---

## 1. Product summary

DevImpact AI is a **career operating system for individual software engineers**. It connects to
GitHub, turns engineering activity into **deterministic, explainable KPIs and an impact score**,
lets the engineer capture work GitHub can't see (an achievements journal and goals), and uses
Claude to draft **evidence-linked** career documents: resume bullets, appraisal reports and
promotion packets.

**Positioning in one line:** *"Your engineering work, measured fairly and written up for you —
every claim backed by a PR."*

### 1.1 v2.0 scope decisions (user-confirmed, see DECISIONS.md)

| Topic | Decision |
|---|---|
| Audience | **Individual engineers only.** Manager/team views → v2.1 (D-014) |
| Billing | **Not in v2.0.** Plans exist (FREE, PRO) and are enforced; plan changes are an admin action. Stripe → v2.1 (D-014) |
| Data sources | **GitHub only** in v2.0, via a **GitHub App**. GitLab, Jira, Linear → v2.1; Phase 13 skipped (D-004, D-016) |
| Sign-in | GitHub and Google via **Better Auth** (D-003) |
| Impact score | **Deterministic** formula; a single 0–100 score **plus** four dimension scores, each explainable (D-007) |
| Brand | **Calm, professional, Linear-like** (D-015) |
| Hosting | Platform-neutral; final pick in P15. Docker Compose self-hosting must always work (D-013) |

### 1.2 Non-goals for v2.0

- Ranking or comparing engineers against each other (no leaderboards, no cohort percentiles).
- Manager access to an engineer's data. All data is private to its owner.
- Measuring "worth" or productivity through lines of code.
- Automatic posting to LinkedIn, HR systems or job boards.
- Real-time collaboration on documents.

---

## 2. Personas

### P1 — Priya, mid-level IC engineer (primary)
- 3–5 years' experience, product team, ships features weekly, reviews teammates' PRs.
- **Pain:** at review time she can't remember what she did in the last six months; her
  self-review undersells reviews, mentoring and incident work; her resume is two years stale.
- **Wants:** a running, trustworthy record of her work and a fast way to turn it into an
  appraisal and resume bullets she is comfortable putting her name to.
- **Success for her:** writes her half-year self-review in under 30 minutes, citing real PRs.

### P2 — Marcus, senior engineer preparing for Staff (primary)
- 8+ years, works across several repos, reviews heavily, leads design work.
- **Pain:** promotion committees want evidence of scope, ownership and influence; much of his
  impact is reviews, cross-repo work and work outside code.
- **Wants:** a promotion packet structured around his company's ladder, with evidence links;
  metrics that show review leadership and ownership breadth, not commit counts.
- **Success for him:** a promotion packet draft, grounded in 12 months of evidence, in one sitting.

### P3 — Sam, job seeker / career switcher (secondary)
- Any level, about to job-hunt.
- **Wants:** quantified, role-tailored resume bullets (backend, frontend, fullstack, devops,
  manager) from real work; DOCX/PDF export.

### Future persona (v2.1, out of scope) — Elena, engineering manager
Wants an opt-in, fair team view. Recorded so v2.0 data model and APIs stay team-ready
(`userId`-scoped ownership, no assumptions that block an `Organization` model later).

---

## 3. Jobs to be done

| # | When I… | I want to… | So I can… |
|---|---|---|---|
| J1 | start using the product | connect GitHub and see my real impact in minutes | trust that the tool reflects my work |
| J2 | approach a review cycle | generate an appraisal for the period, with metrics and evidence | write a credible self-review fast |
| J3 | aim for promotion | build a promotion case mapped to my target role | show readiness with evidence |
| J4 | update my resume | get role-tailored, quantified bullets | apply for jobs with confidence |
| J5 | finish a week | see what I did and capture wins GitHub can't see | never lose track of impact |
| J6 | look at a number | understand exactly how it was calculated | defend it to my manager |
| J7 | worry about privacy | choose which repos count, export or delete my data | stay in control |

---

## 4. Core user journeys

Each journey is a P14 E2E test (see [TRACEABILITY.md](TRACEABILITY.md)).

### UJ-1 First run → first insight in under 3 minutes (activation)
1. Land on marketing/sign-in page → **Sign in with GitHub** (or Google).
2. Onboarding step 1 "Connect GitHub data": install the DevImpact GitHub App and choose repos on
   GitHub's install screen (personal account and/or orgs), authorise.
3. Step 2 "Review repositories": list of accessible repos with activity in the last 12 months
   pre-selected; user can exclude any.
4. Step 3 "First sync": live progress by stage (repositories → pull requests → reviews →
   commits → metrics). Most recent 30 days are processed first so the dashboard can render
   before the 12-month backfill finishes.
5. Land on a populated **Dashboard**: stat cards, 30-day chart, heatmap, impact score with
   "How is this calculated?", recent activity, a "next best action" card.

*Target:* median time from sign-in to populated dashboard **< 3 min** for a user with ≤ 2,000
PRs/reviews in 12 months.

### UJ-2 Prepare an appraisal
Documents → New → Appraisal → choose period (month / quarter / half-year / year / custom) →
evidence preview ("18 PRs merged, 41 PRs reviewed, 4 repos, 3 achievements") → optional
self-reflection notes → Generate → sections stream in → edit inline → export PDF/DOCX/Markdown.
Metrics table is filled from the metrics engine, never by the model.

### UJ-3 Build a promotion case
Documents → New → Promotion → current role, target role, optional ladder/expectations text,
period (default last 12 months) → evidence preview → Generate → sections with citations →
edit, version, export.

### UJ-4 Update resume
Documents → New → Resume → date range, role variant (backend / frontend / fullstack / devops /
manager), format (bullets / narrative), optional target job description → 5–8 bullets, themed,
each with evidence chips → copy one / copy all / export DOCX/PDF.

### UJ-5 Weekly reflection
Weekly digest email (opt-in, user's timezone) → "what you shipped" + suggested achievements →
one click to the Achievements quick-add pre-filled from a PR → appears in Career timeline and
becomes citable evidence.

### UJ-6 Explain a metric
Any metric card → info icon → drawer with definition, formula, the user's inputs, caveats and
links to the underlying PRs/reviews.

### UJ-7 Privacy controls
Settings → Privacy & data: include/exclude repos, toggle "redact private repository names in AI
output", **export all my data** (JSON), **delete my account** (typed confirmation).

### UJ-8 Reconnect
GitHub token revoked or app uninstalled → integration shows **Needs reconnection** everywhere
(sync indicator, dashboard banner, integrations page) → one click re-authorises; scheduled sync
resumes.

---

## 5. Feature list (MoSCoW, owning phase)

Priority: **M** must (v2.0 cannot ship without it) · **S** should (planned for v2.0, can slip
with owner approval) · **C** could (only if time allows) · **W** won't (v2.1+).
IDs are stable; [TRACEABILITY.md](TRACEABILITY.md) maps each to KPIs/ADRs, tables, endpoints,
pages and phases.

### 5.1 Account & platform
| ID | Feature | Pri | Phase |
|---|---|---|---|
| F-01 | Sign in with GitHub and Google (Better Auth); sign-out; session management | M | P05, P09 |
| F-02 | Dev-only sign-in for local demo and E2E (impossible in production builds) | M | P05 |
| F-03 | Account deletion (hard delete, cascade, typed confirmation) | M | P05, P12 |
| F-04 | Export all my data (JSON download) | M | P12 |
| F-05 | User settings: timezone, current role/level, target role, default period | M | P05 (tz), P12 |
| F-06 | Plans & entitlements (FREE/PRO limits enforced server-side, shown in UI) | M | P08 (AI quota), P12 |
| F-07 | Plan & usage page (AI usage vs quota; no billing) | M | P12 |
| F-08 | Stripe billing / self-serve upgrade | W | v2.1 |

### 5.2 Integrations & data
| ID | Feature | Pri | Phase |
|---|---|---|---|
| F-10 | Connect GitHub via GitHub App (install + user authorisation, CSRF-safe state) | M | P05 (flow), P06 |
| F-11 | Repository selection: include/exclude, defaults by recent activity | M | P06, P09, P10 |
| F-12 | Initial 12-month backfill, recent-30-days-first | M | P06 |
| F-13 | Incremental sync every 24 h + manual "Sync now" | M | P06 |
| F-14 | Webhooks for near-real-time updates (GitHub App events) | M | P06 |
| F-15 | Sync status, live progress and history with actionable errors | M | P06, P10 |
| F-16 | Needs-reconnection detection and one-click reconnect | M | P06, P10 |
| F-17 | Disconnect with choice: keep data or purge data (confirm dialog) | M | P05, P06, P10 |
| F-18 | Authored vs reviewed PRs modelled distinctly (fixes DATA-01) | M | P06 |
| F-19 | GitLab, Jira, Linear providers | W | v2.1 (P13 skipped) |

### 5.3 Insights
| ID | Feature | Pri | Phase |
|---|---|---|---|
| F-20 | Dashboard: stat cards with period-over-period deltas | M | P07, P10 |
| F-21 | Dashboard: 30-day activity chart | M | P07, P10 |
| F-22 | Contribution heatmap | S | P07, P10 |
| F-23 | Recent activity feed (unified, infinite scroll) | M | P07, P10 |
| F-24 | "Next best action" card | S | P10 |
| F-25 | Activity explorer (filter/search commits, PRs, reviews; detail drawer) | M | P07, P10 |
| F-26 | KPIs page: Delivery, Quality, Collaboration, Ownership, Consistency sections with trends | M | P07, P10 |
| F-27 | "Explain this metric" drawer (definition, formula, inputs, caveats, evidence) | M | P07, P10 |
| F-28 | Impact score v2: overall + 4 dimensions, history, explanation | M | P07, P10 |
| F-29 | AI impact highlights/narrative (explicit, cached) | S | P08, P10 |
| F-30 | Career timeline: year → quarter, repo grouping, milestones, achievements, year filter, print view | M | P07, P10 |
| F-31 | Global period picker with URL state / deep links | M | P09, P10 |

### 5.4 Documents (AI studio)
| ID | Feature | Pri | Phase |
|---|---|---|---|
| F-40 | Resume bullets (role variants, bullets/narrative, optional job description) | M | P08, P11 |
| F-41 | Appraisal report (monthly/quarterly/half-year/yearly/custom; metrics table from engine) | M | P08, P11 |
| F-42 | Promotion packet (current → target role, optional ladder text) | M | P08, P11 |
| F-43 | Evidence preview before generation | M | P08, P11 |
| F-44 | Streaming generation with progress, cancel and resume after navigation | M | P08, P11 |
| F-45 | Evidence citations on every claim; uncited/invalid claims flagged | M | P08, P11 |
| F-46 | Inline editing, autosave, version history, restore | M | P08, P11 |
| F-47 | Regenerate (whole document); regenerate a single section | M / S | P08, P11 |
| F-48 | Documents library (filter, search, sort, delete) | M | P11 |
| F-49 | Exports: copy (text/Markdown), Markdown, PDF, DOCX | M | P11 |
| F-50 | Result caching (same inputs → same document unless regenerate) | M | P08 |
| F-51 | "Turn into achievement" statement for a PR/commit (fast model) | S | P08, P10, P12 |
| F-52 | Shareable read-only document links | W | v2.1 |

### 5.5 Career OS extensions
| ID | Feature | Pri | Phase |
|---|---|---|---|
| F-60 | Achievements journal (manual wins: mentoring, incidents, design docs…; linked evidence) | M | P12 |
| F-61 | Achievements as citable evidence in documents, feed and timeline | M | P12 |
| F-62 | Goals with optional metric targets and progress from the metrics engine | M | P12 |
| F-63 | Weekly digest email (opt-in, timezone-aware, unsubscribe without login) | M | P12 |
| F-64 | Optional AI summary in the digest (fast model, cached) | S | P08, P12 |
| F-65 | Notification preferences (functional toggles) | M | P12 |
| F-66 | In-app notification centre | C | v2.1 unless time allows in P12 |
| F-67 | Monthly digest | C | P12 |

### 5.6 Experience & quality
| ID | Feature | Pri | Phase |
|---|---|---|---|
| F-70 | Responsive app shell (mobile nav at 390 px), grouped sidebar | M | P09 |
| F-71 | Dark mode (system/light/dark), no flash | M | P09 |
| F-72 | Command palette (⌘K): navigate, sync, new document, add achievement, theme | S | P09 |
| F-73 | Designed loading/empty/partial/error states on every page | M | P09–P12 |
| F-74 | Guided onboarding wizard (resumable) | M | P09 |
| F-75 | Accessibility WCAG 2.2 AA | M | P04, P09–P14 |
| F-76 | Privacy: redact private repo names in AI output toggle | S | P08, P12 |
| F-77 | Manager/team views | W | v2.1 |

---

## 6. Plans & entitlements (enforced server-side; no billing in v2.0)

| Entitlement | FREE | PRO |
|---|---|---|
| GitHub integrations | 1 | 1 (more providers in v2.1) |
| History window for backfill and metrics | 12 months | 36 months |
| AI document generations / calendar month (UTC) — create + regenerate | 15 | 150 |
| Quick AI actions / month (achievement statements, impact highlights, digest summary) | 100 | 1,000 |
| Exports | unlimited | unlimited |
| Weekly digest | ✓ | ✓ |

- Cache hits (same `inputHash`) do **not** consume quota. Failed generations do not consume quota.
- PRO is assigned by an admin script/SQL in v2.0 (documented in P12/P15). New users are FREE.
- Values live in config (`ENTITLEMENTS_JSON` override), read by a central `Entitlements` service.

---

## 7. Non-functional requirements

| Area | Requirement | Verified in |
|---|---|---|
| Performance — web | Dashboard LCP < 2.0 s and TTI < 2.0 s on seeded heavy user (12 months, ~3k PRs/reviews), production build, desktop Lighthouse; Lighthouse performance ≥ 90 on main pages | P10, P14 |
| Performance — API | p95 server time < 150 ms for `/metrics/overview`, `/metrics/timeseries`, `/metrics/kpis`, `/activity/feed` on heavy seeded user; < 300 ms at 50 RPS load | P07, P14 |
| Performance — sync | Initial backfill of the P06 reference fixture within the API-call budget in ADR-0007 (≤ 250 requests); 30-day slice visible within 60 s of install for a typical user | P06 |
| Performance — AI | First streamed section visible < 8 s p50 after "Generate"; full document < 90 s p95 | P08, P11 |
| Availability | Single-region; target 99.5 % monthly for web+API; worker outages delay sync/AI but never lose data (queues persist, runs resumable) | P14, P15 |
| Reliability | Sync idempotent and resumable; no silent data loss — every failure recorded on `SyncRun` | P06 |
| Security | Real auth; encrypted tokens at rest; least-privilege GitHub App permissions (read-only); validation on all input; rate limits; OWASP ASVS L1 + selected L2 | P05, P14 |
| Privacy / GDPR | Data minimisation (no storage of other people's review bodies; reviewed PR bodies not stored); export and delete; retention policy per DATA_MODEL_V2 §6; sub-processors documented (GitHub, Anthropic, email provider, hosting) | P12, P14 |
| Accessibility | WCAG 2.2 AA; keyboard-only flows; charts have text alternatives; `prefers-reduced-motion` honoured | P04, P09–P14 |
| Browser support | Last 2 versions of Chrome, Edge, Firefox, Safari (desktop + iOS/Android); 390 px minimum width | P09, P14 |
| Internationalisation | English UI; locale-aware number/date formatting; all times in the user's timezone | P07, P09 |
| Cost ceilings | AI cost per FREE user at full quota ≤ **US$3/month**; median active user ≤ **US$0.50/month**; per-generation cost logged (`AiUsage`). GitHub calls per daily incremental sync ≤ 50 for a typical user | P08, P06 |
| Observability | Structured logs with request IDs; error tracking; queue, sync and AI dashboards | P05, P14 |
| Testing | lint, typecheck, unit, integration, E2E for every Must journey green in CI | every phase |

---

## 8. Success metrics

Measured from product analytics events (privacy-friendly, first-party; P14 decides tooling) and
the database.

| Metric | Definition | v2.0 target (90 days post-launch) |
|---|---|---|
| Activation rate | % of new sign-ups that reach a populated dashboard (first successful sync with ≥ 1 activity item) within 24 h | ≥ 60 % |
| Time to first insight | Median time sign-in → populated dashboard | < 3 min |
| Document adoption | % of activated users who generate ≥ 1 document within 30 days | ≥ 40 % |
| Documents per active user | Generated + exported documents per monthly active user | ≥ 1.5 |
| Export rate | % of generated documents exported or copied | ≥ 50 % |
| Evidence quality | Citation coverage of generated claims (P08 metric) | ≥ 95 % |
| Journal usage | % of MAU adding ≥ 1 achievement per month | ≥ 25 % |
| Retention | Week-4 retention of activated users (any session or opened digest) | ≥ 35 % |
| Trust | "I'd show this to my manager" in-app survey (≥ 4/5) | ≥ 70 % |
| Reliability | % of sync runs `SUCCEEDED` (excluding user-caused reauth) | ≥ 99 % |

---

## 9. Assumptions and open questions

- **GitHub App reach:** private org repos require the org to install/approve the app. Public
  repos are readable without installation. The UX must explain "ask your org admin to approve"
  (ADR-0004). *Assumption:* most target users can install on their personal account and request
  org approval.
- **Ladder texts:** users paste their company's ladder; we do not ship ladders in v2.0.
- **Email provider:** provider-agnostic (console transport in dev); concrete provider chosen in P12/P15.
- **Analytics tooling** for success metrics: chosen in P14 (must be privacy-respecting, self-hostable option).
