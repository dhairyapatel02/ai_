#!/usr/bin/env bash
# AUDIT HELPER — black-box probes of every v0.1.0 API endpoint.
#
# Prereqs: API on $API (default http://localhost:4000/api), DB seeded with
#   node docs/v2/audit/scripts/seed-fixture.ts   (prints the IDs used below)
#
# Usage:
#   docs/v2/audit/scripts/probe-api.sh <aliceId> <bobId> <bobIntegrationId> <aliceDocId> <bobDocId> [out.jsonl] [phase]
# phase: "all" (default) | "gen-real" (only generation probes) | "destructive" (impersonation deletes)
#
# Each probe appends one JSON line {id,desc,method,path,as,body,status,ms,response} to out.jsonl.
set -u
API=${API:-http://localhost:4000/api}
A=$1; B=$2; INT_B=$3; DOC_A=$4; DOC_B=$5
OUT=${6:-docs/v2/audit/logs/api-probes.jsonl}
PHASE=${7:-all}   # all | gen-real | gen-mock | destructive | auth-extra
FORGED=forged-user-id-does-not-exist

probe() { # id desc method path as(user id or "none") [body] [content-type]
  local id=$1 desc=$2 method=$3 path=$4 as=$5 body=${6:-} ctype=${7:-application/json}
  local hdr=() ; [ "$as" != "none" ] && hdr=(-H "x-user-id: $as")
  local data=() ; [ -n "$body" ] && data=(--data-binary "$body" -H "content-type: $ctype")
  local tmp; tmp=$(mktemp)
  local meta; meta=$(curl -s -o "$tmp" -w '%{http_code} %{time_total}' -X "$method" "${hdr[@]}" "${data[@]}" "$API$path")
  local status=${meta%% *} secs=${meta##* }
  python3 - "$id" "$desc" "$method" "$path" "$as" "$body" "$status" "$secs" "$tmp" >> "$OUT" <<'PY'
import json,sys
i,d,m,p,a,b,s,t,f=sys.argv[1:]
r=open(f,encoding='utf-8',errors='replace').read()
print(json.dumps({"id":i,"desc":d,"method":m,"path":p,"as":a,"body":b[:300],"status":int(s),"ms":round(float(t)*1000),"response":r[:600],"response_len":len(r)}))
PY
  printf '%-5s %-4s %-6s %-60s -> %s (%sms) %s\n' "$id" "$status" "$method" "$path" "$status" "$(python3 -c "print(round($secs*1000))")" "$(head -c 140 "$tmp")"
  rm -f "$tmp"
}

who() { case $1 in "$A") echo alice;; "$B") echo bob;; none) echo none;; *) echo "$1";; esac; }

TODAY=$(date -u +%F)
SIXAGO=$(date -u -d '6 months ago' +%F)
MONTH=$(date -u +%-m); YEAR=$(date -u +%Y)

