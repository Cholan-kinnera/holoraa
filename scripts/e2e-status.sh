#!/usr/bin/env bash
# End-to-end check of the status page against the real API and the real
# development database. It checks five states and exits non-zero on any
# mismatch. It needs: bin/api built, web/ built (npm run build), and the
# development database created (make db-up migrate-up).
#
# Side effects, all reversible: it stops and then restarts the container
# holoraa-v2-postgres. It never touches other containers or any volume.
# Configuration values are read from .env and are never printed.
set -u

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo" || exit 1

[ -x bin/api ] || { echo "bin/api missing: run make build first" >&2; exit 2; }
[ -f web/.next/BUILD_ID ] || { echo "web build missing: run make web-check first" >&2; exit 2; }
[ -f .env ] || { echo ".env missing: run make dev-env first" >&2; exit 2; }

set -a && . ./.env && set +a

DB=holoraa-v2-postgres
WEB_PORT=3100
API_PID=""
WEB_PID=""
failures=0

cleanup() {
  [ -n "$WEB_PID" ] && kill -TERM "$WEB_PID" 2>/dev/null
  [ -n "$API_PID" ] && kill -TERM "$API_PID" 2>/dev/null
  wait 2>/dev/null
  # Leave the database running whatever happened above.
  docker start "$DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

start_api() {
  ./bin/api serve >/tmp/e2e-api.log 2>&1 &
  API_PID=$!
  curl -s -o /dev/null --retry 15 --retry-connrefused --retry-delay 1 --max-time 3 \
    "$HOLORAA_API_URL/v1/health" || { echo "API did not start" >&2; exit 1; }
}

stop_api() {
  kill -TERM "$API_PID" 2>/dev/null
  wait "$API_PID" 2>/dev/null
  API_PID=""
}

start_web() {
  # exec makes the subshell's PID the Next server, so WEB_PID is the real process.
  (cd web && HOLORAA_API_URL="$1" exec ./node_modules/.bin/next start -H 127.0.0.1 -p "$WEB_PORT" >/tmp/e2e-web.log 2>&1) &
  WEB_PID=$!
  curl -s -o /dev/null --retry 30 --retry-connrefused --retry-delay 1 --max-time 3 \
    "http://127.0.0.1:$WEB_PORT/" || { echo "web did not start" >&2; exit 1; }
}

stop_web() {
  kill -TERM "$WEB_PID" 2>/dev/null
  wait "$WEB_PID" 2>/dev/null
  WEB_PID=""
}

# Prints the two state words the page renders: API, then Database.
page_states() {
  curl -s --max-time 10 "http://127.0.0.1:$WEB_PORT/" | grep -oE 'class="state">[^<]*' | sed 's/class="state">//' | tr '\n' '|'
}

expect() {
  local label="$1" want="$2" got
  got="$(page_states)"
  if [ "$got" = "$want" ]; then
    echo "PASS $label: $got"
  else
    echo "FAIL $label: got '$got', want '$want'"
    failures=$((failures + 1))
  fi
}

wait_db() {
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$DB" 2>/dev/null)" = healthy ] && return 0
    sleep 1
  done
  echo "database did not become healthy" >&2
  exit 1
}

start_api
start_web "$HOLORAA_API_URL"

expect "A both up" "Working|Working|"
docker stop "$DB" >/dev/null
expect "B database stopped" "Working|Not reachable|"
docker start "$DB" >/dev/null
wait_db
expect "C database restored" "Working|Working|"
stop_api
expect "D API stopped" "Not reachable|Not checked|"
stop_web

start_web ""
expect "E API URL not set" "Not configured|Not checked|"
stop_web

# Security headers on the page.
start_web "$HOLORAA_API_URL"
headers="$(curl -s -D - -o /dev/null --max-time 10 "http://127.0.0.1:$WEB_PORT/")"
for h in "x-content-type-options: nosniff" "referrer-policy: no-referrer" "x-frame-options: DENY"; do
  if printf '%s' "$headers" | tr -d '\r' | grep -qi "^$h\$"; then
    echo "PASS header: $h"
  else
    echo "FAIL header missing: $h"
    failures=$((failures + 1))
  fi
done
stop_web

if [ "$failures" -eq 0 ]; then
  echo "e2e-status: all checks passed"
  exit 0
fi
echo "e2e-status: $failures check(s) failed"
exit 1
