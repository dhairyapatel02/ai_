# Audit helper scripts (Phase 01)

Throwaway tools used to audit v0.1.0. They are **not** part of the product and are not run in CI.
Phase 02 builds the real seed script and test tooling. Run everything from the repo root with the
root `.env` exported (`set -a; . ./.env; set +a`).

| Script | Purpose | Usage |
|---|---|---|
| `seed-fixture.ts` | Seeds Alice (~6 months of commits, PRs, review stubs, impact scores, a document) and Bob (second tenant). Mirrors v0.1.0's stub-PR behaviour | `node docs/v2/audit/scripts/seed-fixture.ts [--wipe \| --wipe-all]` (Node ≥ 22.18) |
| `probe-api.sh` | curl probes of every endpoint → JSONL | `probe-api.sh <aliceId> <bobId> <bobIntegrationId> <aliceDocId> <bobDocId> [out.jsonl] [all\|gen-mock\|gen-real\|destructive\|auth-extra]` |
| `render-api-results.py` | Renders the JSONL into the tables in `API_TEST_RESULTS.md` (verdict map inside) | `python3 render-api-results.py logs/api-probes.jsonl` |
| `mock-anthropic.mjs` | Minimal Messages API stand-in; captures prompts; `FORCE_400` / `FORCE_PROSE` triggers | `node mock-anthropic.mjs 4010 docs/v2/audit/logs/ai-prompts`, then start the API with `ANTHROPIC_BASE_URL=http://localhost:4010` |
| `sync-repro.cjs` | Runs the real compiled `SyncProcessor` + `GitHubService` against the local DB with GitHub faked via a `fetch` stub | `node sync-repro.cjs correctness \| scale` (needs `apps/api/dist`) |
| `replace-dollar-repro.mjs` | 5-line repro of the `String.replace` `$`-pattern bug | `node replace-dollar-repro.mjs` |
| `ui-audit.cjs` | Playwright pass over every page (screenshots + JSON facts) and an interaction pass | `node ui-audit.cjs <seeded\|empty\|apidown> [userId]`, `node ui-audit.cjs interactions <userId>` |

Local-only workarounds used during the audit (never committed): starting `dockerd` manually,
`docker compose -p devimpact`, pulling `node:18-alpine` from `mirror.gcr.io`, throw-away copies of
the Dockerfiles that inject the sandbox CA/proxy (and, to get past each failure, copy
`tsconfig.base.json` / drop the `.prisma` copy), and deleting `apps/api/tsconfig.tsbuildinfo`
before `npm run dev:api`. See `PROGRESS.md` (Phase 01 handoff).
