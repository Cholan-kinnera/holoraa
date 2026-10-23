# Milestone gates (DRAFT for owner review)

- **Status:** Approved with conditions (decision D1, 2026-10-23). The conditions are in "D1 approval conditions" below. D2 to D10 remain open. Approval is binding only as recorded here (ADR 0007, "Milestone gates"; `AGENTS.md`, "Scope boundaries"). Decision marker: `TODO(owner D1)`, resolved.
- **Scope of this file:** gates for M0 to M8 only. It does not start any milestone.
- **ADR 0007 acceptance is separate.** Approval of this document (D1) is not acceptance of ADR 0007. Acceptance is decision D10, which is required before M8 and is not a precondition for M0.

## D1 approval conditions

1. **D9 covers both validators.** The M4 decision D9 covers the OpenAPI 3.1.1 validator and the JSON Schema validator. Both must have compatibility verified, exact versions pinned, and their choices recorded in an ADR before M4 passes. This is recorded in the D9 row and in M4.
2. **Clean-clone prerequisites are milestone-specific.** Each milestone lists its own prerequisites. A gate must be reproducible from a clean clone plus those documented prerequisites, with no undocumented local state. The blanket prohibition on `.env` and ignored files is removed. Where a milestone legitimately needs local configuration or generated state, it names that input and how it is produced. This is recorded in the Conventions and in each milestone's "Prerequisites" line.

D1 approval unblocks the start of M0 only after both conditions are recorded in this document. Both are recorded in this revision. M0 has not started, and it requires a separate owner go-ahead.

## Conventions (apply to every milestone)

- A gate passes only when its command exits 0 (or its stated condition holds) in a **clean clone** of the milestone branch, reproducible from that clone plus the milestone's documented prerequisites, with no undocumented local state.
- Each milestone's "Prerequisites" line names any local configuration or generated state it needs and how it is produced. Ignored files and local `.env` files are not forbidden in general; they are allowed only where a milestone names them.
- Record the real command output. A gate is never marked passed by assertion.
- Versions named as "candidate" are not pinned. Each is verified, approved, and recorded at its milestone before it appears in any configuration.
- Every open owner decision is listed in the "Open owner decisions" table (D1 to D10) and carries an inline marker of the form `TODO(owner D#)`.
- Each decision has a "Must resolve before" milestone. A decision may stay open until that milestone. Only D1 must be resolved before M0 starts. No other decision blocks M0.

## M0: Repository skeleton

**Scope (only):** Go module under `backend/`, version entry point, its tests, a Makefile with `check`, `build`, and `clean` targets, and a freshly written `.gitignore`. No router, database, web app, contracts, or documentation changes.

**Toolchain:** Go 1.27.3. Official SHA-256 confirmed from two official sources. Locally extracted under `~/toolchains/go1.27.3` (outside the repository). The `backend/go.mod` pin is made only after this approval.

**Prerequisites:** the Go 1.27.3 toolchain available as above. No `.env` and no other local state are inputs; all gates run from a clean clone of `feat/v2-m0`.

| Gate | Command or condition | Pass condition |
|---|---|---|
| G0.1 | `gofmt -l .` in `backend/` | No output |
| G0.2 | `go vet ./...` in `backend/` | Exit 0 |
| G0.3 | `go test -race -count=1 ./...` in `backend/` | Exit 0 |
| G0.4 | `make build` | `bin/api` produced |
| G0.5 | `./bin/api -version` | Exit 0; prints a non-empty version |
| G0.6 | `make check` in a clean clone | Exit 0 |
| G0.7 | Inspect tracked files | No legacy paths (`apps/`, `packages/`, `infra/docker`, `infra/compose`, `pnpm-*`, `turbo.json`, `.husky`), no `.env`, no archives, no `bin/` |

## M1: Configuration and logging

- Configuration is read from the environment and validated at startup. Missing or invalid required values exit non-zero and list every error. Tested.
- Structured JSON logging via `log/slog`. A test confirms secret values and request bodies are never logged.
- Gates: the M0 commands (G0.1 to G0.3, G0.6), plus the new tests passing.
- Prerequisites: M0 complete. Tests supply configuration through environment fixtures created by the tests; no local `.env` is required.
- `TODO(owner D2):` coverage threshold for `internal/config`. A 90% threshold has been proposed; it is not approved.
- `TODO(owner D3):` backend linter choice (for example golangci-lint) and its verified version. This decision covers the Go backend only. The web linter is a separate choice, decided at M5 under D5(c).

## M2: Health, readiness, PostgreSQL, goose baseline

