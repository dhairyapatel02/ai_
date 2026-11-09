#!/usr/bin/env python3
"""AUDIT HELPER — renders logs/api-probes.jsonl into API_TEST_RESULTS.md tables (verdicts below)."""
import json, sys, html
V = {  # probe id -> (verdict, issue ids / note)
 'AUTH-1': ('❌', 'SEC-02 — public, creates/returns shared "Dev User"; 201 status'),
 'AUTH-2': ('❌', 'SEC-02 — returns Alice\'s full account given only her email (takeover)'),
 'AUTH-3': ('❌', 'SEC-02, API-02 — invalid email accepted, new account created'),
 'AUTH-4': ('⚠️', 'API-02 — non-JSON body ignored, falls back to default user'),
 'AUTH-5': ('⚠️', 'API-01 — "Not authenticated" with HTTP 200'),
 'AUTH-6': ('✅', 'Returns profile + integration list (no tokens)'),
 'AUTH-7': ('⚠️', 'API-01 — 200 "User not found"'),
 'AUTH-8': ('❌', 'SEC-01 — impersonation: Bob\'s profile returned by setting a header'),
 'AUTH-9': ('❌', 'API-03 — stub returns success'), 'AUTH-10': ('❌', 'API-03 — stub, no body still success'),
 'AUTH-11': ('❌', 'API-03 — stub'), 'AUTH-12': ('❌', 'API-03 — stub, no body'),
 'AUTH-13': ('❌', 'API-03 — forged header ignored, success'), 'AUTH-14': ('❌', 'API-02/03 — invalid body type accepted'),
 'INT-1': ('✅', 'Lists provider + metadata, token not exposed'),
 'INT-2': ('⚠️', 'API-01 — 200 for unauthenticated'),
 'INT-3': ('❌', 'SEC-01 — Bob\'s integrations via header'),
 'INT-4': ('❌', 'SEC-04, SEC-05 — OAuth URL without `state`, scope `repo`'),
 'INT-5': ('⚠️', 'API-01 — 201 for unauthenticated'),
 'INT-6': ('❌', 'SEC-01 — any non-empty header accepted (no user lookup)'),
 'INT-7': ('⚠️', 'API-01 — validation error with 201'),
 'INT-8': ('⚠️', 'API-01 — upstream failure with 201 (real call to github.com)'),
 'INT-9': ('⚠️', 'API-01 — 201 for unauthenticated'),
 'INT-10': ('⚠️', 'API-02 — numeric code not rejected, forwarded to GitHub'),
 'INT-11': ('✅', 'Ownership enforced (Alice cannot delete Bob\'s) — but status 200'),
 'INT-12': ('⚠️', 'API-01 — 200 "not found"'), 'INT-13': ('⚠️', 'API-01 — 200 for unauthenticated'),
 'SYNC-1': ('⚠️', 'Queued; job later fails (fake token) — see SYNC-5'),
 'SYNC-2': ('❌', 'DATA-06 — second concurrent job queued, no de-duplication'),
 'SYNC-3': ('⚠️', 'API-01 — 201 for unauthenticated'),
 'SYNC-4': ('⚠️', 'API-01 — 201 with error'),
 'SYNC-5': ('❌', 'BUG-08 — failed job\'s finish time reported as `lastSync`'),
 'SYNC-6': ('⚠️', 'API-01'), 'SYNC-7': ('⚠️', 'SEC-01 — forged id gets "idle" instead of 401'),
 'SYNC-8': ('❌', 'SEC-01 — Bob\'s sync status via header'),
 'ACT-1': ('✅', 'Paginated commits (default 20)'),
 'ACT-2': ('❌', 'SEC-06 — returned all 292 rows'),
 'ACT-3': ('⚠️', 'API-01 — validation error with 200'),
 'ACT-4': ('❌', 'BUG-04 — page=0 → negative skip → 500'),
 'ACT-5': ('❌', 'SEC-06 — negative limit accepted (returns oldest rows)'),
 'ACT-6': ('❌', 'BUG-04 — invalid date → 500'),
 'ACT-7': ('⚠️', 'API-01'), 'ACT-8': ('❌', 'SEC-01 — Bob\'s commits via header'),
 'ACT-9': ('⚠️', 'BUG-05 — see date-range check below (same-day range returns 0)'),
 'ACT-10': ('❌', 'DATA-01 — first page is all stub rows "PR #50xx" (reviewed PRs)'),
 'ACT-11': ('❌', 'SEC-06 — unbounded'), 'ACT-12': ('❌', 'BUG-04 — 500'), 'ACT-13': ('⚠️', 'API-01'),
 'ACT-14': ('❌', 'DATA-01 — totalPRs 106 (41 authored + 65 stubs)'),
 'ACT-15': ('❌', 'BUG-04 — 500'), 'ACT-16': ('⚠️', 'API-01'), 'ACT-17': ('❌', 'SEC-01 — Bob\'s summary'),
 'DOC-1': ('✅', 'Own documents listed'), 'DOC-2': ('❌', 'SEC-06 — unbounded'), 'DOC-3': ('⚠️', 'API-01'),
 'DOC-4': ('✅', 'Own document'), 'DOC-5': ('✅', 'Ownership enforced — but 200 "not found"'),
 'DOC-6': ('❌', 'SEC-01 — Bob\'s document via header'),
 'DOC-7': ('✅', 'Ownership enforced — but 200'), 'DOC-8': ('⚠️', 'API-01, BUG-12'), 'DOC-9': ('⚠️', 'API-01'),
 'DOC-10': ('⚠️', 'API-01'),
 'GEN-1': ('⚠️', 'Cached LLM score returned (AI-01: score itself is LLM-generated)'),
 'GEN-2': ('❌', 'BUG-04, SEC-12 — Prisma error text + server file path leaked'),
 'GEN-3': ('⚠️', 'API-01 — 200 with error'), 'GEN-4': ('⚠️', 'API-01'),
 'GEN-5': ('⚠️', 'API-01 — 201 for unauthenticated'), 'GEN-6': ('⚠️', 'API-01'), 'GEN-7': ('⚠️', 'API-01'),
 'GEN-8': ('❌', 'BUG-07, SEC-12 — TypeError message returned with 201'),
 'GEN-R1-mock': ('❌', 'BUG-14 — response nests `bullets.bullets` (page renders an empty card); prompt mislabels total PRs as "merged" (AI-07); new document row every call (AI-03)'),
 'GEN-R2-mock': ('⚠️', 'Works; same caveats'), 'GEN-R3-mock': ('⚠️', 'Works; stub "PR #n" titles fed as Notable Work (AI-07)'),
 'GEN-R4-mock': ('❌', 'AI-01, API-04 — GET triggers LLM call and stores a score for a month with 0 activity'),
 'GEN-R5-mock': ('❌', 'BUG-07 — invalid period/month/year accepted, paid call made'),
 'GEN-R6-mock': ('❌', 'BUG-07 — prompt says "Current Role: undefined"'),
 'GEN-R7-mock': ('❌', 'SEC-07 — 100 KB role → 203,078-char prompt accepted'),
 'GEN-R8-mock': ('❌', 'AI-05 — prompt became "Role: backend {{role}} lead"'),
 'GEN-R9-mock': ('❌', 'AI-05 — `$`` spliced the prompt prefix into the role'),
 'GEN-R10-mock': ('❌', 'AI-04, SEC-12 — non-retryable 400 retried 3× (3.0 s), raw error returned'),
 'GEN-R11-mock': ('❌', 'AI-03 — greedy regex over prose with two JSON objects → parse error, 3 billed calls'),
 'GEN-R12-mock': ('❌', 'SEC-01 — LLM spend and DB write on Bob\'s account via header'),
 'MISC-1': ('⚠️', 'Nest default 404 shape (not the envelope)'),
 'MISC-2': ('✅', 'Preflight OK; CORS origin is a fixed allow-list (see cross-cutting checks)'),
 'DEST-1': ('❌', 'SEC-01 — Bob\'s document deleted by setting a header'),
 'DEST-2': ('❌', 'SEC-01, DATA-07 — Bob\'s integration deleted; cascade wipes his activity'),
 'DEST-3': ('❌', 'DATA-07 — Bob now has 0 commits / 0 PRs'),
}
GROUPS = [('Auth', 'AUTH-'), ('Integrations', 'INT-'), ('Sync', 'SYNC-'), ('Activity', 'ACT-'), ('Documents', 'DOC-'),
          ('Generation — validation & auth', 'GEN-'), ('Generation — happy path & abuse (mock Anthropic)', 'GEN-R'),
          ('Cross-cutting', 'MISC-'), ('Destructive impersonation (run last)', 'DEST-')]
rows = [json.loads(l) for l in open(sys.argv[1])]
seen = {}
for r in rows: seen[r['id']] = r  # last run wins
def cell(s, n=150):
    s = s.replace('\n', ' ').replace('|', '\\|')
    return (s[:n] + '…') if len(s) > n else s
out = []
for title, pre in GROUPS:
    items = [r for k, r in seen.items() if k.startswith(pre) and not (pre == 'GEN-' and k.startswith('GEN-R'))]
    if not items: continue
    out.append(f'\n### {title}\n\n| Probe | Request | As | Status | ms | Response (truncated) | Verdict |\n|---|---|---|---|---|---|---|')
    for r in items:
        v, note = V.get(r['id'], ('?', ''))
        body = f" body `{cell(r['body'], 60)}`" if r['body'] else ''
        out.append(f"| {r['id']} | `{r['method']} {cell(r['path'], 70)}`{body}<br>{cell(r['desc'], 90)} | {r['as'][:14]} | {r['status']} | {r['ms']} | `{cell(r['response'])}` | {v} {note} |")
print('\n'.join(out))
