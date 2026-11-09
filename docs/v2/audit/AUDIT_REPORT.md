# DevImpact AI v0.1.0 — Audit Report

*Phase 01 · 2026-11-09 · audited code: baseline `ed6ed4f` (same app code as `main`)*

## Page 1 — Summary for the owner

**What DevImpact AI is meant to do.** Connect to an engineer's GitHub, collect their commits,
pull requests and code reviews, measure their impact, and use Claude to write resume bullets,
appraisals and promotion packets from that evidence.

**What we did.** We read every source file, installed and ran the whole system on a clean machine,
filled it with six months of realistic test data, sent 87 test requests to the server, opened
every page on a desktop and a phone screen in three situations (77 screenshots), and
re-ran the real GitHub-sync code against a simulated GitHub to see how it behaves.

**The short verdict.** v0.1.0 is a **good-looking prototype, not a product.** The screens and the
basic plumbing exist, and the AI prompts are a reasonable start. But it cannot be safely put in
front of real users, and several headline features don't actually work.

**What works today**

- The app starts locally (with some manual workarounds) and every page opens without crashing.
- With test data, the dashboard, KPI, career and integrations pages display numbers.
- The server can ask Claude for a resume, appraisal or promotion packet and save the result.
- Inside the database, users' records are kept apart correctly *once we know who the user is*.

**What doesn't work**

1. **There is no real login.** Anyone can become any user by typing an email address or an ID;
   every new visitor is silently signed into the *same* shared account. Private GitHub access
   tokens are stored unencrypted. *This alone blocks any public release.*
2. **The numbers are wrong.** Pull requests you merely *reviewed* are counted as pull requests you
   *wrote* — in our test data 61 % of a user's "PRs" were really other people's. The "PRs Merged"
   card counts all PRs. The impact score is made up by the AI each month — it even scored a month
   with no activity at all 72/100.
3. **Key features are broken or missing.** The resume page shows a blank card even when the AI
   succeeds. Copy, PDF export, settings "Save" and notification buttons do nothing. Appraisals
   appear as raw code-like text. There are no charts.
4. **Unusable on phones.** Below laptop width the navigation menu disappears entirely.
5. **Data collection is unreliable.** The GitHub sync looks at only 30 repositories, silently skips
   any it has trouble with while reporting "Synced", and for an active engineer would make ~8,700
   GitHub requests per sync — more than GitHub allows per hour. There is no automatic daily sync.
6. **It can't be deployed.** None of the Docker images build; once we patched around that, the
   server crashed on start-up, and the "worker" points to a file that doesn't exist. The README's
   setup steps also fail as written.
7. **No safety net.** No automated tests, no lint, no CI, no error tracking.

**Recommendation.** **Keep the stack and the overall shape** (Next.js + NestJS + Postgres + Redis
+ Claude, monorepo) — the codebase is small (~4.5k lines) and its structure is sensible.
**Rebuild the parts that carry trust**: authentication, the sync engine, the metrics/impact-score
engine, the AI output handling, and most of the user interface. This matches the 15-phase plan in
`docs/v2/README.md` without changes to its order; Phases 02 (stabilise) and 03 (blueprint) can
start immediately and in parallel.

**Issue count:** 106 tracked issues — **10 critical**, 34 high, 50 medium, 12 low
(full list: [`ISSUES.md`](ISSUES.md)).

---

## Top 10 risks

| # | Risk | Why it matters | Issues | Fixed in |
|---|---|---|---|---|
| 1 | Anyone can impersonate or take over any account | Read, generate on behalf of, and delete any user's data (demonstrated) | SEC-01, SEC-02 | P05 |
| 2 | GitHub tokens with full `repo` (write) scope stored in plaintext | A DB leak exposes every user's private code with write access | SEC-03, SEC-05 | P05/P06 |
| 3 | Headline numbers are inflated or invented | Users would put wrong numbers in appraisals/promotion cases — reputational risk and fairness problem | DATA-01, DATA-02, AI-01, UX-06 | P06/P07 |
| 4 | Silent data loss in sync while showing "Synced" | Users trust incomplete data; rate limits guarantee it for active engineers | DATA-03, DATA-04, PERF-01, BUG-08 | P06 |
| 5 | Production build and all Docker images are broken | Nothing can be deployed | BUG-01, OPS-01..06 | P02 |
| 6 | Unbounded, unauthenticated AI calls | Anyone can run up the Anthropic bill (100 KB prompts accepted, retries re-bill) | SEC-07, AI-04, AI-08 | P05/P08 |
| 7 | Known-vulnerable framework versions (Next.js 14.2.3 critical advisories, Nest/Express chain) | Exploitable once deployed | SEC-09, SEC-10 | P02 (patch) / P09 |
| 8 | Core user journeys end in a blank card or a JSON dump; dead buttons | Users conclude the product doesn't work | BUG-14, UX-03, UX-04 | P02 hotfix / P11 |
| 9 | No mobile navigation; errors look like "no data" | Phone users stuck; outages invisible | UX-01, UX-05 | P09 |
| 10 | No tests, lint or CI | Every later phase risks regressions | DEBT-02, DEBT-03 | P02 |

## Keep vs rewrite — per module

