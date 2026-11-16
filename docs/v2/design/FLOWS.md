# User Flows — DevImpact AI v2.0

*Phase 04 · 2026-11-09.* Each flow lists the trigger, the steps (Mermaid flowchart), every
non-happy branch, the API calls involved ([API_CONTRACT_V2](../blueprint/API_CONTRACT_V2.md)) and the
copy for the key moments. Routes follow [IA.md](IA.md). Flows map to the PRD journeys
(UJ-1…UJ-8) that P14 turns into E2E tests.

| # | Flow | PRD journey |
|---|---|---|
| F1 | Sign-up / sign-in | UJ-1 |
| F2 | Onboarding wizard (connect → repositories → first sync → dashboard) | UJ-1 |
| F3 | Reconnect / expired or revoked access | UJ-8 |
| F4 | Manual sync | — (F-13) |
| F5 | Generate → stream → edit → export a document | UJ-2, UJ-3, UJ-4 |
| F6 | Regenerate (same options, different options, one section) | UJ-2–4 |
| F7 | Add an achievement (manual, from a PR, from the digest) | UJ-5 |
| F8 | Set a goal | — (F-62) |
| F9 | Explain a metric | UJ-6 |
| F10 | Export my data / delete my account / disconnect | UJ-7 |

---

## F1 · Sign-up / sign-in

```mermaid
flowchart TD
  A[Visit any app URL] --> B{Session?}
  B -- yes --> C{Onboarding complete?}
  B -- no --> D["/sign-in"]
  D --> E[Continue with GitHub or Google]
  E --> F[Provider consent screen]
  F -- approved --> G[Better Auth callback creates or links the user]
  F -- cancelled --> H[Back on /sign-in with notice: Sign-in was cancelled]
  G --> I{Email already linked to another provider?}
  I -- yes, verified --> J[Accounts linked, continue]
  I -- no --> J
  J --> C
  C -- no --> K["/onboarding (resume at saved step)"]
  C -- yes --> L["Return to the requested URL, else /dashboard"]
```

- **APIs:** web `POST /api/auth/sign-in/social`, `GET /api/auth/callback/:provider`, then `GET /me`
  (`onboarding.step`, `onboarding.completed`). Dev: `POST /api/dev-login` (button only when
  `ENABLE_DEV_LOGIN=true` outside production).
- **States:** provider error → inline banner "We couldn't sign you in with GitHub. Try again, or use
  Google." Session expired while using the app → token refresh silently; if refresh fails, redirect
  to `/sign-in?returnTo=` with "Your session ended. Sign in to continue."
- **Copy:** "Signing in only reads your name and email. Connecting repository data is a separate,
  read-only step you control."

## F2 · Onboarding wizard

```mermaid
flowchart TD
  S1["Step 1 /onboarding/connect"] --> A1[Install GitHub App]
  A1 --> GH[GitHub: choose account or org and repositories]
  GH -- installed --> CB["/integrations/github/callback"]
  GH -- org owner must approve --> PEND["/onboarding/pending"]
  GH -- cancelled --> DEN[Back to step 1: authorization was cancelled]
  CB --> V{POST callback result}
  V -- 201 integration + backfill queued --> S2["Step 2 /onboarding/repositories"]
  V -- 400 state invalid or expired --> RETRY[Step 1 with banner: link expired, try again]
  V -- 409 account in use --> INUSE[Step 1 with banner: GitHub account linked to another DevImpact user]
  PEND -- continue with personal repositories --> S2
  PEND -- org approves later --> MAIL[Email + automatic import]
  S2 --> R1[Repositories with activity in 12 months pre-selected]
  R1 --> R2{At least one selected?}
  R2 -- no --> R1
  R2 -- yes --> S3["Step 3 /onboarding/sync"]
  S3 --> P1[Stages: repositories, your PRs, reviewed PRs, commits, KPIs]
  P1 --> P2{Recent 30 days processed?}
  P2 -- yes --> READY[Your dashboard is ready - older history still loading]
  READY --> DASH["/dashboard with info banner until backfill finishes"]
  P1 -- rate limited --> RL[Paused until HH:MM - resumes automatically]
  RL --> P1
  P1 -- failed --> FAIL[Error with reason, Retry and Contact options]
  FAIL --> P1
```

- **APIs:** `POST /integrations/github/connect { returnTo: '/onboarding' }` → `{ url, mode }`;
  `POST /integrations/github/callback { code, state, installationId, setupAction }`;
  `GET /repos?integrationId=` + `PATCH /repos { ids, included }`; progress via
  `GET /sync/stream?runId=` (SSE, Should) with polling fallback `GET /sync/status` every 2 s
  (30 s while `waiting_rate_limit`); `PATCH /me/settings { onboardingStep, timezone }` after each step.
- **Resumable:** leaving at any step stores `onboardingStep`; `/onboarding` redirects back there.
  "Finish later" goes to the dashboard first-run state (checklist).
