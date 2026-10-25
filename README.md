# Holoraa

> One simple, safe place to talk, share, and hang out with the people who matter.

Holoraa is in early foundation work. **Nothing user-facing exists yet.**

## Status

| Part | State |
|---|---|
| Governance and rules | Drafted. See [AGENTS.md](AGENTS.md) and [docs/adr/](docs/adr/README.md). |
| Backend (Go) | Health (`/v1/health`), readiness (`/v1/ready`, checks PostgreSQL), configuration, structured logs, and goose migrations. |
| Database | Local PostgreSQL 17 in Docker, isolated from any other project. Baseline migration only; no tables yet. |
| Contract | OpenAPI 3.1.1 in `contracts/`. Covers the two health endpoints. |
| Web app | Status page (Next.js) showing the API and database state, using the generated client. |
| Sign-in and profiles | Email code sign-in, server sessions, and profiles are in the API (M9 slice 1). Web sign-in screens and Google sign-in are not started. |
| Messaging, calls, feeds | Not started. Each needs an owner-approved design first. |

The milestones are in [docs/MILESTONE_GATES.md](docs/MILESTONE_GATES.md). The tooling choices and their verification status are in [ADR 0008](docs/adr/0008-foundation-skeleton-tooling.md) (Proposed).

## Repository layout

```
AGENTS.md              working rules for contributors and tools
CONTRIBUTING.md        how to make a change
docs/                  product, architecture, security, engineering, runbooks, ADRs
backend/               Go module: cmd/api, internal/, db/ (migrations)
contracts/             OpenAPI 3.1.1 (source of truth for the HTTP API)
web/                   Next.js + TypeScript status page
infra/compose/         local PostgreSQL 17 (development only)
scripts/               developer helpers (dev-env.sh)
Makefile               make check, check-all, db-up, migrate-up, test-db, web-check, contract-check
```

## Quick start

Full steps, prerequisites, and troubleshooting are in [docs/engineering/LOCAL_SETUP.md](docs/engineering/LOCAL_SETUP.md). The short version, from a clean clone, with Go 1.27.3 installed outside the repository and Docker running:

```bash
make dev-env                                   # creates .env with a generated password
make db-up migrate-up                          # PostgreSQL on 127.0.0.1:5433, then migrations
make check-all GO=/path/to/go1.27.3/bin/go     # Go, database tests, web, contract
```

Run the skeleton:

```bash
set -a; . ./.env; set +a; ./bin/api serve      # API on 127.0.0.1:8080 (terminal 1)
cd web && HOLORAA_API_URL=http://127.0.0.1:8080 npm run dev   # status page on 127.0.0.1:3000 (terminal 2)
```

## Documentation

- [Product vision and mission](docs/product/VISION_MISSION.md) (draft)
- [Product requirements](docs/product/PRD.md) (draft)
- [Roadmap](docs/product/ROADMAP.md) (draft)
- [Architecture](docs/architecture/ARCHITECTURE.md) (draft)
- [Security](docs/security/THREAT_MODEL.md) (draft)
- [Testing](docs/engineering/TESTING.md) (draft)
- [Runbooks](docs/runbooks/) (draft)

Most documents are drafts pending owner review. Their status is in each file's header.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md).

## Name

**Holoraa** has two a's at the end.

## License

`TODO(owner): choose a license. The legacy repository said "All Rights Reserved", and no license has been chosen for v2.`
