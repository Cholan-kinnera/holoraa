# ADR 0008: Tooling and versions for the foundation skeleton

- **Status:** Proposed. **Not accepted.** Only the owner sets this status. It is the working baseline for the skeleton, with the open items below.
- **Date:** 2026-10-25 (revised the same day after review)
- **Deciders:** TODO(owner)
- **Consulted:** Solo maintainer (assistant-drafted, pending owner review)
- **Relates to:** [ADR 0007](0007-go-modular-monolith-foundation-v2.md) (Proposed), decisions D3, D4, D5, D9 in [MILESTONE_GATES.md](../MILESTONE_GATES.md)

---

## Context

The owner approved activating milestones M1 (configuration and logging), M2 (health, readiness, PostgreSQL, goose baseline), M4 (contract, for the two foundation endpoints) and M5 (web status page), in order to build the first end-to-end skeleton. Milestones M3, M6, M8 remain closed. M7 is partly active: the local development database only, with no CI.

AGENTS.md requires that a dependency is verified, and that a version is pinned only at its milestone and after verification. Versions are pinned in `backend/go.mod` and `web/package.json`. This ADR records the choices, what was checked for each, and what is still open. Pinning in code does not make the decision accepted.

## Decision (proposed)

### Verification of the Node.js runtime

| Runtime | Used for | Status |
|---|---|---|
| **Node.js 24.22.1 (LTS)**, official linux-x64 tarball from nodejs.org, SHA-256 verified against the published `SHASUMS256.txt` | Declared target. `make web-check`, `make contract-check`, `make e2e`, and a fresh `npm ci` from the lockfile | **Verified.** Ran with npm 11.19.1. Extracted to `/tmp`; not installed system-wide. |
| Node.js v26.11.1 (local default) | `make check`, `make test-db`, `make check-all` (Go and database tests; web and contract also ran) | Verified for these steps. Not the declared target. |

The declared target is Node 24 (`.nvmrc`, `engines: >=24`). Node 24 is the target because it is the active LTS line in the official index. Node 26 is the current release line and is also supported by the tooling where recorded.

### Backend (Go)

| Component | Version | Verification performed | Rationale |
|---|---|---|---|
| Go toolchain | 1.27.3 | Installed under `~/toolchains/go1.27.3`. Used since M0. | Target toolchain from AGENTS.md. |
| `github.com/go-chi/chi/v5` | v5.5.0 | Latest on the Go module proxy, 2026-10-25. `go.mod` declares `go 1.24`. | Decided in AGENTS.md. Small router, standard `net/http` handlers. |
| `github.com/jackc/pgx/v5` | v5.11.0 | Latest on the Go module proxy. `go.mod` declares `go 1.25.0`. | PostgreSQL driver and pool. Driver choice was open; this proposes it. |
| `github.com/pressly/goose/v3` | v3.29.0 | Latest on the Go module proxy. `go.mod` declares `go 1.26.0`. | Decided in AGENTS.md (the only migration tool). Used as a library, embedded in the API binary, so there is one pinned tool. |
| `gopkg.in/yaml.v3` | v3.0.1 | Latest tag on the Go module proxy (2022-05-27). | Imported only by test code, to read `contracts/openapi.yaml` in the conformance test. The API binary does not import it. |
| sqlc | not added | — | No database queries exist yet. Added at M3. |
| Go linter (D3) | not chosen | — | `gofmt`, `go vet`, and `go test -race` are the AGENTS.md minimum. |

### Web (Next.js + TypeScript)

Package manager (D5a, proposed): **npm**. The legacy pnpm and Turborepo setup is retired (ADR 0001 amendment).

| Package | Version | Verification performed | Rationale |
|---|---|---|---|
| `next` | 16.4.3 | Latest on npm. Engines `>=20.9.0`. Peer `react` `^19.0.0`. | Decided in AGENTS.md (Next.js, App Router). |
| `react`, `react-dom` | 19.3.1 | Latest on npm. | Required by Next.js 16. |
| `typescript` | 5.9.3 | Latest 5.x on npm. | `openapi-typescript` 7.13.0 declares a peer dependency of `^5.x`. TypeScript 7.0.2 is the latest release and is not used yet. |
| `openapi-fetch` | 0.17.0 | Latest on npm. | Typed client that uses the generated types. |
| `openapi-typescript` | 7.13.0 | Latest on npm. Peer `typescript ^5.x`. | Generates client types from the contract. Output is committed and drift-checked. |
| `@redocly/cli` | 2.71.0 | Latest on npm. Engines `node >=22.12.0`. | Lints the OpenAPI document (D9, OpenAPI part only). |
| `eslint` | **9.39.5** | Latest 9.x on npm. See "ESLint decision" below. | Web linter (D5c, proposed). Flat config via `eslint/config`. |
| `eslint-config-next` | 16.4.3 | Latest on npm, matched to Next.js. | Next.js lint rules. Its plugins declare peer ranges that stop at ESLint 9. |
| `vitest` | 5.0.5 | Latest on npm. Engines `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`. Peer `vite ^6.4 \|\| ^7 \|\| ^8`, installed by npm. | Unit tests for the status logic and URL handling. |
| `@types/react`, `@types/react-dom` | 19.3.0 | Latest 19.x on npm. | Matches React 19. |
| `@types/node` | 24.19.2 | Latest 24.x on npm. | Matches the Node 24 target. |

