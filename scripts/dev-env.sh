#!/usr/bin/env bash
# Create the local .env for development, once per developer.
#
# - Copies .env.example to .env if .env does not exist.
# - Generates a fresh database password and auth secret. Neither is printed.
# - Fills HOLORAA_DATABASE_URL from that password and the configured port.
# - If .env already exists, adds only the local-development settings it lacks
#   (HOLORAA_AUTH_SECRET, HOLORAA_ENV=development, HOLORAA_COOKIE_SECURE=false).
#   Existing values are never changed. Production does not use this script.
#
# Re-running is safe.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

command -v openssl >/dev/null 2>&1 || { echo "openssl is required to generate development secrets" >&2; exit 1; }

# set_missing adds KEY=VALUE to an existing .env when KEY is absent. With mode
# "empty", a KEY that is present but has no value is filled in place instead.
# Existing non-empty values are never changed. Values are written to the file
# only, never printed.
set_missing() {
  local key="$1" value="$2" mode="${3:-absent}" tmp
  if grep -q "^${key}=." .env; then
    return 0
  fi
  umask 077
  tmp="$(mktemp .env.tmp.XXXXXX)"
  trap 'rm -f "$tmp"' EXIT
  if [ "$mode" = "empty" ] && grep -q "^${key}=" .env; then
    while IFS= read -r line; do
      case "$line" in
        "${key}="*) printf '%s=%s\n' "$key" "$value" ;;
        *)          printf '%s\n' "$line" ;;
      esac
    done < .env > "$tmp"
  else
    cat .env > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" .env
  trap - EXIT
  echo "Added ${key} to .env (value not shown)."
}

# fill_missing_defaults adds the local-development settings an existing .env
# may lack. These are not secrets, except the generated auth secret, which is
# never printed. Production never runs this script.
fill_missing_defaults() {
  set_missing HOLORAA_AUTH_SECRET "$(openssl rand -hex 32)" empty
  set_missing HOLORAA_ENV development
  set_missing HOLORAA_COOKIE_SECURE false
}

if [ -e .env ]; then
  fill_missing_defaults
  echo ".env already exists; existing values left unchanged."
  exit 0
fi

password="$(openssl rand -hex 24)"
auth_secret="$(openssl rand -hex 32)"
# The port comes from .env.example, the single place where it is configured.
port="$(sed -n 's/^HOLORAA_DEV_DB_PORT=//p' .env.example)"
case "$port" in
  ''|*[!0-9]*) echo "HOLORAA_DEV_DB_PORT in .env.example must be a number" >&2; exit 1 ;;
esac

umask 077
tmp="$(mktemp .env.tmp.XXXXXX)"
trap 'rm -f "$tmp"' EXIT

while IFS= read -r line; do
  case "$line" in
    HOLORAA_DEV_DB_PASSWORD=*) printf 'HOLORAA_DEV_DB_PASSWORD=%s\n' "$password" ;;
    HOLORAA_DATABASE_URL=*)    printf 'HOLORAA_DATABASE_URL=postgres://holoraa:%s@127.0.0.1:%s/holoraa_dev?sslmode=disable\n' "$password" "$port" ;;
    HOLORAA_AUTH_SECRET=*)     printf 'HOLORAA_AUTH_SECRET=%s\n' "$auth_secret" ;;
    HOLORAA_ENV=*)             printf 'HOLORAA_ENV=development\n' ;;
    *)                         printf '%s\n' "$line" ;;
  esac
done < .env.example > "$tmp"

mv "$tmp" .env
trap - EXIT
echo "Created .env with generated development secrets (values not shown)."
