# ADR-0013: Hosting target — platform-neutral now, final choice in P15

**Status:** Deferred to P15 — **user decision (2026-11-09): "Decide in P15"**; the constraints below are Accepted
**Date:** 2026-11-09
**Deciders:** Project owner; Phase 03

## Context
Every v0.1.0 Docker image fails (OPS-01..06). The owner has not chosen a platform. Later phases
must not lock in a vendor accidentally.

## Decision (constraints binding from now)
1. **Docker Compose self-hosting must always work** (web, api, worker, postgres, redis; prod
   profile with reverse proxy + TLS in P15).
2. Three stateless containers (`web`, `api`, `worker`) built from multi-stage, non-root images
   (Next `standalone` for web); `prisma migrate deploy` as a release step.
3. Dependencies only on **PostgreSQL 16** and **Redis 7** (managed or self-hosted) plus outbound HTTPS
   to GitHub, Anthropic and the email provider. No vendor-specific APIs in application code.
4. Configuration only through environment variables validated at boot (ARCHITECTURE_V2 §10).
5. Web and API may live on different origins (JWT auth, CORS allow-list) or behind one reverse proxy.
6. Long-lived connections: SSE requires the platform/proxy to allow ≥ 5-minute streaming responses
   with buffering disabled (`X-Accel-Buffering: no`).

## Options to evaluate in P15
| Option | Notes |
|---|---|
| Vercel (web) + Fly.io/Render/Railway (api, worker) + Neon/Supabase (Postgres) + Upstash/Redis Cloud | Planner's recommendation; check SSE limits on the API host and Redis Streams support |
| Single PaaS (Render or Railway) for everything | Simplest ops |
| Self-host only (Compose + Caddy on a VM) | Cheapest; owner operates backups |

## Consequences
- Easier: no premature lock-in; Compose remains the reference environment for tests.
- Harder: P15 must validate SSE, worker scaling and Redis features on the chosen platform.

## Action Items
1. [ ] P15: ask the owner (USER DECISION in P15), record a superseding ADR, add platform configs.
