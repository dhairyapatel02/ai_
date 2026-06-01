---
name: testing-devimpact-frontend
description: Test the DevImpact AI Next.js frontend end-to-end. Use when verifying UI pages, navigation, and component rendering.
---

# Testing DevImpact AI Frontend

## Prerequisites

- Node.js 20+ installed
- Dependencies installed (`npm install` from repo root)
- No API keys or database needed for frontend-only testing (pages use mock data)

## Starting the Dev Server

```bash
cd apps/web
NEXTAUTH_SECRET=test-secret NEXTAUTH_URL=http://localhost:3000 npx next dev --port 3000
```

The server needs `NEXTAUTH_SECRET` and `NEXTAUTH_URL` env vars even though auth isn't exercised during mock testing. Any dummy values work.

## Pages to Test

| Path | Key Elements |
|------|-------------|
| /dashboard | 4 stat cards (Commits, PRs, Reviews, Impact Score), Impact Score donut, Recent Activity feed |
| /connect | 4 integration cards (GitHub, GitLab, Jira, Linear) with Connect buttons |
| /resume | Date range picker, role selector, Generate button that produces 5 bullet cards |
| /appraisal | Period selector, Generate button |
| /promotion | Current/target role inputs, Generate button |
| /career | Timeline with quarterly periods and project cards with tags |
| /kpis | 4 metric cards, Impact Score donut, Monthly Trends table |
| /settings | Profile form, Plan & Billing section, Notifications |

## Key Mock Data Values

These values are hardcoded in the page components and should be verified during testing:

- Dashboard: Commits=142, PRs Merged=28, Reviews Done=45, Impact Score=78/100
- Impact breakdown: Features=82, Quality=75, Collab=80, Leadership=65
- Resume generates 5 bullets with categories: features, performance, reliability, collaboration
- Career Timeline: Q2 2024, Q1 2024, Q4 2023 periods
- KPIs: Productivity=142, Code Quality=2.1, Collaboration=45, Ownership=8

## Testing Flow

1. Start dev server (see above)
2. Verify server responds: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard` should return 200
3. Open browser to http://localhost:3000/dashboard
4. Navigate through each page via sidebar and verify key elements render
5. On /resume, click "Generate Resume Bullets" and wait ~2s for mock bullets to appear
6. Verify all sidebar navigation items are present and highlighted when active

## Gotchas

- Port 3000 may already be in use if a previous server didn't shut down cleanly. Kill it with `lsof -ti:3000 | xargs kill -9` or use a different port.
- The Generate buttons use `setTimeout` to simulate async generation — wait 2-3 seconds for results to appear.
- Pages render without errors even without backend running since all data is mocked inline.

## Backend Testing (requires credentials)

To test the full stack including API and AI generation:
- PostgreSQL + Redis must be running (use `docker compose up -d postgres redis`)
- Set `DATABASE_URL` and `REDIS_URL` in `.env`
- Run `npx prisma db push` in `apps/api/`
- Set `ANTHROPIC_API_KEY` for AI generation
- Set `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` for OAuth

## Devin Secrets Needed

For frontend-only testing: None required.

For full-stack testing:
- `ANTHROPIC_API_KEY` — Claude AI API key for generation features
- `GITHUB_CLIENT_ID` — GitHub OAuth app client ID
- `GITHUB_CLIENT_SECRET` — GitHub OAuth app client secret
