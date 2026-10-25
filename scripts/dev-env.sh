#!/usr/bin/env bash
# Create the local .env for development, once per developer.
#
# - Copies .env.example to .env if .env does not exist.
# - Generates a fresh database password. The password is never printed.
# - Fills HOLORAA_DATABASE_URL from that password and the configured port.
#
# Re-running is safe: an existing .env is left unchanged.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [ -e .env ]; then
  echo ".env already exists; leaving it unchanged."
  exit 0
fi

command -v openssl >/dev/null 2>&1 || { echo "openssl is required to generate the development password" >&2; exit 1; }

password="$(openssl rand -hex 24)"
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
    *)                         printf '%s\n' "$line" ;;
  esac
done < .env.example > "$tmp"

mv "$tmp" .env
trap - EXIT
echo "Created .env with a generated development password (value not shown)."
