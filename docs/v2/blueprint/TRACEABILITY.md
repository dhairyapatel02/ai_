# Traceability Matrix

*Phase 03 · 2026-11-09.* Maps every PRD feature to its methodology/ADR, data model, endpoints, UI
page and implementing phase(s), and maps every open `audit/ISSUES.md` row targeting P05 or later to
a feature (or marks it won't-fix for v2.0). UI routes are provisional until P04's `design/IA.md`;
P04 may rename routes and must update this file.

Legend for tables/endpoints: see [DATA_MODEL_V2](DATA_MODEL_V2.md) and [API_CONTRACT_V2](API_CONTRACT_V2.md).

## 1. PRD features → implementation

| Feature | Pri | KPI / ADR | Data model | Endpoints | UI page | Phases |
|---|---|---|---|---|---|---|
| F-01 Sign in GitHub/Google, sign-out | M | ADR-0003 | User, Session, Account, Verification, Jwks | web `/api/auth/*`, `GET /me` | `/sign-in`, user menu | P05, P09 |
| F-02 Dev-only sign-in | M | ADR-0003 | Account (credential) | web `POST /api/dev-login` | `/sign-in` (dev button) | P05 |
| F-03 Account deletion | M | ADR-0003, DATA_MODEL §6 | cascade all | `DELETE /me` | `/settings/privacy` | P05 (API), P12 (UI) |
| F-04 Export my data | M | DATA_MODEL §6 | all user-owned | `GET /me/export` | `/settings/privacy` | P12 |
| F-05 User settings (tz, role, period) | M | KPI §2.4 | UserSettings | `GET/PATCH /me/settings` | `/settings/profile`, onboarding | P05 (tz), P12 |
| F-06 Plans & entitlements | M | PRD §6, ADR-0009 | User.plan, AiUsage | `/me/entitlements`, 402/403 errors | disabled states + upgrade copy | P08, P12 |
| F-07 Plan & usage page | M | PRD §6 | AiUsage | `GET /me/usage` | `/settings/plan` | P12 |
| F-10 Connect GitHub (App) | M | ADR-0004, ADR-0005 | Integration, GitHubInstallation | `POST /integrations/github/connect`, `/callback` | `/onboarding`, `/settings/integrations` | P05, P06, P09 |
| F-11 Repository selection | M | ADR-0007 | Repository.included | `GET/PATCH /repos` | onboarding step 2, `/settings/integrations` | P06, P09, P10 |
| F-12 Initial 12-month backfill | M | ADR-0007 | SyncRun, cursors | `POST /sync` (auto on connect) | onboarding step 3 | P06 |
| F-13 Incremental 24 h + manual sync | M | ADR-0007 | Integration.scheduleSlotMinute, SyncRun | `POST /sync` | sync indicator, ⌘K | P06, P09 |
| F-14 Webhooks | M | ADR-0004, ADR-0007 | WebhookDelivery | `POST /webhooks/github` | — | P06 |
| F-15 Sync status/progress/history | M | ADR-0007 | SyncRun | `GET /sync/status`, `/sync/runs`, `/sync/stream` | `/settings/integrations`, top bar | P06, P10 |
| F-16 Needs-reconnection + reconnect | M | ADR-0004 | Integration.status | `POST /integrations/:id/reconnect`, `/sync/status` | banner, integrations | P06, P10 |
| F-17 Disconnect keep/purge | M | ADR-0004, DATA_MODEL §6 | Integration, activity | `DELETE /integrations/:id?purgeData=` | confirm dialog | P05, P06, P10 |
| F-18 Authored vs reviewed PRs | M | KPI §2.2, ADR-0007 | PullRequest.isAuthoredByUser, PullRequestReview | `/activity/prs?role=` | activity explorer | P06 |
| F-20 Stat cards + deltas | M | KPI §3.7 | MetricSnapshot, fact tables | `GET /metrics/overview` | `/dashboard` | P07, P10 |
| F-21 30-day chart | M | KPI §4 | MetricSnapshot | `GET /metrics/timeseries` | `/dashboard` | P07, P10 |
| F-22 Heatmap | S | KPI §4 | MetricSnapshot | `GET /metrics/heatmap` | `/dashboard` | P07, P10 |
| F-23 Activity feed | M | — | PR, Review, Commit, Achievement | `GET /activity/feed` | `/dashboard` | P07, P10 |
| F-24 Next best action | S | — | (derived) | overview + feed + me | `/dashboard` | P10 |
| F-25 Activity explorer | M | — | PR, Review, Commit | `/activity/prs`, `/reviews`, `/commits` (+ detail) | `/activity` | P07, P10 |
| F-26 KPIs page | M | KPI §3, ADR-0008 | ImpactScore.inputs | `GET /metrics/kpis`, `/metrics/timeseries` | `/kpis` | P07, P10 |
| F-27 Explain this metric | M | KPI §3, §7 | — | `GET /metrics/definitions`, evidence ids | drawer on every metric | P07, P10 |
| F-28 Impact score v2 | M | KPI §6, ADR-0008 | ImpactScore | `GET /impact`, `/impact/history` | `/dashboard`, `/kpis/impact` | P07, P10 |
| F-29 AI impact highlights | S | KPI §8, ADR-0009 | GeneratedDocument (IMPACT_NARRATIVE) | `POST /impact/highlights` | `/kpis/impact` | P08, P10 |
| F-30 Career timeline | M | KPI §3 (milestones) | PR, Review, Achievement | `GET /career/timeline`, `/metrics/repos` | `/career` | P07, P10 |
| F-31 Global period + URL state | M | ADR-0006, ADR-0010 | UserSettings.defaultPeriodType | `period` param | top bar | P07 (utils), P09, P10 |
| F-40 Resume | M | ADR-0009 | GeneratedDocument, DocumentVersion | `POST /documents` (resume) | `/documents/new/resume` | P08, P11 |
| F-41 Appraisal | M | ADR-0009, KPI §8 | same | `POST /documents` (appraisal) | `/documents/new/appraisal` | P08, P11 |
| F-42 Promotion | M | ADR-0009 | same | `POST /documents` (promotion) | `/documents/new/promotion` | P08, P11 |
| F-43 Evidence preview | M | ADR-0009 | — | `POST /documents/preview-evidence` | creation flows | P08, P11 |
| F-44 Streaming, cancel, resume | M | ADR-0009 | GeneratedDocument.status | `GET /documents/:id/stream`, `/cancel` | viewer | P08, P11 |
| F-45 Citations + flags | M | ADR-0009 | evidenceRefs, citationCoverage | document content | viewer/editor | P08, P11 |
| F-46 Edit, versions, restore | M | ADR-0009 | DocumentVersion | `PATCH /documents/:id`, `/versions`, `/restore` | `/documents/:id` | P08, P11 |
| F-47 Regenerate (doc / section) | M/S | ADR-0009 | DocumentVersion | `POST /documents/:id/regenerate` | viewer | P08, P11 |
| F-48 Documents library | M | — | GeneratedDocument | `GET /documents`, `DELETE` | `/documents` | P11 |
| F-49 Exports | M | ADR-0012 | DocumentVersion | `GET /documents/:id/export` | viewer | P11 |
| F-50 Result caching | M | ADR-0009 | inputHash | `POST /documents` (200 cached) | — | P08 |
| F-51 Achievement statement | S | ADR-0009 | (AiUsage) | `POST /ai/achievement-statement` | activity drawer, achievements | P08, P10, P12 |
| F-60 Achievements journal | M | — | Achievement, AchievementEvidence | `/achievements` CRUD | `/achievements`, ⌘K, dashboard | P12 |
| F-61 Achievements as evidence | M | ADR-0009 | AchievementEvidence | feed, timeline, documents | feed, career, documents | P12 (+P08 interface) |
| F-62 Goals | M | KPI keys | Goal, GoalAchievement | `/goals` CRUD | `/goals` | P12 |
| F-63 Weekly digest | M | — | DigestDelivery, UserSettings | `PATCH /me/settings`, `/notifications/unsubscribe` | email, `/settings/notifications` | P12 |
| F-64 AI digest summary | S | ADR-0009 | GeneratedDocument (DIGEST_SUMMARY) | (worker) | email | P08, P12 |
| F-65 Notification preferences | M | — | UserSettings | `PATCH /me/settings` | `/settings/notifications` | P12 |
| F-66 In-app notification centre | C | — | (v2.1) | — | — | v2.1 |
| F-67 Monthly digest | C | — | DigestDelivery | — | email | P12 (if time) |
| F-70 Responsive shell | M | — | — | — | all | P09 |
| F-71 Dark mode | M | — | — | — | all | P04, P09 |
| F-72 Command palette | S | — | — | various | all | P09 |
| F-73 Designed states | M | ADR-0010 | — | — | all | P09–P12 |
| F-74 Onboarding wizard | M | — | UserSettings.onboarding* | `/me`, connect, repos, sync | `/onboarding` | P09 |
| F-75 WCAG 2.2 AA | M | — | — | — | all | P04, P09–P14 |
| F-76 Redact private repos in AI | S | ADR-0009 | UserSettings.aiRedactPrivateRepos | `/me/settings` | `/settings/privacy` | P08, P12 |
| F-08, F-19, F-52, F-77 | W | ADR-0014 | — | — | — | v2.1 |

**Must coverage check:** every **M** feature above has at least one implementing phase in P05–P12. ✅

## 2. Open issues (target ≥ P05) → feature / phase

Issues targeting only P02 are P02's responsibility and not repeated here. "WF" = won't fix in v2.0.

| Issue | Sev | Resolved by | Phase(s) | Note |
|---|---|---|---|---|
| SEC-01 | 🔴 | F-01, ADR-0003 | P05 | `x-user-id` removed |
| SEC-02 | 🔴 | F-02, ADR-0003 | P05 | dev-login gated, web-only |
| SEC-03 | 🔴 | F-10, ADR-0005 | P05 | plaintext columns dropped |
| BUG-14 | 🔴 | F-40 | P02 hotfix, P11 | |
| DATA-01 | 🔴 | F-18, ADR-0007, DATA_MODEL §5 | P06 | stub migration + purge |
| UX-01 | 🔴 | F-70 | P09 | |
| SEC-04 | 🟠 | F-10, ADR-0004 | P05 | signed single-use state |
| SEC-05 | 🟠 | F-10, ADR-0004 | P05 (flow), P06 | GitHub App read-only permissions — decided |
| SEC-06 | 🟠 | ADR-0006 | P05 | cursor pagination, limit ≤ 100 |
| SEC-07 | 🟠 | ADR-0006 (rate classes), F-06 | P05, P08 | |
| SEC-08 | 🟠 | ADR-0006 | P05, P14 (web CSP) | |
| SEC-09 | 🟠 | ADR-0002, ADR-0003 | P02 (patch), P09 (major) | next-auth removed in P05 |
| BUG-04 | 🟠 | ADR-0006 (Zod pipe + exception filter) | P05 | invalid query → 400, never 500 |
| DATA-02 | 🟠 | F-20, KPI §3.7 | P07, P10 | |
| DATA-03 | 🟠 | F-11, F-12, ADR-0007 | P06 | |
| DATA-04 | 🟠 | F-15, ADR-0007 | P06 | |
| DATA-05 | 🟠 | ADR-0007 | P06 | non-default-branch commits not counted (documented caveat) |
| AI-01 | 🟠 | F-28, ADR-0008 | P07 | |
| AI-02 | 🟠 | ADR-0009 | P08 | |
| AI-03 | 🟠 | F-44, F-50, ADR-0009 | P08 | |
| API-01 | 🟠 | ADR-0006 | P05 | |
| API-02 | 🟠 | ADR-0006 | P05 | |
| PERF-01 | 🟠 | ADR-0007 (budget ≤ 250) | P06 | |
| UX-02 | 🟠 | F-70, F-20 | P09, P10 | |
| UX-03 | 🟠 | F-49 (documents), F-65/F-05 (settings) | P11, P12 | |
| UX-04 | 🟠 | F-46 | P11 | |
| UX-05 | 🟠 | F-73 | P09 | |
| GAP-01 | 🟠 | F-13, F-14 | P06 | |
| GAP-02 | 🟠 | F-21, F-23 | P10 | |
| GAP-03 | 🟠 | F-26, F-28, F-30, F-31 | P10 | `DateRangePicker` in P09 |
| GAP-04 | 🟠 | F-49 | P11 | |
| GAP-05 | 🟠 | F-48 | P11 | |
| GAP-06 | 🟠 | F-01 | P05, P09 | |
| SEC-11 | 🟡 | ADR-0009 | P08 | evidence delimiting + eval |
| SEC-12 | 🟡 | ADR-0006 | P05 | |
| SEC-13 | 🟡 | F-17, ADR-0004 | P05/P06 | token revoke on disconnect |
| SEC-14 | 🟡 | ADR-0013 | P15 | non-root images |
| BUG-05 | 🟡 | KPI §2.4, ADR-0006 | P05 (validation), P07 (periods) | inclusive end dates |
| BUG-06 | 🟡 | F-05, KPI §2.4 | P07 | |
| BUG-07 | 🟡 | ADR-0006, F-40–F-42 | P05, P08 | |
| BUG-08 | 🟡 | F-15 | P06, P10 | |
| BUG-09 | 🟡 | F-15 | P06 | progress from planned units |
| BUG-10 | 🟡 | ADR-0010 | P10 | |
| BUG-11 | 🟡 | ADR-0010 | P09 | |
| BUG-12 | 🟡 | ADR-0006 | P05 | |
| DATA-06 | 🟡 | F-15, ADR-0007 | P06 | |
| DATA-07 | 🟡 | F-17 | P06, P10 | |
| DATA-08 | 🟡 | ADR-0007, DATA_MODEL | P06 | |
| DATA-09 | 🟡 | ADR-0008 (recompute flow) | P07 | |
| DATA-10 | ⚪ | DATA_MODEL_V2 (designed in P03) | P06 (implement) | |
| OPS-13 | 🟡 | ARCHITECTURE §11 | P14, P15 | |
| AI-04 | 🟡 | ADR-0009 | P08 | |
| AI-05 | 🟡 | ADR-0009 | P08 | |
| AI-06 | 🟡 | F-45, ADR-0009 | P08 | |
| AI-07 | 🟡 | KPI §8, ADR-0009 | P08 | |
| AI-08 | 🟡 | F-06, F-07 | P08, P12 | |
| API-03 | 🟡 | F-01 | P05 | stubs removed |
| API-04 | 🟡 | F-28 | P05 (contract), P07 | |
| API-05 | 🟡 | ADR-0006 | P05 | |
| PERF-02 | 🟡 | ADR-0007 | P06 | batched writes |
| PERF-03 | 🟡 | ADR-0008 | P07, P10 | |
| PERF-04 | 🟡 | ADR-0010 | P09 | |
| PERF-05 | ⚪ | ADR-0010 (RSC shells, code splitting) | P09 | added by P02 |
| UX-06 | 🟡 | F-26, F-27 | P07, P10 | |
| UX-07 | 🟡 | F-73 | P09 | |
| UX-08 | 🟡 | F-73, F-75, F-44 | P09, P11 | |
| UX-09 | 🟡 | F-74 | P09 | |
| UX-10 | 🟡 | F-30 | P10 | |
| UX-11 | 🟡 | F-71 | P04, P09 | |
| UX-12 | 🟡 | F-44, F-48 | P11 | |
| GAP-07 | 🟡 | F-05, F-06, F-07, F-65 | P12 | |
| GAP-08 | 🟡 | F-40 | P08, P11 | `format` option honoured |
| GAP-09 | 🟡 | ADR-0006, ADR-0010 | P02, P05, P09 | |
| DEBT-06 | 🟡 | ADR-0010 | P09 | |
| DEBT-07 | ⚪ | ADR-0002 | P02, P09 | |
| DEBT-10 | ⚪ | ADR-0002 (end-state versions) | P05 (Prisma major with auth migrations), P06, P08 (SDK 1.x), P09 (Next/ESLint), P14 (TS 7 evaluation) | added by P02 |
| SEC-15 | ⚪ | ADR-0003 | P05, P09 | NextAuth route removed |
| BUG-13 | ⚪ | F-20 (formatting helpers) | P10 | |
| OPS-15 | ⚪ | ADR-0009 | P08 | |
| AI-09 | ⚪ | F-51 | P08 | `enhanceCommitMessage` → achievement statement |
| API-06 | ⚪ | ADR-0006 | P05 | `/health`, `/docs` |
| UX-13 | ⚪ | F-15, F-16 | P10 | |
| GAP-10 | ⚪ | — | **WF (v2.1)** | GitLab/Jira/Linear out of v2.0 scope (ADR-0014, D-018); integrations page shows "planned" cards without connect buttons |

Every open ISSUES row with a target of P05 or later is mapped above; one (GAP-10) is won't-fix for v2.0.
