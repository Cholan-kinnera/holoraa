# Holoraa

> One simple, safe place to talk, share, and hang out with the people who matter.

Holoraa is in early foundation work. **Nothing user-facing exists yet.**

## Status

| Part | State |
|---|---|
| Governance and rules | Drafted. See [AGENTS.md](AGENTS.md) and [docs/adr/](docs/adr/README.md). |
| Backend (Go) | M0 only: a version entry point. No server, no database. |
| Web app | Not started (planned at M5). |
| Database | Not started (planned at M2). |
| Contracts | Not started (planned at M4). |
| Authentication, messaging, calls, feeds | Not started. Authentication and messaging need an owner-approved design first. |

The milestones are in [docs/MILESTONE_GATES.md](docs/MILESTONE_GATES.md).

## Repository layout

```
AGENTS.md              working rules for contributors and tools
CONTRIBUTING.md        how to make a change
docs/                  product, architecture, security, engineering, runbooks, ADRs
backend/               Go module (cmd/, internal/)
Makefile               make check, make build, make clean
```

Planned: `contracts/` (OpenAPI and JSON Schema), `web/` (Next.js), `infra/compose/` (local PostgreSQL), and `backend/db/` (migrations and queries). They are added at their milestones.

## Quick start (works today)

You need Go 1.27.3. Install it outside the repository. Then, from a clean clone:

```bash
make check GO=/path/to/go1.27.3/bin/go
./bin/api -version
```

`make check` runs formatting, static analysis, tests with the race detector, the build, and the version check. Expected: each step exits 0, and the last line is the version string.

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