| Module | Verdict | Justification |
|---|---|---|
| Monorepo layout (npm workspaces, `apps/web`, `apps/api`, `packages/shared`) | **Keep** | Sensible and small; just make `shared` actually shared (DEBT-01). D-001 confirmed by the audit |
| `apps/api` bootstrap / module wiring | **Keep, harden** | Standard Nest structure. Add env validation, exception filter, helmet, throttler, logging, health (P02/P05) |
| `auth` module + web `AuthProvider` | **Rewrite** | The concept (header identity + public dev-login) is unsalvageable; replace with D-003 auth (P05/P09) |
| `integrations` module | **Rewrite (small)** | Logic is ~80 lines; needs `state`, encryption, minimal scopes / GitHub App, revocation, server-side exchange (P05/P06) |
| `github` service + `sync` processor/service | **Rewrite** | Wrong data model for reviews, wrong API strategy (N+1, full pagination), swallowed errors, no incremental/webhooks. Keep BullMQ (P06) |
| `activity` module | **Rework** | Queries are fine Prisma; needs validation, correct semantics, and to be replaced by a metrics API backed by rollups (P05/P07) |
| `generate` module + impact score | **Rewrite** | Impact score must become deterministic (D-007); orchestration needs caching, quotas, typed responses (P07/P08) |
| `ai` service | **Rewrite** | Hard-coded model, regex parsing, blanket retries, `$`-template bug; replace with structured outputs + streaming (P08) |
| `prompts/*.ts` | **Keep as a starting point** | Reasonable content and structure; version them, add system prompts, evidence delimiting and citations (P08) |
| `documents` module | **Keep, extend** | Simple and correct ownership scoping; add versions, edits, exports (P11) |
| Prisma schema | **Evolve (major)** | Core entities are right; add author/reviewer modelling, sync runs, sessions, usage; migrations (P02/P03) |
| Web pages (`app/*/page.tsx`) | **Rewrite** | All client-side fetch-in-effect pages with no error/loading states, mislabeled metrics and broken flows; P04 designs + P09–P11 rebuild. Little to salvage beyond copy |
| Web components (`ui/*`, `ImpactScoreCard`, `ActivityHeatmap`) | **Replace via shadcn CLI / design system** | 5 hand-copied components; easy to regenerate on the new design system (P09) |
| `packages/shared` | **Keep, make real** | Right idea, currently dead code; becomes the Zod contract source (P02/P05) |
| Docker / compose | **Rewrite** | Every image fails; rebuild on Node 22 with proper multi-stage builds (P02, P15) |

## Effort outlook

The 15-phase plan holds; the audit changes emphasis, not order.

| Phase | Audit-driven notes | Relative size |
|---|---|---|
| P02 Foundation | Bigger than planned: 3 Docker blockers + ESM/Node 22 + README env loading + tsbuildinfo + lint/test/CI from zero. Add two cheap hotfixes: BUG-14 (resume display) and BUG-02 with BUG-01 (same file) | L |
| P03 Blueprint | Must design the reviewer/author data model (DATA-01), sync-run model, KPI methodology replacing LLM score, auth choice | M |
| P05 Backend platform | 30+ issues land here (all SEC-0x/API-0x); mostly mechanical once auth is chosen | L |
| P06 Sync engine | Effectively a rewrite; GraphQL/Search strategy is the main design risk | L |
| P07 Metrics | New deterministic engine; small existing code to replace | M |
| P08 AI layer | Rewrite of a 217-line service + prompt hardening; evals are the new work | M |
| P09–P11 Frontend | Full UI rebuild; nothing structural to preserve | XL (split as planned) |
| P14 Hardening | Fewer surprises if P02's tests/CI land properly | M |

No phase needs to be added or removed. Two P02 additions are recommended (BUG-14, BUG-02) because
they are one-line-scale fixes to flows P02 already touches.

## Opportunities and feature ideas discovered

- **Use GitHub's Search/GraphQL contribution APIs** (`author:`, `reviewed-by:`,
  `contributionsCollection`) — one query replaces thousands of REST calls and fixes the reviewed-PR
  bug at the source (P06).
- **Reviews as first-class impact.** The data shows reviews are a large share of real work; a
  "reviews given / turnaround / repos reviewed" view would be a differentiator (P07/P10).
- **Evidence-linked documents.** Every bullet/claim should link to the PRs it came from; the prompts
  already receive titles — add IDs and citations (P08/P11).
- **Repository selection & privacy controls** (choose repos, exclude personal/dotfiles repos; the
  fixture's `alice/dotfiles` shows how noise gets in) (P06/P12).
- **Achievements journal** to capture work GitHub can't see (already planned in P12).
- **"What changed since last sync" digest** — cheap once `SyncRun` exists (P12).
- **Test mode for AI** — the SDK's `ANTHROPIC_BASE_URL` + a fixture server made full-flow testing
  trivial in this audit; formalise it for E2E tests (P02/P08).

## How this audit was done

| Activity | Output |
|---|---|
| Static read of every file; architecture, ERD, 6 sequence diagrams, route map, env inventory | [`ARCHITECTURE_CURRENT.md`](ARCHITECTURE_CURRENT.md) |
| 87 API probes (≥ 3 per endpoint) + 9 cross-cutting checks | [`API_TEST_RESULTS.md`](API_TEST_RESULTS.md) |
| Playwright pass: 12 routes × 2 widths × 3 states + interaction pass + heuristic review | [`UI_TEST_RESULTS.md`](UI_TEST_RESULTS.md) |
| Real sync processor vs. simulated GitHub (correctness + 30-repo scale) | `logs/sync-repro-*.txt`, [`scripts/sync-repro.cjs`](scripts/sync-repro.cjs) |
| Spec coverage (125 items) | [`SPEC_GAP_MATRIX.md`](SPEC_GAP_MATRIX.md) |
| Master backlog (106 issues, stable IDs) + verification of the 42 preliminary findings | [`ISSUES.md`](ISSUES.md) |
| Audit helpers (fixture seeder, probes, mocks, renderers) | [`scripts/`](scripts/README.md) |
