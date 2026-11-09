# Original v1 Specification (reference)

> This is the original brief given to the previous AI agent that built v0.1.0. It is kept here
> verbatim in substance so that every fresh session has the full product intent.
> **V2 decisions in `docs/v2/DECISIONS.md` and the Phase 3 blueprint override this document
> wherever they conflict** (e.g. model IDs, framework versions, impact-score methodology).

---

You are building "DevImpact AI" — an AI-powered Engineering Career Operating System.

## PROJECT OVERVIEW
Build a full-stack web application that connects to developer tools (GitHub, GitLab, Jira etc.),
collects engineering activity data, and uses AI to automatically generate:
- Resume bullet points
- Appraisal reports (monthly/quarterly/yearly)
- KPI dashboards
- Promotion packets
- Career timelines
- Impact scores

## TECH STACK
- Frontend: Next.js 14 (App Router), TailwindCSS, shadcn/ui
- Backend: Node.js + NestJS (REST API)
- Database: PostgreSQL + Prisma ORM
- Queue: Redis + BullMQ (for async data sync jobs)
- AI: Anthropic Claude API (claude-sonnet-4-20250514)
- Auth: NextAuth.js with GitHub OAuth + Google OAuth
- Hosting-ready: Docker Compose setup included

## PHASE 1 — SCAFFOLD
```
devimpact-ai/
├── apps/
│   ├── web/      # Next.js frontend
│   └── api/      # NestJS backend
├── packages/
│   └── shared/   # Shared types/interfaces
├── docker-compose.yml
└── README.md
```

## PHASE 2 — DATABASE SCHEMA (Prisma)
- User — id, email, name, avatar, plan (FREE/PRO/TEAM/ENTERPRISE), createdAt
- Integration — id, userId, provider (GITHUB/GITLAB/JIRA/LINEAR), accessToken, refreshToken, metadata
- Commit — id, userId, integrationId, sha, message, repo, branch, additions, deletions, timestamp
- PullRequest — id, userId, integrationId, title, body, state, repo, mergedAt, reviewCount, timestamp
- Issue — id, userId, integrationId, title, labels, storyPoints, priority, status, projectName, timestamp
- CodeReview — id, userId, prId, comments, approved, timestamp
- GeneratedDocument — id, userId, type (RESUME/APPRAISAL/PROMOTION/KPI), content (JSON), dateRange, createdAt
- ImpactScore — id, userId, month, year, overall, featureDelivery, codeQuality, collaboration, leadership

## PHASE 3 — GITHUB INTEGRATION
1. OAuth flow: user connects GitHub account
2. On connect, fetch last 6 months of commits (all repos), PRs (opened + merged), code reviews (PRs reviewed)
3. Store in DB via BullMQ background job
4. Webhook support for real-time updates
5. Incremental sync every 24 hours

Endpoints: `GET /user/repos`, `GET /repos/{owner}/{repo}/commits?author=`, `GET /repos/{owner}/{repo}/pulls?state=all`, `GET /pulls/{pull_number}/reviews`

## PHASE 4 — AI LAYER (Claude)
AIService methods:
- **enhanceCommitMessage(rawMessage, context)** — input `{ message, repo, additions, deletions }`, output `{ enhanced, category: 'feature'|'bugfix'|'refactor'|'performance'|'infra' }`
- **generateResumeBullets(commits, prs, reviews, dateRange, role)** — 5–8 bullets, grouped by theme (performance, reliability, features, collaboration), implicit STAR, quantified, role variants backend/frontend/fullstack/devops/manager
- **generateAppraisalReport(activityData, period)** — sections: Executive Summary, Key Contributions (with evidence), Metrics (PR count, review count, features shipped), Areas of Impact, Growth & Learning, Goals for Next Period
- **generatePromotionPacket(currentRole, targetRole, activityData)** — sections: Why Ready for [Target Role], Leadership Evidence, Technical Impact, Business Value Created, Mentorship & Collaboration, Supporting Data
- **calculateImpactScore(activityData)** — `{ overall, featureDelivery, codeQuality, collaboration, leadership, highlights[] }`

For all AI calls: streaming for long documents, cache results in DB, retry with exponential backoff.

## PHASE 5 — API ROUTES
- Auth: `POST /auth/github`, `POST /auth/google`, `GET /auth/me`
- Integrations: `GET /integrations`, `POST /integrations/github/connect`, `DELETE /integrations/:id`
- Sync: `POST /sync/trigger`, `GET /sync/status`
- Activity: `GET /activity/commits?from=&to=`, `GET /activity/prs?from=&to=`, `GET /activity/summary?from=&to=`
- Generation: `POST /generate/resume {dateRange, role, format}`, `POST /generate/appraisal {period, month, year}`, `POST /generate/promotion {currentRole, targetRole}`, `GET /generate/impact-score?month=&year=`
- Documents: `GET /documents`, `GET /documents/:id`, `DELETE /documents/:id`

## PHASE 6 — FRONTEND PAGES
- **/dashboard** — stat cards (commits this month, PRs merged, reviews done, impact score), 30-day activity bar chart, recent activity feed, quick actions
- **/connect** — integration cards (GitHub, GitLab, Jira, Linear), connect/disconnect, last sync, sync now
- **/resume** — date range picker, role selector, generate w/ loading, preview, copy / download PDF / DOCX
- **/appraisal** — period selector, month/year picker, generate, rich preview, export
- **/promotion** — current/target role, generate, structured preview
- **/career** — visual timeline by year/quarter, grouped by repo, achievement tags, filter by year
- **/kpis** — metric cards; Productivity, Quality, Collaboration, Ownership sections; monthly trend charts; impact-score donut
- **/settings** — profile, plan & billing, connected integrations, notification preferences

## PHASE 7 — KEY UI COMPONENTS
`<ImpactScoreCard/>`, `<ActivityHeatmap/>`, `<ResumeBulletCard/>`, `<DocumentPreview/>`, `<SyncStatusBadge/>`, `<DateRangePicker/>`, `<GenerateButton/>`

## PHASE 8 — DOCKER & ENV
docker-compose: postgres:15, redis:7, api, web, worker (BullMQ consumer).
`.env.example`: DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY, GITHUB_CLIENT_ID/SECRET, GOOGLE_CLIENT_ID/SECRET, NEXTAUTH_SECRET, NEXTAUTH_URL.

## CODING STANDARDS
- TypeScript strict everywhere
- Zod for all input validation
- Error boundaries on all async components
- Loading skeletons for all data-fetching components
- All AI prompts in a dedicated `/prompts` folder as separate `.ts` files
- Env vars validated at startup with Zod
- API responses: `{ success: boolean, data?: T, error?: string }`
- All DB queries through Prisma service (no raw SQL except analytics)
