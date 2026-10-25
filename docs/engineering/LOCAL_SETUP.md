# Local setup — Holoraa (v2)

- **Purpose:** Set up and run the foundation skeleton on a development machine, from a clean clone.
- **Owner:** TODO(owner): Platform Lead
- **Status:** Draft. The steps below were run end to end in the staging repository. See "Verification record" at the end.
- **Last Updated:** 2026-10-25

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Go | 1.27.3 | Install outside the repository. Pass its path as `GO=` if it is not on PATH. |
| Node.js | 24 LTS (target) | `.nvmrc` and `engines` say 24. The recorded runs used Node 26.11.1. See ADR 0008. |
| npm | ships with Node | Used for the web app. No pnpm needed. |
| Docker with Compose v2 | Compose 2.x or later | Runs the local PostgreSQL 17 container. |
| openssl | any recent | Generates the local database password. |

## 2. Clean clone, step by step

From an empty directory:

```bash
git clone <repository-url> holoraa
cd holoraa
git switch <branch>               # the branch to test

# 1. Create your local .env. This generates a fresh database password.
#    The password is never printed and never committed.
make dev-env

# 2. Start the local PostgreSQL container (holoraa-v2-postgres, port 5433).
make db-up

# 3. Apply migrations.
make migrate-up

# 4. Run the Go gate (format, vet, tests with race detector, build).
make check GO=/path/to/go1.27.3/bin/go

# 5. Run the database-backed Go tests.
make test-db GO=/path/to/go1.27.3/bin/go

# 6. Run the web and contract checks (npm ci from the lockfile).
make web-check contract-check GO=/path/to/go1.27.3/bin/go
```

Or run everything in one command:

```bash
make check-all GO=/path/to/go1.27.3/bin/go
```

## 3. Run the skeleton

Start the API (terminal 1):

```bash
set -a; . ./.env; set +a
./bin/api serve
```

`bin/api` exists after `make build`. The API listens on `127.0.0.1:8080`.

Start the status page (terminal 2):

```bash
cd web
HOLORAA_API_URL=http://127.0.0.1:8080 npm run dev
```

Open `http://127.0.0.1:3000`. The page shows the API and database state. For a production-style run, use `npm run build` and then `npm run start` with the same variable.

## 4. Check it works

```bash
curl -s http://127.0.0.1:8080/v1/health        # {"status":"ok"}
curl -s http://127.0.0.1:8080/v1/ready         # {"status":"ready","database":"ok"}
```

With the database container stopped (`docker stop holoraa-v2-postgres`), `/v1/ready` returns 503 with Problem Details, and `/v1/health` still returns 200.

## 5. Isolation

| Item | v2 value | Legacy value (not used) |
|---|---|---|
| Compose project | `holoraa-v2` | `holoraa` / other |
| Container | `holoraa-v2-postgres` | `holoraa-postgres`, `holoraa-redis` |
| Volume | `holoraa_v2_postgres_data` | `holoraa_postgres_data`, `holoraa_redis_data` |
| Host port | `127.0.0.1:5433` (set `HOLORAA_DEV_DB_PORT` to change it) | `5432`, `6379` |

The database listens on loopback only.

## 6. Stopping, and what is kept

- `make db-down` stops and removes the container. It keeps the data volume. Restart later with `make db-up`.
- `docker stop holoraa-v2-postgres` stops the container and keeps everything else, including the container itself.
- The Make targets never delete a volume and never use `-v`.
- Deleting the volume erases all local data. Do this only by hand, and only to reset the development database:
  1. Confirm the name: `docker volume inspect holoraa_v2_postgres_data`.
  2. `make db-down`.
  3. `docker volume rm holoraa_v2_postgres_data`.
  4. `make db-up migrate-up` to create an empty database.
- Legacy containers (`holoraa-postgres`, `holoraa-redis`, `akesis-postgres`) and their volumes belong to other projects. Never remove them as part of v2 work.

## 7. Tests

| Command | What it runs | Needs the database |
|---|---|---|
| `make check` | Go formatting, vet, tests (race detector), build, version output | No. Database tests skip with a message. |
| `make test-db` | All Go tests, including PostgreSQL integration tests | Yes |
| `make web-check` | Web typecheck, lint, unit tests, production build | No |
| `make contract-check` | OpenAPI lint and client drift check | No |
| `make check-all` | All of the above | Yes |
| `make e2e` | Status page against the real API and database: five states and the security headers. Stops and restarts `holoraa-v2-postgres`. | Yes |

The integration tests create and drop their own scratch databases (`holoraa_test_*`). They do not touch `holoraa_dev`.

## 8. Troubleshooting

- **`make dev-env` says `.env` already exists.** That is expected. Re-running leaves the file unchanged.
- **`docker compose` fails with "Run scripts/dev-env.sh first".** Run `make dev-env`, or create `.env` from `.env.example` and set `HOLORAA_DEV_DB_PASSWORD`.
- **Port 5433 is in use.** Set `HOLORAA_DEV_DB_PORT` in `.env` to a free port, and also set `HOLORAA_DATABASE_URL` to match. The generated URL uses 5433 by default.
- **Readiness returns 503.** Check `make db-status`. The container must be `healthy`.
- **`make` cannot find Go.** Pass `GO=/path/to/go`. The Makefile refuses any other Go version.

## 9. Verification record (2026-10-25, Linux, Go 1.27.3, Node 26.11.1)

| Step | Result |
|---|---|
| `make check` | exit 0 |
| `make test-db` (with PostgreSQL 17) | exit 0, no tests skipped |
| `make migrate-up`, `migrate status` | applied the baseline migration |
| `make web-check` | exit 0: typecheck, lint, 13 unit tests, production build |
| `make contract-check` | exit 0 (3 Redocly warnings, see ADR 0008). Drift check tested. |
| Live API against the container | health 200, readiness 200, readiness 503 with the database stopped, unknown route 404, clean SIGTERM shutdown |
| Status page against the live API | five states rendered correctly (see TESTING.md, section 6) |

Not yet run: Node 24 (the declared target), and a fresh clone of the final branch. Both are listed in ADR 0008 under verification gaps.


## 4. Sign-in in development

`make dev-env` adds the local-development settings an existing `.env` lacks: `HOLORAA_AUTH_SECRET`, `HOLORAA_ENV=development`, and `HOLORAA_COOKIE_SECURE=false`. It never changes a value that is already set. Production never uses this script. The settings are:

- `HOLORAA_ENV=development`. The default is `production`, which fails closed. A missing `HOLORAA_ENV` therefore refuses to start with the fake mail provider.
- `HOLORAA_COOKIE_SECURE=false`. Browsers over plain HTTP do not keep a Secure cookie.
- `HOLORAA_MAIL_PROVIDER=fake` (the default). No email is sent. The sign-in code is written to a private file in `.local/mail/` (mode 0600, git-ignored). Read the newest file there to get the code.

Production must set `HOLORAA_ENV=production`, `HOLORAA_MAIL_PROVIDER=resend`, `HOLORAA_MAIL_FROM`, and `HOLORAA_RESEND_API_KEY`, and must leave `HOLORAA_COOKIE_SECURE` at `true`. The server refuses to start in production with the fake provider or insecure cookies, and the tests in `internal/config` and `internal/app` check this.

Database-backed auth and profile tests run under `make test-db`. They skip, and say so, when `HOLORAA_TEST_DATABASE_URL` is not set.
