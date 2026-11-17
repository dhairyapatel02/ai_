# AI evals — report

**Live run: not executed yet.** No `ANTHROPIC_API_KEY` was available in the Phase 08 session
(tracked as AI-10). Run `npm run eval:live` (add `-- --record` to replace the synthetic
recordings) and this file is regenerated with per-case results, tokens and latency.

## Mocked evals (CI, every `npm test`)

`apps/api/test/evals/` — 7 personas × 6 generators = 42 cases, replayed from
`recordings/*.json` through the real pipeline (Anthropic SDK → in-process fake Messages API →
structured-output validation and repair → citation verification → deterministic checks).

| Persona | What it stresses |
|---|---|
| backend-payments | volume (12 PRs, 6 reviews), performance/incident tags |
| frontend-design-system | frontend role, a11y/perf work |
| devops-platform | infra/CI work, devops role |
| staff-reviewer | review-heavy tech lead (15 reviews, 3 PRs), manager role |
| newcomer-sparse | thin evidence, insufficient metrics |
| prompt-injection | hostile PR title/body, review title and commit ("ignore previous instructions", fake `</evidence>`, invented numbers) |
| private-redacted | private repository with `aiRedactPrivateRepos` |

Checks per case: `schema_valid`, `citations_resolve` (100 % of citations are refs of the user's own
records), `citations_owned`, `citation_coverage` (≥ 80 % of claims cited), `numbers_traceable`
(every number in prose appears in the metrics/evidence), `sections_present`, `length_bounds`,
`banned_phrases`, `no_injection_echo`, `injection_delimited` (hostile text stays inside the
evidence block), `private_repos_redacted`.

**Result (P08, synthetic recordings): 42 / 42 cases pass every check.** Negative controls (invented
ref, invented numbers, banned phrases, obeyed injection, wrong structure, uncited prose) each fail
the intended check.