- `GET /v1/health`: liveness. Returns 200 without any database dependency.
- `GET /v1/ready`: returns 200 when PostgreSQL is reachable and 503 when it is not. The 503 path is tested with an unreachable DSN in a test, not by stopping containers.
- Errors use RFC 9457 Problem Details (tested).
- goose: `up` from an empty database succeeds; `down` then `up` succeeds; `status` is clean. Migrations live in `backend/db/migrations/`.
- Integration tests run against a real PostgreSQL instance.
- Prerequisites: a PostgreSQL 17 instance (see D4) reachable through a DSN supplied in the environment. Tests create and drop their own databases or schemas and do not depend on pre-existing data. If a local `.env` is used, a committed `.env.example` documents its keys, and no real values are committed.
- `TODO(owner D4):` confirm the PostgreSQL 17 image and version. Provisional until verified against official support status (ADR 0004 amendment).
- goose version is a candidate and must be verified and pinned at this milestone.

## M3: sqlc

- `sqlc generate` followed by `git diff --exit-code` shows no change.
- One representative query, under `backend/db/queries/`, is tested against a real database.
- sqlc version is a candidate and must be verified and pinned at this milestone.
- Prerequisites: the M2 database. Generated sqlc output is committed and drift-checked as described in M4.

## M4: Contracts (generator spike)

- Spike: a minimal health contract written in OpenAPI 3.1.1, plus the JSON Schema for ping and pong.
- Generated-code drift gates. The generated paths are declared in the Makefile `contracts` target and are called `<generated paths>` below. In a clean clone, first remove those paths from the working tree, then regenerate, then check all four:
  - **Tracked outputs:** `git diff --exit-code -- <generated paths>` exits 0. Any changed tracked file fails the gate.
  - **Unexpected untracked files:** `git status --porcelain --untracked-files=all -- <generated paths>` prints nothing. This catches generated files that were never committed.
  - **Ignored outputs:** `git status --porcelain --ignored -- <generated paths>` prints nothing. Generated paths must not be covered by `.gitignore`.
  - **File set:** `git ls-files -- <generated paths>` equals the list of files the generator wrote. Any missing or extra file fails the gate.
- The generator writes only inside `<generated paths>`: `git status --porcelain --untracked-files=all` on the whole tree, after generation, shows no entry outside those paths.
- Prerequisites: pinned generators (see Candidates below) and the Makefile `contracts` target that declares `<generated paths>`.
- Validator decisions: `TODO(owner D9):` D9 covers both the OpenAPI 3.1.1 validator and the JSON Schema validator. Before this milestone passes, each must have compatibility verified against OpenAPI 3.1.1 and the pinned generators, an exact version pinned, and its choice recorded in an ADR.
- Other gates:
  - Generated Go code compiles.
  - Generated TypeScript passes type checking.
  - The OpenAPI document validates with the pinned OpenAPI validator (D9).
  - The JSON Schema validates with the pinned JSON Schema validator (D9).
- Candidates, unverified for 3.1.1: oapi-codegen v2.8.0 (release notes state initial 3.1 support; Go 1.25 required) and openapi-typescript 7.13.0 (3.1 support not confirmed). Both must be verified and pinned here.
- **Fallback rule:** if the spike fails, the contract version stays 3.1.1 until a 3.0.3 fallback is recorded by ADR amendment. Never change the contract version silently.

## M5: Web (Next.js and TypeScript)

- `TODO(owner D5):` three separate web choices, each decided on its own and recorded in its own ADR after reviewing options:
  - (a) web package manager (pnpm or npm);
  - (b) web runtime validation library;
  - (c) web linter and its verified version.
  - Choosing one does not decide the others. The backend linter (D3) does not govern the web linter.
- Next.js version: candidate, pinned here after verification.
- Prerequisites: a Node.js version verified and pinned at this milestone; a committed lockfile. No local `node_modules` or build output is an input; install and build run from the clean clone.
- Gates:
  - Install from the lockfile with a frozen lockfile.
  - Type checking passes.
  - Linting passes, using the web linter chosen under D5(c).
  - Production build passes.
  - The page shows live `/v1/health` data through the generated client. Evidence captured as command or browser output.

## M6: Realtime (ping and pong only; flag off by default)

- **Dependency pinning is blocked.** `github.com/coder/websocket` must not be pinned in any file until all of the following are verified and recorded in this document:
  1. The module's latest non-retracted version, with its publication date, taken from the module's version list. Not yet verified. The newest version seen so far is v1.8.15, dated Jun 15, 2026, on the pkg.go.dev versions page; whether it is the latest non-retracted version is not confirmed.
  2. The `go` directive at that exact tag. Seen so far: `go 1.23` at tag v1.8.15, from the module's `go.mod` at that tag. Not yet confirmed for any later version.
  3. The reason pkg.go.dev reports the page as "not in the latest version of its module". Unresolved.
  4. The origin-pattern, read-limit, and ping APIs as documented for that exact tag.
  5. Owner approval of the pin.
