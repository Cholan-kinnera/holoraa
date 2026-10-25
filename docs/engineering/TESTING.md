# Testing & Quality — Holoraa (v2)

- **Purpose:** What must pass before a change merges, and how each kind of test is run.
- **Owner:** TODO(owner): Quality Lead
- **Status:** Draft for owner review.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** The Go checks, the PostgreSQL integration tests, the web checks, and the contract checks all run today. See section 9 for the full list and the commands.

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

## 3. Backend integration (implemented)

- Tests run against a real PostgreSQL 17 instance (`make test-db`, which uses the isolated development container).
- Each migration test creates and drops its own scratch database (`holoraa_test_*`).
- Configuration comes from test fixtures, not from a `.env` file.
- The unreachable-database path for readiness uses a real pool pointed at a closed port, not a stopped container.
- Tests that need PostgreSQL skip with a message when `HOLORAA_TEST_DATABASE_URL` is not set. `make test-db` sets it. CI must run `make test-db`, not `make check` alone, so the database tests cannot be skipped silently.

## 4. Migrations (implemented)

- Migrations apply from an empty database (`TestIntegrationMigrationRoundTrip`).
- `down` followed by `up` succeeds, as the M2 gate requires.
- `status` is clean after the round trip.

`TODO(owner): the M2 gate requires down-migrations to work in tests, while the deployment policy in DEPLOYMENT.md says production never uses down-migrations. Confirm both rules together.`

## 5. Contracts (implemented: lint and drift)

- `contracts/openapi.yaml` (OpenAPI 3.1.1) is linted with Redocly CLI. Errors fail the check; the three current warnings are listed in ADR 0008.
- `make contract-check` regenerates the TypeScript client into a temporary file and compares it byte for byte with the committed `web/src/lib/api/schema.ts`. A difference fails the check. Tested by changing the file and confirming a non-zero exit.
- Not yet implemented: JSON Schema for realtime events (M6), and a Go conformance test that compares handler output with the contract. Handler output is checked by Go tests and by the typed web client, not by a contract test.

## 6. Web (implemented)

- `npm run typecheck` (strict TypeScript), `npm run lint` (ESLint with the Next.js rules), `npm test` (Vitest, unit tests for the status logic and URL handling), and `npm run build` (production build).
- The status page was checked end to end against the real API and database in five states: both up, database stopped, database restored, API stopped, and `HOLORAA_API_URL` unset. See LOCAL_SETUP.md.
- No browser end-to-end framework is added yet. The choice is part of D5 and is open.

## 7. Coverage

Coverage thresholds are proposals and are not approved:
- `internal/config` threshold (D2): proposed 90%, not approved.
- Other packages: `TODO(owner)`.

Coverage is a signal, not a goal. Tests for behaviour matter more than the percentage.

## 9. Command summary

| Command | Runs | Database needed |
|---|---|---|
| `make check` | Go format, vet, race tests, build, version | No |
| `make test-db` | All Go tests with PostgreSQL integration | Yes |
| `make web-check` | Web typecheck, lint, unit tests, build | No |
| `make contract-check` | OpenAPI lint and client drift check | No |
| `make check-all` | All of the above | Yes |

## 8. Load testing (Phase 8)

Planned before public beta. Scenarios from the legacy plan are kept as the starting point:
- Message burst: 1,000 concurrent connections sending 5 messages per second.
- Reconnection storm: 5,000 reconnects within 10 seconds after a simulated disruption.
- Targets (proposed): REST p95 under 200 ms, realtime p95 under 500 ms, no dropped connections over 30 minutes.

The tool and its version are `TODO(owner)` until verified and approved.
