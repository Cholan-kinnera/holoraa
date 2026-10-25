#!/usr/bin/env bash
# Create the local .env for development, once per developer.
#
# - Copies .env.example to .env if .env does not exist.
# - Generates a fresh database password and auth secret. Neither is printed.
# - Fills HOLORAA_DATABASE_URL from that password and the configured port.
# - If .env already exists, adds only what a newer template requires and the
#   file lacks (currently HOLORAA_AUTH_SECRET). Existing values are never changed.
#
# Re-running is safe.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

command -v openssl >/dev/null 2>&1 || { echo "openssl is required to generate development secrets" >&2; exit 1; }

# fill_missing_auth_secret adds HOLORAA_AUTH_SECRET to an existing .env when the
# key is absent or empty. The generated value is written to the file only.
fill_missing_auth_secret() {
  if grep -q '^HOLORAA_AUTH_SECRET=.' .env; then
    return 0
  fi
  local secret tmp
  secret="$(openssl rand -hex 32)"
  umask 077
  tmp="$(mktemp .env.tmp.XXXXXX)"
  trap 'rm -f "$tmp"' EXIT
  if grep -q '^HOLORAA_AUTH_SECRET=' .env; then
    while IFS= read -r line; do
      case "$line" in
        HOLORAA_AUTH_SECRET=*) printf 'HOLORAA_AUTH_SECRET=%s\n' "$secret" ;;
        *)                     printf '%s\n' "$line" ;;
      esac
    done < .env > "$tmp"
  else
    cat .env > "$tmp"
    printf 'HOLORAA_AUTH_SECRET=%s\n' "$secret" >> "$tmp"
  fi
  mv "$tmp" .env
  trap - EXIT
  echo "Added HOLORAA_AUTH_SECRET to .env (value not shown)."
}

if [ -e .env ]; then
  fill_missing_auth_secret
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
    *)                         printf '%s\n' "$line" ;;
  esac
done < .env.example > "$tmp"

mv "$tmp" .env
trap - EXIT
echo "Created .env with generated development secrets (values not shown)."