- **Time zone:** prefilled from the browser on step 1 (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
  and shown as "Times will be shown in Europe/London" with a link to change it.
- **Recent-first:** the "dashboard ready" moment is the first `SyncRunDto` where
  `recentWindowCompletedAt` is set (API amendment A-4); the banner stays on Overview pages until the
  run is `succeeded`.
- **Copy:** org pending — "Waiting for harbor-io to approve DevImpact. An organization owner must
  approve it on GitHub before DevImpact can read those repositories." with a copyable message for the admin.

## F3 · Reconnect (expired or revoked access, app uninstalled, installation suspended)

```mermaid
flowchart TD
  W[Webhook or failed token refresh] --> ST[Integration status: needs_reauth or suspended]
  ST --> UI1[Sync chip: Needs reconnection]
  ST --> UI2[Dashboard and Integrations banner with Reconnect]
  ST --> UI3[Next step card: Reconnect GitHub]
  ST --> EM[Email if notifySyncFailures]
  UI2 --> RC[POST integrations id reconnect]
  RC --> GH[GitHub authorise]
  GH -- ok --> OK[Status active, toast: GitHub reconnected, incremental sync queued]
  GH -- cancelled --> BACK[Banner stays, nothing changes]
  ST -.-> SYNC{User presses Sync now}
  SYNC --> E409[409 INTEGRATION_NEEDS_REAUTH opens the reconnect flow instead]
```

- Data is never deleted by this flow. Copy: "GitHub revoked DevImpact's access on Nov 8. Your data is
  kept, but nothing new is imported until you reconnect."
- `suspended` (org suspended the installation): banner names the org and says "Ask an owner of
  harbor-io to unsuspend DevImpact. Your personal repositories keep syncing."

## F4 · Manual sync

```mermaid
flowchart TD
  T[Sync now: Integrations page, palette, or failed-sync banner] --> P[POST sync]
  P -- 202 --> Q[Chip: Syncing, progress in Integrations]
  P -- 409 SYNC_IN_PROGRESS --> CUR[Show current run progress, no error]
  P -- 409 needs reauth --> F3[Reconnect flow]
  P -- 429 RATE_LIMITED --> RL[Toast: You can sync again at HH:MM]
  Q --> D{Run result}
  D -- succeeded --> OK[Toast: Sync finished - N new items, data refreshes in place]
  D -- partial --> PART[Toast + history row lists failed repositories with reasons]
  D -- failed --> FAIL[Banner: Last sync failed, Retry and View details]
  D -- waiting_rate_limit --> RLW[Chip: Paused until HH:MM]
```

- Button is disabled with a reason while a run is queued/running ("A sync is already running").
- Data on screen refreshes by invalidating TanStack Query keys for metrics, activity and career on
  `done` — no page reload.

## F5 · Generate → stream → edit → export

```mermaid
flowchart TD
  E1[Entry: Dashboard Draft appraisal, Next step card, New menu, palette, Documents New] --> ST["Studio /documents/new/type"]
  ST --> OPT[Options: period, role, notes, ladder, job description]
  OPT --> PREV[Evidence preview updates as options change]
  PREV --> CHK{Enough evidence and quota?}
  CHK -- no evidence --> NE[Inline warning: choose a longer period, Generate disabled]
  CHK -- quota used up --> QE[Generate disabled: used all 15 generations, resets Dec 1]
  CHK -- ok --> GEN[Generate]
  GEN --> R{POST documents}
  R -- 200 cached --> VIEW["Viewer /documents/id shows existing result + note: reused, no quota used"]
  R -- 201 pending --> STREAM[Viewer opens, SSE stream]
  R -- 402 or 429 --> ERR1[Inline error with reset time or retry time]
  STREAM --> SEC[Sections appear one by one, status: Writing section 2 of 5]
  SEC -- user leaves page --> BG[Generation continues, sidebar spinner, toast with Open when done]
  SEC -- Stop --> CAN[POST cancel: Generation stopped, no quota used]
  SEC -- error event --> FAILD[Banner: couldn't finish, Try again, no quota used]
  SEC -- done --> DONE[Coverage badge, flags banner if uncited claims, toast: Appraisal ready]
  DONE --> EDIT[Edit: inline, autosave as new version]
  EDIT --> SAVE{PATCH documents id}
  SAVE -- 409 VERSION_CONFLICT --> CONF[Dialog: newer version exists - reload or keep mine as new version]
  SAVE -- ok --> SAVED[Saved v N]
  DONE --> EXP[Export menu]
  SAVED --> EXP
  EXP --> COPY[Copy as Markdown or plain text: toast Copied]
  EXP --> FILE[Download PDF, DOCX or Markdown: GET export]
```

- **APIs:** `POST /documents/preview-evidence`, `POST /documents`, `GET /documents/:id/stream`
  (fetch-based SSE, `Last-Event-ID` resume), `POST /documents/:id/cancel`, `GET /documents/:id`,
  `PATCH /documents/:id { baseVersion, content }`, `GET /documents/:id/export?format=`.
- **Peak moment:** the first section appears < 8 s after Generate (NFR); the status line names the
  section being written so the wait is legible (Doherty threshold). Screen readers hear one polite
  announcement per completed section, not per token.
- **Citations:** every claim ends with evidence chips; clicking a chip opens a popover (title, repo,
  date, GitHub link). Uncited / invalid claims get a wavy warning underline plus a "No evidence linked"
  chip, and a banner summarises them before export.
- **Ending:** "Appraisal ready — 96% of claims cited." with Export as the primary action.

## F6 · Regenerate

```mermaid
flowchart TD
  V[Viewer: Regenerate menu] --> A[Regenerate document]
  V --> B[Change options and regenerate]
  V --> C[Regenerate one section - Should]
  A --> CONF[Confirm: new version from same options, current version kept, uses 1 generation]
  CONF --> RG[POST documents id regenerate]
  B --> STU[Studio pre-filled with this document's options] --> RG2[POST documents id regenerate with options]
  C --> RS[POST documents id regenerate with section] --> STR1[Only that section streams, saved as next version]
  RG --> STR[Stream into the same document as version N+1]
  RG2 --> STR
  STR --> HIST[Versions panel lists v1 Generated, v2 Your edits, v3 Regenerated - Restore any]
```

- Regenerating never discards edits: the previous version remains in history; Restore creates a new
  version (`source: restore`). 409 `GENERATION_IN_PROGRESS` → "This document is still being written."

## F7 · Add an achievement

```mermaid
flowchart TD
  M1[Achievements: Add achievement] --> DLG[Dialog: title, category, date, impact, links, linked evidence]
  M2[Dashboard header, New menu, palette, A shortcut] --> DLG
  P1[Activity drawer: Turn into achievement] --> AI[POST ai achievement-statement]
  AI -- ok --> DLG2[Dialog pre-filled, note: drafted by AI from PR-ref, edit before saving]
  AI -- 402 quick quota used --> Q[Inline: quick AI actions used up, add it manually]
  Q --> DLG
  D1[Weekly digest: Capture this] --> DLG2
  DLG --> VAL{Title present, date not in future?}
  DLG2 --> VAL
  VAL -- no --> ERR[Inline field errors, focus first invalid field]
  VAL -- yes --> SAVE[POST achievements]
  SAVE --> T[Toast: Achievement saved, View]
  T --> USE[Appears in Achievements, Career timeline, feed and as citable evidence ACH-id]
```

- Delete is immediate with an **Undo** toast (7 s) instead of a confirmation dialog.

## F8 · Set a goal

```mermaid
flowchart TD
  G1[Goals: Add goal] --> D[Dialog: goal text, optional metric, comparator, target, target date]
  D --> M{Metric chosen?}
  M -- yes --> T[Target validated against the metric unit: hours, percent, count]
  M -- no --> A[Tracked by linked achievements]
  T --> S[POST goals]
  A --> S
  S --> C[Card shows progress on the most recent complete month: On target, Not yet, Not enough data]
```

- Goal status uses semantic badges with icon + text; the comparison month is stated on the page
  ("Progress is measured on October 2026, your most recent complete month").

## F9 · Explain a metric

```mermaid
flowchart TD
  I[Info button on any metric, stat card or impact component] --> DR[Explain drawer]
  DR --> D1[Definition and good range]
  DR --> D2[Your value for the period, sample n, minimum n]
  DR --> D3[Formula]
  DR --> D4[Last 6 months chart + table toggle]
  DR --> D5[Caveats and why gaming it does not help]
  DR --> D6[Evidence list - first 8 records, link to Activity filtered]
  D6 --> ACT["/activity?metric=key&period=..."]
```

- **APIs:** `GET /metrics/definitions` (cached 1 h), the page's `MetricValue`, `GET /metrics/timeseries`,
  `GET /metrics/evidence` (API amendment A-2).

## F10 · Export data, delete account, disconnect

```mermaid
flowchart TD
  P["/settings/privacy"] --> EX[Export data]
  EX --> EXR{GET me export}
  EXR -- ok --> DL[Download devimpact-export-date.json, toast]
  EXR -- 429 --> LIM[Inline: 3 exports a day - try again tomorrow]
  P --> DEL[Delete account]
  DEL --> DLG[Alert dialog: type your email to confirm, button disabled until it matches]
  DLG --> DR{DELETE me}
  DR -- 202 --> OUT[Signed out to sign-in page: Account deleted]
  DR -- 400 mismatch --> E1[Field error]
  I["/settings/integrations"] --> DIS[Disconnect]
  DIS --> CH[Alert dialog: Keep my data or Delete imported activity]
  CH --> DI{DELETE integrations id with purgeData}
  DI --> DONE[Toast + first-run states where data was purged]
```

- Destructive actions use `alertdialog`, name the consequence in the title ("Delete your account?"),
  list what is deleted, and put the destructive button last with explicit copy ("Delete account",
  never "OK").