### ESLint decision

- **Chosen for now:** ESLint 9.39.5, with the Next.js preset.
- **Why not ESLint 10.13.0:** `npm ci` reports peer-dependency conflicts with `eslint-plugin-import`, `eslint-plugin-jsx-a11y` and `eslint-plugin-react`, which `eslint-config-next` 16.4.3 pulls in. Forcing ESLint 10 needs an npm override, and the owner has said not to add one.
- **Known issue:** npm reports ESLint 9.39.5 as "no longer supported". This is accepted for the skeleton and is an open item.
- **Not done:** the framework lint rules were not removed to silence the conflict.

### Contracts

- `contracts/openapi.yaml` is OpenAPI **3.1.1**.
- Validation (D9, OpenAPI part): Redocly CLI. It exits 0 with no errors and 3 warnings. The warnings are explained below. They are not silenced.
- Conformance: a Go test (`internal/httpapi/contract_test.go`) checks each handler response against the contract: status is declared, content type is declared, and the body matches the schema (required fields, no extra fields, constant values, integer bounds). A mutation check showed that changing a response body makes the test fail.
- Generated TypeScript types are committed. `make contract-check` regenerates them to a temporary file and compares byte for byte. A changed file makes it fail (tested).
- JSON Schema for realtime events is **not** added. It belongs to M4's realtime part and to M6.

### Logging

Standard library `log/slog` (JSON handler), with key-based redaction. No external logging library.

### Security headers

The API sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on every response. The web app sets `X-Content-Type-Options`, `Referrer-Policy` and `X-Frame-Options: DENY`. HSTS belongs at the TLS terminator and is not set here. A Content-Security-Policy is not set yet (see open items).

### Local database (D4, owner-approved as provisional development image)

- Image: `postgres:17-alpine`, approved by the owner as the **provisional development image**. Production selection remains open. The image is not confirmed against official support status for production use.
- Container `holoraa-v2-postgres`, volume `holoraa_v2_postgres_data`, host port `127.0.0.1:5433`. The legacy `holoraa-postgres` and `holoraa-redis` containers and their volumes are not used.
- The development database is named `holoraa_dev`. This is kept deliberately (the volume already exists).

## Verification record

| Check | Runtime | Result |
|---|---|---|
| `make check` (Go gofmt, vet, race tests, build) | Go 1.27.3 | exit 0 |
| `make test-db` (Go tests with PostgreSQL 17) | Go 1.27.3, Node 26 | exit 0, 42 passed, 0 failed, 0 skipped (verbose run) |
| `make web-check` (typecheck, lint, 13 unit tests, production build) | Node 24.22.1 and Node 26.11.1 | exit 0 both times |
| `make contract-check` (Redocly lint, drift check) | Node 24.22.1 | exit 0, 3 warnings |
| `make e2e` (status page against the real API and database) | Node 24.22.1 | exit 0, 5 states and 3 headers |
| Fresh clone of the committed branch, `make check-all` | Node 26.11.1 (before the Node 24 run) | exit 0 |

Recheck commands and exact results are in the review report that accompanies this ADR.

## Open items

1. **Owner acceptance** of this ADR (`TODO(owner)`).
2. **ESLint lifecycle.** Keep 9.39.5 (deprecated), move to ESLint 10 when `eslint-config-next` supports it, or replace the Next preset with `typescript-eslint` and the React plugins directly. Recommendation: keep 9.39.5 for now and revisit when the preset supports 10.
3. **OpenAPI warnings, not silenced.**
   - `info.license` is missing. The licence is an owner decision (`TODO(owner)`).
   - `GET /v1/health` and `GET /v1/ready` declare no 4xx response. The handlers never return a 4xx on these operations. The unknown-route 404 and wrong-method 405 are path-level behaviour, and a 4xx added to an operation would describe behaviour that does not exist. The rule will be satisfied only if a real 4xx case appears.
4. **Plain-text rejections from `net/http`.** Malformed requests (400) and oversized headers (431) are written by the standard library, not by the API, and are plain text rather than Problem Details. Fixing it means wrapping the server's error handling. It is not done.
5. **Content-Security-Policy** for the web app is not set. A strict policy needs a nonce setup for Next.js inline scripts (M5 item in the threat model).
6. **Node 24 for the Go and database steps.** Not run on Node 24. They do not depend on Node.
7. **PostgreSQL 17 production selection** (D4) is open. The development image is approved only as provisional.
8. **D3** (Go linter) and **D5(b)** (web runtime validation library) are not decided. The skeleton uses neither.
9. **D7** (CI runner and service containers) is not decided.
10. **Blocked install script.** `npm ci` under npm 11 reports that the postinstall script of `unrs-resolver` was not run under npm's default script policy. Lint, typecheck, tests, and the build all pass without it. Approving it is a separate, explicit choice (`TODO(owner)`).
11. **Browser end-to-end test.** Not added. The scripted check (`make e2e`) covers the same states at the HTTP and server-rendering level. A browser framework would add a browser download and another dependency, and is part of D5.
