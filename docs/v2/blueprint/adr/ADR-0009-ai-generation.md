# ADR-0009: AI generation — worker-run, streamed, structured, cached, evidence-cited

**Status:** Accepted (amends D-009: default model tier, worker execution with Redis Streams, structured outputs via `output_config.format`, refusal fallback)
**Date:** 2026-11-09
**Deciders:** Phase 03

## Context
v0.1.0's `AIService` hard-codes an outdated model ID (AI-02), uses SDK 0.24, no streaming or
caching (AI-03), parses JSON with a greedy regex, retries every error (AI-04), fills templates with
`String.replace` (AI-05), samples the 20 most recent items with no evidence IDs (AI-06), feeds
mislabeled metrics (AI-07), has no usage tracking or quotas (AI-08) and interpolates untrusted
commit text into prompts (SEC-11). Current Anthropic models and SDK features were checked with the
`claude-api` skill on 2026-11-09.

## Decision

### Models and client
- Model IDs come only from config: `ANTHROPIC_MODEL_DEFAULT` (documents, highlights) default
  **`claude-opus-5-5`**; `ANTHROPIC_MODEL_FAST` (achievement statements, digest summaries) default
  **`claude-haiku-5-5`**. (Amendment: D-009 proposed a Sonnet-class default; the current Opus is the
  quality default at ~US$0.10–0.15 per document, inside the PRD cost ceiling. P08 evals may compare
  `claude-sonnet-5-5` and switch the env default if quality holds — a config change, not code.)
- `@anthropic-ai/sdk` latest 1.x, one `AiClient` wrapper: timeouts, `AbortController`, usage capture,
  typed error mapping. Thinking is adaptive by default on the default model (cannot be disabled);
  depth controlled with `output_config.effort` (`medium` for documents, `low` for fast tasks).
- Retries: SDK `maxRetries: 2` for 408/409/429/5xx/connection errors, plus our job-level retry only
  for `RateLimitError`, `InternalServerError`, overloaded and `APIConnectionError` with exponential
  backoff + jitter. `BadRequestError`, `AuthenticationError`, `PermissionDeniedError` are terminal.
- Refusals: always check `stop_reason`; when `AI_FALLBACKS_ENABLED=true` (default on the Claude API)
  send the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`);
  a final `refusal` becomes a typed `GENERATION_FAILED` error with no quota charge.
- `ANTHROPIC_BASE_URL` supported for test mode (mock server, OPS-15). Tests never call the real API.

### Prompts
- `apps/api/src/prompts/<name>.v<N>.ts` exporting `{ id, version, model: 'default'|'fast', system,
  buildUser(input), outputSchema (Zod) }`. Templating via a safe function (no `String.replace`
  pattern expansion) — fixes AI-05.
- Long, stable system prompt + output schema first with `cache_control` (prompt caching); volatile
  evidence afterwards.
- **Untrusted data:** activity text is serialised as JSON inside `<evidence>` tags; the system prompt
  states that evidence is data, never instructions; control characters stripped; per-field length caps
  (titles 300, bodies 2,000, total evidence ≤ ~60k tokens) — fixes SEC-11.

### Structured output
- `output_config.format` with a JSON schema derived from the Zod `outputSchema` (forced
  `tool_choice` is not supported on the default model, so tools are not used for formatting).
- Validate with Zod; on failure one **repair** call (fast model, includes validation errors); then
  `OUTPUT_INVALID`.
- Engine-filled sections (metrics tables, supporting data) are merged **after** generation; the model
  never writes them.

### Evidence and citations
- Deterministic `EvidenceBuilder`: ranks PRs by (merged, changed-lines band, reviewers, review depth,
  labels like `incident`/`perf`), clusters by repo/theme, adds reviews summary, metric values and
  achievements; assigns stable refs (`PR-owner/repo#123`, `REV-…`, `C-…@sha7`, `ACH-<id>`).
- Every claim-bearing item must cite refs. Post-generation verifier: refs must exist in the evidence
  set (and belong to the user); invalid refs removed and flagged `invalid_citation`; uncited items
  flagged `uncited`; `citationCoverage` stored.
- Numbers in prose must appear in the supplied metrics/evidence (eval-enforced).
- `UserSettings.aiRedactPrivateRepos` replaces private repo names with neutral labels in evidence.

### Execution and delivery
- `POST /documents` validates, checks quota, builds evidence, computes
  `inputHash = sha256(promptId, promptVersion, model, canonical(options), sorted(evidence ref + updatedAt), metricsVersion)`.
  Same hash and not `regenerate` → return the existing document (no quota).
- Otherwise create `GeneratedDocument (PENDING)` and enqueue `ai.generate` in the **worker**. The
  worker streams from Anthropic (`messages.stream`), parses partial JSON, and publishes `status`,
  `section`, `delta`, `done`/`error` events to a **Redis Stream** `doc-events:<id>` (1 h TTL). The API
  SSE endpoint relays the stream with `Last-Event-ID` resume (API_CONTRACT_V2 §13.3). Results survive
  navigation and API restarts.
- Quick actions (fast model) run as `ai.quick` jobs; the API awaits completion (≤ 20 s) and returns JSON.
- Versions: each generation or user edit creates a `DocumentVersion`.

### Usage and quotas
- `AiUsage` row per call (tokens incl. cache read/write, cost estimate from a config price table,
  latency, status). Quotas per plan (PRD §6): generations and quick actions per UTC month; cache hits,
  failures and cancellations don't count; exceeded → `402 QUOTA_EXCEEDED`. Rate-limit class `ai`
  (API_CONTRACT_V2 §1.1).

### Evals
- `apps/api/test/evals/`: personas × generators with deterministic checks (schema, citation validity,
  numeric traceability, required sections, length, banned phrases, prompt-injection fixture). CI uses
  recorded responses; `npm run eval:live` uses the real API when a key is present.

## Options Considered

### Option A: Worker + Redis Streams + SSE relay (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | Redis already present |
| Scalability | API stays light; worker concurrency caps spend |
| Team familiarity | Medium |

**Pros:** no lost results on navigation/restart; one execution path for short and long docs; cancel support.
**Cons:** extra hop (worker → Redis → API → browser), stream retention to manage.

### Option B: Stream directly from the API request
**Pros:** simplest. **Cons:** result tied to the HTTP connection; API instances hold long requests; restart loses work. Rejected.

### Option C: Queue only, poll for result (no streaming)
**Pros:** simple. **Cons:** 30–90 s with no feedback (spec requires streaming). Rejected.

### Model tier sub-options
Opus 5.5 default (chosen, quality-first, configurable); Sonnet 5.5 default (cheaper, revisit after evals); Haiku 5.5 for fast tasks (chosen).

## Trade-off Analysis
Durable worker execution plus resumable streams gives the best UX and reliability for a few
hundred lines of plumbing; strict evidence handling is what makes documents trustworthy.

## Consequences
- Easier: fixes AI-02..09, SEC-11, GAP-08, UX-12 (with P11); cost visibility.
- Harder: partial-JSON parsing for section events; eval maintenance; Redis stream lifecycle.
- Revisit: model defaults after P08 evals; Batch API for digests if volume grows.

## Action Items
1. [ ] P08: AiClient, prompt registry, EvidenceBuilder + verifier, generators, worker job, Redis-stream SSE, quotas, evals.
2. [ ] P08: README "AI configuration" (env, models, test mode).
3. [ ] P11: fetch-SSE consumer, citation chips, flags UI.
