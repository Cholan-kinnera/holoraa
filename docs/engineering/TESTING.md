# Testing & Quality — Holoraa (v2)

- **Purpose:** What must pass before a change merges, and how each kind of test is run.
- **Owner:** TODO(owner): Quality Lead
- **Status:** Draft for owner review.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** The Go checks in section 2 run today through `make check`. The web checks and the contract checks are planned for M4 and M5.

---

## 1. Rules (AGENTS.md)

- Business logic ships with tests in the same change.
- Database and contract behaviour is tested against real services, not mocks.
- A milestone is complete only when its gates pass in a clean clone. Never report a result without the real command output.
- Do not claim a check passed unless it ran.

## 2. Backend (Go), available now

| Check | Command | Where |
|---|---|---|
| Formatting | `make fmt-check` (runs `gofmt -l`) | `backend/` |
| Static analysis | `make vet` (runs `go vet ./...`) | `backend/` |
| Tests | `make test` (runs `go test -race -count=1 ./...`) | `backend/` |
| Build | `make build` | repository root |
| Everything | `make check` | repository root |

Tests use the standard `testing` package. Test files sit beside the code they test (`*_test.go`).

## 3. Backend integration (from M2)

- Tests run against a real PostgreSQL 17 instance (version confirmed under D4).
- Each test creates and drops its own database or schema. Tests never depend on existing data.
- Configuration comes from test fixtures or environment variables. No local `.env` is required.
- The unreachable-database path for readiness is tested with a DSN that points nowhere, not by stopping containers.

## 4. Migrations (from M2)

- `goose up` from an empty database succeeds.
- `goose down` followed by `goose up` succeeds, as the M2 gate requires.
- `goose status` is clean after both.

`TODO(owner): the M2 gate requires down-migrations to work in tests, while the deployment policy in DEPLOYMENT.md says production never uses down-migrations. Confirm both rules together.`

## 5. Contracts (from M4)

- The OpenAPI 3.1.1 document and the JSON Schema realtime events validate in CI.
- Regenerating clients and server code produces no diff. CI fails if it does.
- Generators and validators are pinned to exact versions after the spike (D9).

## 6. Web (from M5)

Checks run in CI and locally:
- type checking,
- linting,
- production build,
- end-to-end smoke test of the status page against a running backend.

The tooling choices (package manager, runtime validation library, linter, and end-to-end framework) are open under D5. The legacy stack used Vitest and Playwright. That is not a decision for v2.

## 7. Coverage

Coverage thresholds are proposals and are not approved:
- `internal/config` threshold (D2): proposed 90%, not approved.
- Other packages: `TODO(owner)`.

Coverage is a signal, not a goal. Tests for behaviour matter more than the percentage.

## 8. Load testing (Phase 8)

Planned before public beta. Scenarios from the legacy plan are kept as the starting point:
- Message burst: 1,000 concurrent connections sending 5 messages per second.
- Reconnection storm: 5,000 reconnects within 10 seconds after a simulated disruption.
- Targets (proposed): REST p95 under 200 ms, realtime p95 under 500 ms, no dropped connections over 30 minutes.

The tool and its version are `TODO(owner)` until verified and approved.
