#!/usr/bin/env bash
# VeilVPN API smoke test.
# Checks: GET /v1/health, register rate-limit behavior, public node list.
# Usage: API_BASE=https://api.veil.example bash infra/scripts/smoke-test.sh
#        (defaults to the local wrangler dev URL)

set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8787}"
FAIL=0

check() {
  local name="$1"; local expected="$2"; local code="$3"
  if [ "$code" = "$expected" ]; then
    echo "PASS  $name (HTTP $code)"
  else
    echo "FAIL  $name (expected HTTP $expected, got $code)"
    FAIL=1
  fi
}

echo "[veil] smoke test against $API_BASE"

# 1. Health
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/v1/health")"
check "GET /v1/health" "200" "$CODE"

# 2. Register with a throwaway address; must return 201 (or 409 if rerun)
EMAIL="smoke-$(date -u +%s)@example.invalid"
STATUS_FILE="$(mktemp)"
curl -s -o "$STATUS_FILE" -w '%{http_code}' \
  -X POST "$API_BASE/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-battery-99\"}" > /tmp/veil_smoke_code
CODE="$(cat /tmp/veil_smoke_code)"
if [ "$CODE" = "201" ] || [ "$CODE" = "409" ]; then
  echo "PASS  POST /v1/auth/register (HTTP $CODE)"
else
  echo "FAIL  POST /v1/auth/register (expected 201 or 409, got $CODE)"
  cat "$STATUS_FILE"; echo
  FAIL=1
fi
rm -f "$STATUS_FILE" /tmp/veil_smoke_code

# 3. Register rate-limit: hammer the endpoint with garbage and expect 429 eventually.
#    (Light touch: 40 rapid attempts; endpoint allows 5/min per IP.)
RL_HIT=0
for i in $(seq 1 40); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST "$API_BASE/v1/auth/register" \
    -H 'Content-Type: application/json' \
    -d '{"email":"x@x.invalid","password":"short"}')"
  if [ "$CODE" = "429" ]; then RL_HIT=1; break; fi
done
if [ "$RL_HIT" = "1" ]; then
  echo "PASS  POST /v1/auth/register rate-limit (429 observed)"
else
  echo "FAIL  POST /v1/auth/register rate-limit (no 429 in 40 attempts)"
  FAIL=1
fi

# 4. Public node list: must be 200 with a JSON body shaped like {nodes: [...]}
BODY="$(curl -s -w '\n%{http_code}' "$API_BASE/v1/nodes")"
CODE="$(echo "$BODY" | tail -n1)"
JSON="$(echo "$BODY" | head -n-1)"
if [ "$CODE" = "200" ] && echo "$JSON" | grep -q '"nodes"'; then
  echo "PASS  GET /v1/nodes (HTTP 200, has nodes array)"
else
  echo "FAIL  GET /v1/nodes (expected 200 with nodes array, got HTTP $CODE)"
  FAIL=1
fi

# 5. Node list must NOT leak load/capacity figures (privacy contract).
if echo "$JSON" | grep -qiE '"(load|capacity|peers)"'; then
  echo "FAIL  GET /v1/nodes leaks precise load data"
  FAIL=1
else
  echo "PASS  GET /v1/nodes exposes no load/capacity figures"
fi

if [ "$FAIL" = "0" ]; then
  echo "[veil] all smoke tests passed"
else
  echo "[veil] smoke tests FAILED"
  exit 1
fi
