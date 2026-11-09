---
name: testing-devimpact-frontend
description: Test the DevImpact AI Next.js frontend end-to-end. Use when verifying UI pages, navigation, API wiring, and component rendering.
---

# Testing DevImpact AI Frontend

## Prerequisites

- Node.js 20+ installed
- Dependencies installed (`npm install` from repo root)
- For full-stack testing (recommended): PostgreSQL + Redis running via Docker

## Starting the Servers

### Full-Stack (recommended)

```bash
# 1. Start infrastructure
cd /home/ubuntu/repos/ai_
docker compose up -d postgres redis

# 2. Sync database schema
cd apps/api
export $(grep -v '^#' ../../.env | xargs)
npx prisma db push --accept-data-loss

# 3. Build and start API server
# IMPORTANT: Delete tsconfig.tsbuildinfo before first build — incremental cache
# may prevent file emission (0 errors but no dist/ output)
rm -f tsconfig.tsbuildinfo
npx tsc -p tsconfig.json
node dist/main.js &
# API runs on http://localhost:4000

# 4. Start frontend
cd ../web
NEXTAUTH_SECRET=test-secret NEXTAUTH_URL=http://localhost:3000 NEXT_PUBLIC_API_URL=http://localhost:4000/api npx next dev --port 3000
```

### Frontend-Only (limited testing)

```bash
cd apps/web
NEXTAUTH_SECRET=test-secret NEXTAUTH_URL=http://localhost:3000 npx next dev --port 3000
```

Without the API server, pages will show loading spinners or network errors instead of data.

## Pages to Test

All pages now call real backend API endpoints. With an empty database and placeholder credentials:

| Path | API Endpoints Called | Expected Behavior (empty DB) |
|------|---------------------|-----------------------------|
| /dashboard | GET /activity/summary, GET /generate/impact-score | 0 commits, 0 PRs, 0 reviews, "No activity data yet" + "Connect GitHub" CTA |
| /connect | GET /integrations, POST /integrations/github/connect | GitHub=Connect button, GitLab/Jira/Linear=Coming Soon |
| /resume | POST /generate/resume | Form with date pickers + role selector; Generate shows Anthropic error |
| /appraisal | POST /generate/appraisal | Form with period/month/year; Generate shows Anthropic error |
| /promotion | POST /generate/promotion | Pre-filled "Senior Engineer" → "Staff Engineer"; Generate shows Anthropic error |
| /career | GET /activity/commits, GET /activity/prs | "No timeline data yet" + "Connect GitHub" CTA |
| /kpis | GET /activity/summary, GET /generate/impact-score | Productivity=0, Code Quality=0, Collaboration=0, Ownership=0 |
| /settings | Uses auth context (no API call) | Name="Dev User", Email="dev@devimpact.ai", Plan=FREE |

## Key Discriminators (API-wired vs old mock data)

These values distinguish whether pages are calling real API or still using old hardcoded mock data:

| Check | Old Mock Value | Correct API Value (empty DB) |
|-------|---------------|-----------------------------|
| Dashboard commits | 142 | 0 |
| Dashboard PRs | 28 | 0 |
| Dashboard reviews | 45 | 0 |
| Dashboard impact | 78/100 | 0 or — |
| Resume "Generate" | 5 bullet cards after 2s delay | Red error about invalid API key |
| Career timeline | Q2 2024, Q1 2024, Q4 2023 | "No timeline data yet" |
| KPI productivity | 142 | 0 |

## Auth Flow

The `AuthProvider` context auto-creates a dev user on first visit:
1. Checks `localStorage` for `devimpact_user_id`
2. If not found, calls `POST /api/auth/dev-login`
3. Stores returned user ID in `localStorage`
4. All subsequent API calls include `x-user-id` header

To reset auth state: clear `localStorage.removeItem('devimpact_user_id')` in browser devtools.

## Testing Flow

1. Start both servers (see above)
2. Verify API: `curl -s http://localhost:4000/api/auth/dev-login -X POST -H 'Content-Type: application/json' -d '{}'` should return `{"success":true,"data":{...}}`
3. Verify frontend: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard` should return 200
4. Open browser to http://localhost:3000/dashboard
5. Wait for auth flow to complete (loading spinner → content)
6. Verify dashboard shows zeros (not old mock values like 142/28/45)
7. Navigate to each page via sidebar
8. On generation pages (Resume, Appraisal, Promotion), click Generate and verify error message appears
9. Verify Career and KPIs show appropriate empty states
10. Verify Settings shows "Dev User" / "dev@devimpact.ai" from API

## Known Issues

- **GitHub Connect with placeholder credentials**: Clicking Connect redirects to github.com with `client_id=placeholder` instead of showing a user-friendly error. The backend should validate the client ID before returning the OAuth URL.
- **Raw JSON error on generation pages**: Anthropic 401 errors are displayed as raw JSON. Could be improved to show a friendlier message like "Is the ANTHROPIC_API_KEY configured?"
- **TypeScript incremental build cache**: The API's `tsconfig.tsbuildinfo` file may prevent file emission on first build. Always delete it before running `npx tsc -p tsconfig.json` if `dist/` is empty despite 0 errors.

## Gotchas

- Port 3000/4000 may already be in use. Kill with `lsof -ti:3000 | xargs kill -9`.
- The API server requires env vars from `.env` to be exported before starting.
- Docker containers (postgres, redis) must be healthy before running Prisma or starting the API.
- `NEXT_PUBLIC_API_URL` must be set at frontend startup time (not just in .env) since Next.js inlines it at build/dev time.

## Devin Secrets Needed

For basic testing (empty DB, placeholder credentials): **None required** — the app handles missing credentials gracefully with error messages.

For full integration testing:
- `ANTHROPIC_API_KEY` — Claude AI API key for generation features (Resume, Appraisal, Promotion, Impact Score)
- `GITHUB_CLIENT_ID` — GitHub OAuth app client ID (create at https://github.com/settings/developers with callback URL `http://localhost:3000/connect/callback`)
- `GITHUB_CLIENT_SECRET` — GitHub OAuth app client secret