if [ "$PHASE" = "all" ]; then
# ---------------- auth ----------------
probe AUTH-1 "dev-login, empty body (what the web app calls)" POST /auth/dev-login none '{}'
probe AUTH-2 "dev-login with a victim's email -> account takeover" POST /auth/dev-login none '{"email":"alice@audit.local"}'
probe AUTH-3 "dev-login with invalid email / empty name" POST /auth/dev-login none '{"email":"not-an-email","name":""}'
probe AUTH-4 "dev-login with non-JSON body" POST /auth/dev-login none 'garbage' 'text/plain'
probe AUTH-5 "me without header" GET /auth/me none
probe AUTH-6 "me as alice" GET /auth/me "$A"
probe AUTH-7 "me with forged id" GET /auth/me "$FORGED"
probe AUTH-8 "me impersonating bob (just set header)" GET /auth/me "$B"
probe AUTH-9 "auth/github stub, empty body" POST /auth/github none '{}'
probe AUTH-10 "auth/github stub, no body" POST /auth/github none
probe AUTH-11 "auth/google stub" POST /auth/google none '{"code":"x"}'
probe AUTH-12 "auth/google stub, no body" POST /auth/google none
probe AUTH-13 "auth/google stub with forged x-user-id" POST /auth/google "$FORGED" '{"code":1}'
probe AUTH-14 "auth/github stub with forged x-user-id + invalid code type" POST /auth/github "$FORGED" '{"code":["a"]}'
# ---------------- integrations ----------------
probe INT-1 "list as alice" GET /integrations "$A"
probe INT-2 "list without header" GET /integrations none
probe INT-3 "list impersonating bob" GET /integrations "$B"
probe INT-4 "github/connect as alice (inspect OAuth URL: state?)" POST /integrations/github/connect "$A"
probe INT-5 "github/connect without header" POST /integrations/github/connect none
probe INT-6 "github/connect with forged id (no user check)" POST /integrations/github/connect "$FORGED"
probe INT-7 "github/callback missing code" POST /integrations/github/callback "$A" '{}'
probe INT-8 "github/callback bogus code (hits github.com)" POST /integrations/github/callback "$A" '{"code":"bogus"}'
probe INT-9 "github/callback without header" POST /integrations/github/callback none '{"code":"bogus"}'
probe INT-10 "github/callback code as number" POST /integrations/github/callback "$A" '{"code":12345}'
probe INT-11 "delete bob's integration as alice" DELETE "/integrations/$INT_B" "$A"
probe INT-12 "delete nonexistent integration" DELETE /integrations/nope "$A"
probe INT-13 "delete without header" DELETE "/integrations/$INT_B" none
# ---------------- sync ----------------
probe SYNC-1 "trigger as alice (fake token -> job will fail in worker)" POST /sync/trigger "$A"
probe SYNC-2 "trigger again immediately (dedupe?)" POST /sync/trigger "$A"
probe SYNC-3 "trigger without header" POST /sync/trigger none
probe SYNC-4 "trigger with forged id" POST /sync/trigger "$FORGED"
sleep 3
probe SYNC-5 "status as alice after failed jobs" GET /sync/status "$A"
probe SYNC-6 "status without header" GET /sync/status none
probe SYNC-7 "status as forged id" GET /sync/status "$FORGED"
probe SYNC-8 "status impersonating bob" GET /sync/status "$B"
# ---------------- activity ----------------
probe ACT-1 "commits as alice (default page)" GET /activity/commits "$A"
probe ACT-2 "commits limit=100000 (unbounded)" GET "/activity/commits?limit=100000" "$A"
probe ACT-3 "commits limit=abc" GET "/activity/commits?limit=abc" "$A"
probe ACT-4 "commits page=0" GET "/activity/commits?page=0" "$A"
probe ACT-5 "commits limit=-5" GET "/activity/commits?limit=-5" "$A"
probe ACT-6 "commits from=garbage" GET "/activity/commits?from=garbage" "$A"
probe ACT-7 "commits without header" GET /activity/commits none
probe ACT-8 "commits impersonating bob" GET "/activity/commits?limit=2" "$B"
probe ACT-9 "commits to=today (date-only => midnight UTC, today excluded)" GET "/activity/commits?from=$TODAY&to=$TODAY&limit=1" "$A"
probe ACT-10 "prs as alice (stub PR rows visible?)" GET "/activity/prs?limit=5" "$A"
probe ACT-11 "prs limit=100000" GET "/activity/prs?limit=100000" "$A"
probe ACT-12 "prs from=garbage" GET "/activity/prs?from=garbage" "$A"
probe ACT-13 "prs without header" GET /activity/prs none
probe ACT-14 "summary as alice, last 6 months" GET "/activity/summary?from=$SIXAGO&to=$TODAY" "$A"
probe ACT-15 "summary from=garbage" GET "/activity/summary?from=garbage" "$A"
probe ACT-16 "summary without header" GET /activity/summary none
probe ACT-17 "summary impersonating bob" GET /activity/summary "$B"
# ---------------- documents ----------------
probe DOC-1 "list as alice" GET /documents "$A"
probe DOC-2 "list limit=100000" GET "/documents?limit=100000" "$A"
probe DOC-3 "list without header" GET /documents none
probe DOC-4 "get own doc" GET "/documents/$DOC_A" "$A"
probe DOC-5 "get bob's doc as alice (ownership check)" GET "/documents/$DOC_B" "$A"
probe DOC-6 "get bob's doc impersonating bob" GET "/documents/$DOC_B" "$B"
probe DOC-7 "delete bob's doc as alice" DELETE "/documents/$DOC_B" "$A"
probe DOC-8 "delete nonexistent doc" DELETE /documents/nope "$A"
probe DOC-9 "delete without header" DELETE "/documents/$DOC_B" none
probe DOC-10 "list page=abc" GET "/documents?page=abc" "$A"
# ---------------- generate: cheap/validation probes ----------------
probe GEN-1 "impact-score current month (cached)" GET "/generate/impact-score?month=$MONTH&year=$YEAR" "$A"
probe GEN-2 "impact-score month=abc" GET "/generate/impact-score?month=abc&year=$YEAR" "$A"
probe GEN-3 "impact-score missing params" GET /generate/impact-score "$A"
probe GEN-4 "impact-score without header" GET "/generate/impact-score?month=1&year=2026" none
probe GEN-5 "resume without header" POST /generate/resume none '{"dateRange":{"from":"2026-01-01","to":"2026-06-30"},"role":"backend"}'
probe GEN-6 "appraisal without header" POST /generate/appraisal none '{"period":"monthly","month":1,"year":2026}'
probe GEN-7 "promotion without header" POST /generate/promotion none '{"currentRole":"a","targetRole":"b"}'
probe GEN-8 "resume empty body" POST /generate/resume "$A" '{}'
# ---------------- misc / cross-cutting ----------------
probe MISC-1 "unknown route" GET /does-not-exist none
probe MISC-2 "CORS preflight from evil origin" OPTIONS /activity/commits none
fi

