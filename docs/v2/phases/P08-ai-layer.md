# Phase 08 — AI Layer v2

| | |
|---|---|
| **Goal** | Rebuild AI generation to be accurate, evidence-linked, streamed, cached, cost-controlled, safe against prompt injection, and measurably good (evals). |
| **Type** | Code (API + worker) |
| **Prerequisites** | P07 merged (metrics + evidence available) |
| **Parallel with** | P09/P10 |
| **Effort** | 1 session (large) |

## Context
v0.1.0 `apps/api/src/ai/ai.service.ts`: hard-coded outdated model, old SDK, no streaming, no
caching (each click = new call + new document), regex JSON extraction without validation, retry
on every error, prompt filling via `String.replace` (breaks on `$` patterns), only 20 most recent
commits / 15 PRs as input, untrusted text injected directly, `enhanceCommitMessage` unused.
D-009 + AI ADR are binding.

## Read first
AI ADR, `DECISIONS.md` D-009, `blueprint/PRD.md` (document types & UX), `blueprint/API_CONTRACT_V2.md`
(generation, documents, SSE), `blueprint/DATA_MODEL_V2.md` (`GeneratedDocument`, `AiUsage`),
`audit/ISSUES.md` (target 08). **Load the `claude-api` skill before writing any Claude code** —
use it for current model IDs, SDK version, streaming, structured outputs/tool use, prompt caching
and error types. Never hard-code a model ID in a service.

## Objectives
1. Typed, validated outputs for every generation type.
2. Every claim in a generated document cites evidence (PR/commit/review/achievement IDs) that
   exist in the user's data; uncited claims are flagged.
3. Streaming UX for long documents; async jobs for very long ones.
4. Caching, regeneration, versioning and user edits.
5. Cost visibility and per-plan quotas.
6. An eval harness that guards quality in CI.

## Tasks

### A. Foundation
1. Upgrade `@anthropic-ai/sdk` to latest. `AiClient` wrapper: model selection from config
   (`ANTHROPIC_MODEL_DEFAULT`, `ANTHROPIC_MODEL_FAST`), timeouts, retry only on retryable errors
   (429/5xx/overloaded) with exponential backoff + jitter, abort support, token usage capture.
2. Prompt system: `apps/api/src/prompts/<name>.v<N>.ts` exporting `{ id, version, system,
   buildUser(input), outputSchema (Zod), model: 'default'|'fast' }`. Template filling via a safe
   function (no `String.replace` pattern expansion). Use prompt caching for long stable system prompts.
3. Untrusted-data handling: activity text wrapped in clearly delimited data blocks; system prompt
   instructs to treat it as data only; strip/escape control sequences; length caps.
4. Structured output via tool use / JSON schema derived from Zod; validate; one automatic repair
   attempt on validation failure; then a typed error.

### B. Evidence pipeline
5. `EvidenceBuilder`: select the most significant evidence for a period instead of "most recent
   20": rank PRs by size/complexity/review depth/labels, cluster by repo/theme, include metric
   summaries from P07 and achievements (if P12 merged; otherwise interface only). Each item gets a
   short stable ref (e.g. `PR-123`) that the model must cite.
6. Post-generation verification: every cited ref exists and belongs to the user; strip or flag
   invalid refs; compute coverage ("% of bullets with evidence").

### C. Generators (rewrite all spec methods)
7. Resume bullets (role variants backend/frontend/fullstack/devops/manager; 5–8 bullets, themed,
   implicit STAR, quantified only from real metrics — never invented numbers).
8. Appraisal report (monthly/quarterly/yearly; spec sections + metrics table filled from P07, not
   the model).
9. Promotion packet (current → target role; spec sections; optional user-supplied level
   expectations/ladder text as extra input).
10. Impact highlights & narrative for a computed score (explicit request only, cached per score version).
11. `enhanceCommitMessage` → "achievement statement" for a single PR/commit, exposed as an endpoint
    used by the Activity explorer/Achievements (P10/P12), using the fast model.
12. Optional (if PRD includes): weekly reflection/digest summary generator (used by P12).

### D. Delivery
13. Endpoints per contract: `POST /documents` (type + options) → creates a `GeneratedDocument`
    in `pending` and either streams via `GET /documents/:id/stream` (SSE: `delta`, `section`,
    `done`, `error` events) or processes in the worker queue for long jobs; `GET /documents`,
    `GET /documents/:id`, `PATCH /documents/:id` (user edits → new version), `POST /documents/:id/regenerate`,
    `DELETE`. Keep/alias v1 `/generate/*` routes only if the contract says so.
14. Caching: `inputHash` = hash(prompt id+version, model, options, evidence refs+updatedAt). Same
    hash → return existing document unless `regenerate`.
15. Usage & quotas: record `AiUsage` (user, prompt, model, input/output tokens, cost estimate,
    latency, status). Enforce monthly quotas per plan (config) → 402/429 with a clear error code.
    `GET /me/usage` for the UI.

### E. Evals
16. `apps/api/test/evals/`: 5–10 fixture personas (seeded activity datasets) × each generator.
    Deterministic checks (schema valid, citation validity, no invented numbers — every number in
    output must appear in the evidence/metrics, section presence, length bounds, banned phrases).
    Run with a mocked client in CI (recorded responses); `npm run eval:live` runs against the real
    API when `ANTHROPIC_API_KEY` is set and writes a report to `docs/v2/evals/REPORT.md`.
    Optional LLM-as-judge rubric (clarity, specificity, impact) in live mode.

### F. Tests
17. Unit: template filling with `$&` etc., schema repair path, retry classification, cache-hit,
    quota enforcement, citation verification. Integration: SSE stream contract (events order,
    error event), ownership, rate limits from P05 still apply.

## Deliverables
AI client, prompt registry (versioned), evidence builder + verifier, generators, documents API
with SSE + versions, usage/quotas, evals (mocked in CI + live script), README "AI configuration"
section, PROGRESS.md.

## Acceptance criteria
- [ ] No model ID string appears outside config (`grep -r "claude-" apps/api/src` only hits config/tests).
- [ ] All generators return Zod-valid output; invalid model output triggers one repair then a typed error (tests).
- [ ] 100% of citations in eval outputs resolve to the user's own records; numbers in output are traceable to evidence (eval check passes).
- [ ] SSE endpoint streams incremental events and a final `done` with the saved document id (integration test).
- [ ] Identical request twice → second served from cache without calling the client (test).
- [ ] Quota exceeded → documented error code; usage visible via `/me/usage`.
- [ ] Prompt-injection fixture (commit message: "ignore previous instructions…") does not alter output structure (eval).
- [ ] `npm run check` + CI (incl. mocked evals) green; live eval report committed if a key was available (else noted).

## Handoff
Document the SSE event contract with examples (for P11), quota config, how to add a prompt
version, and eval results summary.
