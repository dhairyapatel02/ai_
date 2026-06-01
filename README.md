# DevImpact AI — Engineering Career Operating System

AI-powered platform that connects to your developer tools (GitHub, GitLab, Jira) and uses Claude AI to generate resume bullet points, performance appraisals, KPI dashboards, promotion packets, and impact scores from your engineering activity data.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TailwindCSS, shadcn/ui |
| Backend | Node.js + NestJS (REST API) |
| Database | PostgreSQL + Prisma ORM |
| Queue | Redis + BullMQ |
| AI | Anthropic Claude API (claude-sonnet-4-20250514) |
| Auth | NextAuth.js (GitHub OAuth + Google OAuth) |
| Infra | Docker Compose |

## Project Structure

```
devimpact-ai/
├── apps/
│   ├── web/          # Next.js frontend
│   └── api/          # NestJS backend
├── packages/
│   └── shared/       # Shared types/interfaces/schemas
├── docker-compose.yml
└── README.md
```

## Quick Start

### Prerequisites

- Node.js >= 18
- Docker & Docker Compose
- GitHub OAuth App credentials
- Anthropic API key

### 1. Clone & Install

```bash
git clone https://github.com/dhairyapatel02/ai_.git
cd ai_
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env
# Edit .env with your actual credentials
```

### 3. Start Infrastructure

```bash
docker compose up -d postgres redis
```

### 4. Database Setup

```bash
cd apps/api
npx prisma generate
npx prisma db push
cd ../..
```

### 5. Run Development Servers

```bash
# Terminal 1: API
npm run dev:api

# Terminal 2: Web
npm run dev:web
```

The web app runs at `http://localhost:3000` and the API at `http://localhost:4000`.

### Full Docker Setup

```bash
docker compose up --build
```

## Features

- **GitHub Integration** — OAuth connect, fetch commits/PRs/reviews, BullMQ background sync
- **Resume Generator** — AI-generated professional bullet points from activity data
- **Appraisal Reports** — Structured performance documents (monthly/quarterly/yearly)
- **Promotion Packets** — Data-driven promotion cases with leadership evidence
- **Impact Scores** — AI-calculated engineering effectiveness scores (0-100)
- **Career Timeline** — Visual history of contributions grouped by project
- **KPI Dashboard** — Productivity, quality, collaboration, and ownership metrics

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/github | GitHub OAuth callback |
| POST | /api/auth/google | Google OAuth callback |
| GET | /api/auth/me | Current user profile |
| GET | /api/integrations | List connected integrations |
| POST | /api/integrations/github/connect | Start GitHub OAuth |
| DELETE | /api/integrations/:id | Disconnect integration |
| POST | /api/sync/trigger | Manual sync trigger |
| GET | /api/sync/status | Sync job status |
| GET | /api/activity/commits | Paginated commits |
| GET | /api/activity/prs | Pull requests |
| GET | /api/activity/summary | Aggregated stats |
| POST | /api/generate/resume | Generate resume bullets |
| POST | /api/generate/appraisal | Generate appraisal report |
| POST | /api/generate/promotion | Generate promotion packet |
| GET | /api/generate/impact-score | Calculate impact score |
| GET | /api/documents | List generated documents |
| GET | /api/documents/:id | Get document |
| DELETE | /api/documents/:id | Delete document |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `NEXTAUTH_SECRET` | NextAuth.js encryption secret |
| `NEXTAUTH_URL` | Base URL for NextAuth (e.g., http://localhost:3000) |

## License

MIT