if [ "$PHASE" = "auth-extra" ]; then
probe AUTH-12 "auth/google stub, no body" POST /auth/google none
probe AUTH-13 "auth/google stub with forged x-user-id" POST /auth/google "$FORGED" '{"code":1}'
probe AUTH-14 "auth/github stub with forged x-user-id + invalid code type" POST /auth/github "$FORGED" '{"code":["a"]}'
fi

if [ "$PHASE" = "gen-real" ] || [ "$PHASE" = "gen-mock" ]; then
  P=${PHASE#gen-}
  probe GEN-R1-$P "resume valid" POST /generate/resume "$A" "{\"dateRange\":{\"from\":\"$SIXAGO\",\"to\":\"$TODAY\"},\"role\":\"backend\"}"
  probe GEN-R2-$P "appraisal valid (quarterly)" POST /generate/appraisal "$A" "{\"period\":\"quarterly\",\"month\":$MONTH,\"year\":$YEAR}"
  probe GEN-R3-$P "promotion valid" POST /generate/promotion "$A" '{"currentRole":"Senior Engineer","targetRole":"Staff Engineer"}'
  probe GEN-R4-$P "impact-score uncached empty month (Jan 2020) -> LLM call" GET "/generate/impact-score?month=1&year=2020" "$A"
  probe GEN-R5-$P "appraisal invalid period/month/year accepted?" POST /generate/appraisal "$A" '{"period":"weird","month":13,"year":1900}'
  probe GEN-R6-$P "promotion empty body -> 'undefined' roles in prompt" POST /generate/promotion "$A" '{}'
  probe GEN-R7-$P "resume role=100KB string (no length limit)" POST /generate/resume "$A" "{\"dateRange\":{\"from\":\"$SIXAGO\",\"to\":\"$TODAY\"},\"role\":\"$(head -c 100000 /dev/zero | tr '\0' 'x')\"}"
  probe GEN-R8-$P "resume role containing \$& (String.replace pattern)" POST /generate/resume "$A" "{\"dateRange\":{\"from\":\"$SIXAGO\",\"to\":\"$TODAY\"},\"role\":\"backend \$& lead\"}"
  probe GEN-R9-$P "promotion targetRole contains \$\` (prompt corruption)" POST /generate/promotion "$A" '{"currentRole":"Senior $` Engineer","targetRole":"Staff"}'
  probe GEN-R10-$P "resume role FORCE_400 -> retried non-retryable 400?" POST /generate/resume "$A" "{\"dateRange\":{\"from\":\"$SIXAGO\",\"to\":\"$TODAY\"},\"role\":\"FORCE_400\"}"
  probe GEN-R11-$P "resume role FORCE_PROSE -> greedy regex over 2 JSON objects" POST /generate/resume "$A" "{\"dateRange\":{\"from\":\"$SIXAGO\",\"to\":\"$TODAY\"},\"role\":\"FORCE_PROSE\"}"
  probe GEN-R12-$P "impact-score impersonating bob (spends quota on bob's behalf)" GET "/generate/impact-score?month=2&year=2020" "$B"
fi

if [ "$PHASE" = "destructive" ]; then
  probe DEST-1 "delete bob's document impersonating bob" DELETE "/documents/$DOC_B" "$B"
  probe DEST-2 "disconnect bob's integration impersonating bob (cascade-deletes activity)" DELETE "/integrations/$INT_B" "$B"
  probe DEST-3 "bob's commits after disconnect" GET "/activity/summary" "$B"
fi