- No authentication is implemented in this milestone. Protected operations fail closed.
- Prerequisites: the realtime library pin is blocked until the items below are recorded. Tests are self-contained and need no local state.
- Required tests (each must pass under `go test -race -count=1 ./...`):
  - Connection from a disallowed origin is rejected before upgrade.
  - The no-Origin-header case has an explicit, recorded decision and a test.
  - A frame over the size limit is rejected and the connection closed.
  - Idle connections are closed at the read deadline.
  - Writes have a deadline and a stalled writer does not block others.
  - Heartbeat: a missing pong closes the connection.
  - A full outbound queue disconnects the slow client; the broadcaster never blocks.
  - Shutdown cancels all connections within a bound.
  - No goroutine leaks after close (`goleak`).
  - With the flag off, the route is absent.
  - Inbound events are validated against the JSON Schema before dispatch.
  - An unknown event returns a typed error with no internal detail.
- `TODO(owner D6):` numeric limits (frame size, queue capacity, deadlines). Not yet set.

## M7: Infrastructure and CI

- Compose: a separate project name, separate named volumes, and a configurable host port defaulting to 55432. `docker compose config --quiet` exits 0.
- Legacy volumes and containers are not used or touched.
- CI runs on a clean checkout with jobs for backend, contracts (drift check), web, and compose.
- GitHub Actions are pinned to commit SHAs.
- Prerequisites: Docker available for the compose gate. Compose gates run from committed files. If a `.env` is needed, the gate uses a committed `.env.example`; a real `.env` is never a gate input.
- `TODO(owner D7):` confirm the CI runner image and any service containers for PostgreSQL.

## M8: Documentation and setup

- A fresh clone, following only the README, reproduces M0 to M7 gates.
- Prerequisites: a fresh clone of the milestone branch and the README. Nothing else.
- `TODO(owner D10):` accept ADR 0007 (change its status from "Proposed" to "Accepted"). This is a separate approval. The governance-set approval given on 2026-10-23 did not accept ADR 0007. This draft does not edit ADR 0007.
- Superseded ADRs remain marked.
- `TODO(owner D8):` location and name of the v2 decision log, established by owner approval. Until it exists, decisions are recorded in ADRs or as `TODO(owner)` markers (see `AGENTS.md`, "Working rules").

## Out of scope for every gate

- Publication of v2 to GitHub `main`, including any clean-history replacement. This is a separate owner decision.
- Authentication, messaging, groups, communities, media, notifications, moderation, Redis, FastAPI, LiveKit, and any product feature.

## Open owner decisions

Each row maps to the inline `TODO(owner D#)` markers above. "Must resolve before" is the first milestone whose gates cannot pass without the decision. Only D1 applies before M0.

| ID | Decision | Must resolve before | Can stay open until | Inline marker |
|---|---|---|---|---|
| D1 | Approve or amend this gates document | M0 starts | Approved with conditions (see "D1 approval conditions") | Status line (`TODO(owner D1)`, resolved) |
| D2 | Coverage threshold for `internal/config` | M1 gates pass | M1 | M1 |
| D3 | Backend (Go) linter choice and its verified version | M1 gates pass | M1 | M1 |
| D4 | PostgreSQL 17 image and version | M2 gates pass | M2 | M2 |
| D5 | Web tooling, three separate choices: (a) package manager, (b) runtime validation library, (c) web linter | M5 gates pass | M5 | M5 |
| D6 | Realtime numeric limits (frame size, queue capacity, deadlines) | M6 gates pass | M6 | M6 |
| D7 | CI runner image and service containers | M7 gates pass | M7 | M7 |
| D8 | Location and name of the v2 decision log | M8 gates pass | M8 | M8 |
| D9 | M4 validators, covering both the OpenAPI 3.1.1 validator and the JSON Schema validator: compatibility verified, exact versions pinned, choices recorded in an ADR | M4 gates pass | M4 | M4 |
| D10 | Acceptance of ADR 0007 (status "Proposed" to "Accepted"); separate from D1 | M8 gates pass | M8 | M8 |

Notes:
- D3 (backend linter) and D5(c) (web linter) are independent. Choosing one does not choose the other.
- The M6 `coder/websocket` pin is not a decision row. It is a verification block under M6.
