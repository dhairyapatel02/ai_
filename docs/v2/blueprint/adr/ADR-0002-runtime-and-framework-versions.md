# ADR-0002: Runtime and framework versions

**Status:** Accepted (amends D-002)
**Date:** 2026-11-09
**Deciders:** Phase 03

## Context
v0.1.0 runs Next.js 14.2.3 (37 advisories), NestJS 10, Prisma 5, `@anthropic-ai/sdk` 0.24,
Zod 3, ESLint 8 (EOL), Node 18 images (EOL; the API crashes on Node 18 because octokit is
ESM-only — OPS-02). `npm outdated` shows two majors behind for most packages
(`audit/ARCHITECTURE_CURRENT.md §9`).

## Decision
| Area | Target | Phase |
|---|---|---|
| Node | **22 LTS** minimum (`engines: ">=22.12"`), images `node:22-alpine` (or 24 LTS if current at P15 and all deps support it) | P02 |
| TypeScript | latest **5.x** stable at P02 (`strict: true` everywhere). TS 7 (native compiler) evaluated in P14, not required | P02 |
| NestJS | **11.x** (+ `@nestjs/config`, `@nestjs/bullmq`, `@nestjs/throttler`, `nestjs-pino`). P02 shipped 11; NestJS 12 evaluated later (D-015, DEBT-10) | P02 |
| Prisma | P02 pinned **6.19** (D-015: Prisma 7+ needs driver adapters, `prisma.config.ts` and an ESM client). Upgrade to the latest major together with the data-model v2 migrations (P05/P06, tracked as DEBT-10) | P02, P05/P06 |
| BullMQ | latest stable major | P02 |
| Zod | **4.x** in all packages | P02 |
| octokit | latest (`octokit`, `@octokit/graphql`, throttling + retry plugins) | P06 |
| `@anthropic-ai/sdk` | latest 1.x (P02 kept 0.24 on purpose) | P08 |
| Next.js | P02: patch to latest **14.2.x** (security). P09: latest stable major (**16.x**) + React 19 | P02, P09 |
| Tailwind | **v4** (CSS-first `@theme`) + shadcn/ui via CLI | P09 |
| ESLint | flat config, ESLint 9/10 + typescript-eslint 8; Prettier | P02 |
| Postgres / Redis | **16** / **7** in compose and CI | P02 |
| Better Auth | latest stable (pinned exact) | P05 |

*Applied in P02 (D-015):* Node 22, NestJS 11, Prisma 6.19, TypeScript 5.9, ESLint 9, zod 4.6,
Next 14.2.35, BullMQ 5.81, `@anthropic-ai/sdk` 0.24. The targets above are the end state; DEBT-10
tracks the remaining majors.

Rules: pin exact versions for auth, Prisma and the Anthropic SDK; use `npm ci`; `npm audit --omit=dev`
gate in CI (no high/critical) from P02.

## Options Considered

### Option A: Upgrade backend in P02, frontend major in P09 (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium, spread over phases |
| Cost | Low |
| Scalability | Long support windows |
| Team familiarity | High |

**Pros:** security fixes land early; the UI rebuild absorbs the Next/React/Tailwind major changes once.
**Cons:** web runs patched Next 14 for several phases.

### Option B: Upgrade everything in P02
**Pros:** one migration. **Cons:** P02 would rewrite UI code that P09 replaces anyway. Rejected.

### Option C: Stay on current majors with patches
**Pros:** least work. **Cons:** EOL Node/ESLint, Prisma 5 and SDK 0.x lack needed features (structured outputs). Rejected.

## Trade-off Analysis
Backend upgrades unblock correctness (ESM octokit on Node 22) and security now; frontend majors are
cheapest during the planned rebuild.

## Consequences
- Easier: modern SDK features (structured outputs, streaming helpers), long LTS windows.
- Harder: Prisma 7 and Zod 4 have breaking API changes the P02 session must absorb.
- Revisit: Node 24 at P15; TS 7 at P14.

## Action Items
1. [ ] P02: Node 22 images, backend majors, Zod 4, ESLint flat config, Next 14.2.x patch.
2. [ ] P09: Next 16 + React 19 + Tailwind v4 via official codemods.
