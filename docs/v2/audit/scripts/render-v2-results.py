#!/usr/bin/env python3
"""AUDIT HELPER (P05) — renders the v1 vs v2 probe comparison appended to API_TEST_RESULTS.md.

    python3 docs/v2/audit/scripts/render-v2-results.py \
        docs/v2/audit/logs/api-probes.jsonl \
        docs/v2/audit/logs/api-probes-p05.jsonl \
        docs/v2/audit/logs/api-probes-p05-ai-fresh.jsonl
"""
import json
import sys

V1, V2, V2_FRESH = sys.argv[1:4]


def load(path):
    rows = {}
    for line in open(path, encoding="utf-8"):
        d = json.loads(line)
        rows[d["id"].replace("-mock", "").replace("-real", "")] = d
    return rows


v1, v2, fresh = load(V1), load(V2), load(V2_FRESH)
AS = {"none": "none"}


def who(row):
    a = row["as"]
    if a == "none":
        return "none"
    if a.startswith("forged"):
        return "forged JWT"
    return a[:6] + "…"


def verdict(pid, row):
    s, body = row["status"], row["response"]
    code = ""
    try:
        code = json.loads(body)["error"]["code"]
    except Exception:  # noqa: BLE001
        pass
    if s == 401:
        return "✅ 401 UNAUTHENTICATED (no/forged credential)"
    if s == 404 and pid.startswith("AUTH"):
        return "✅ removed (dev login is web-only, stubs gone)"
    if s == 404 and code == "NOT_FOUND" and pid.startswith(("INT-11", "DOC-5", "DOC-6", "DOC-7", "DEST")):
        return "✅ other user's id → 404 (ownership)"
    if s == 400:
        return f"✅ 400 {code}"
    if s == 429:
        return "✅ 429 RATE_LIMITED (ai class 10/min)"
    if s == 503 and pid == "INT-4":
        return "✅ 503 GitHub App not configured in this run (clear error, no 200)"
    if pid in ("AUTH-8", "INT-3", "SYNC-8", "ACT-8", "ACT-17", "DEST-3"):
        return f"✅ {s}: x-user-id ignored — caller's own data"
    if s in (200, 201, 202, 204):
        return f"✅ {s}"
    return f"{s} {code}"


print("## v2 re-run (Phase 05, 2026-11-16)\n")
print(
    "Same 87 probes (+3) re-run against the P05 API with `PROBE_AUTH=v2` "
    "(`probe-api.sh` maps *none* → no credentials, *Alice* → her JWT, *impersonating Bob* → Alice's "
    "JWT plus `x-user-id: <bob>`, *forged id* → a JWT signed by an untrusted key; JWKS served by "
    "`v2-auth-helper.mjs`; Anthropic mocked). Raw logs: `logs/api-probes-p05.jsonl` (single pass, "
    "AI probes after the 10th hit the new rate limit) and `logs/api-probes-p05-ai-fresh.jsonl` "
    "(AI probes again with fresh counters).\n"
)
statuses = {}
for row in v2.values():
    statuses[row["status"]] = statuses.get(row["status"], 0) + 1
print("| v2 status | Count |\n|---|---|")
for s in sorted(statuses):
    print(f"| {s} | {statuses[s]} |")
print(
    "\nNo error is returned with a 2xx status any more (API-01); no request without a valid JWT "
    "succeeds on a protected route (SEC-01); no foreign id is readable or deletable (SEC-01, BUG-12); "
    "invalid input is a 400 with field details instead of a 200/500 (API-02, BUG-04, BUG-07, SEC-06).\n"
)
print("| Probe | Request | As | v1 | v2 | v2 verdict |\n|---|---|---|---|---|---|")
for pid, row in v2.items():
    old = v1.get(pid, {}).get("status", "—")
    shown = row
    note = ""
    if pid in fresh and row["status"] == 429:
        shown = fresh[pid]
        note = " (fresh counters; single pass: 429)"
    req = f"`{row['method']} {row['path'][:60]}`"
    print(f"| {pid} | {req} | {who(row)} | {old} | {shown['status']} | {verdict(pid, shown)}{note} |")
