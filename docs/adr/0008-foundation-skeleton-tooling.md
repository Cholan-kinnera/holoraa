# ADR 0008: Tooling and versions for the foundation skeleton

- **Status:** Proposed. Not accepted. Only the owner sets this status.
- **Date:** 2026-10-25
- **Deciders:** TODO(owner)
- **Consulted:** Solo maintainer (assistant-drafted, pending owner review)
- **Relates to:** [ADR 0007](0007-go-modular-monolith-foundation-v2.md) (Proposed), decisions D3, D4, D5, D9 in [MILESTONE_GATES.md](../MILESTONE_GATES.md)

---

## Context

The owner approved activating milestones M1 (configuration and logging), M2 (health, readiness, PostgreSQL, goose baseline), M4 (contract, for the two foundation endpoints) and M5 (web status page), in order to build the first end-to-end skeleton. Milestones M3, M6, M7 and M8 stay closed. AGENTS.md requires that a dependency is verified, and that a version is pinned only at its milestone and after verification.

This ADR records what was chosen, what was verified, and what is still open. Pinning in code (`backend/go.mod`, `web/package.json`) is done under this proposal. Owner acceptance is still required.

## Decision (proposed)

### Backend (Go)

| Component | Version | Verification performed | Rationale |
|---|---|---|---|
| Go toolchain | 1.27.3 | Installed under `~/toolchains/go1.27.3`. Already in use since M0. | Target toolchain from AGENTS.md. |
| `github.com/go-chi/chi/v5` | v5.5.0 | Latest on the Go module proxy, 2026-10-25. `go.mod` declares `go 1.24`, which is compatible. | Decided in AGENTS.md. Small, standard-library-compatible router. |
| `github.com/jackc/pgx/v5` | v5.11.0 | Latest on the Go module proxy. `go.mod` declares `go 1.25.0`, which is compatible. | PostgreSQL driver and pool. Widely used, maintained. Driver choice was open (not in any decision); this proposes it. |
| `github.com/pressly/goose/v3` | v3.29.0 | Latest on the Go module proxy. `go.mod` declares `go 1.26.0`, which is compatible. | Decided in AGENTS.md (the only migration tool). Used as a library, embedded in the API binary (`api migrate up|down|status`), so there is one pinned tool, not a separate CLI. |
| sqlc | not added | — | No database queries exist yet. sqlc is added at M3, when the first queries are written. |
| Go linter (D3) | not chosen | — | `gofmt`, `go vet` and `go test -race` are the AGENTS.md minimum. A linter is an owner choice (D3). |

### Web (Next.js + TypeScript)

Package manager (D5a, proposed): **npm**. The legacy pnpm and Turborepo setup is retired (ADR 0001 amendment). npm needs no extra tool and the lockfile is committed.

| Package | Version | Verification performed | Rationale |
|---|---|---|---|
| Node.js (runtime target) | 24 LTS (`engines`: `>=24`) | Node 24 is the active LTS line in the official release index (v24.22.1). **Not run here:** the local runtime is Node v26.11.1. See "Verification gaps". | An LTS line is safer than the current release for a foundation. |
| `next` | 16.4.3 | Latest on npm. Engines `>=20.9.0`. Peer `react` `^19.0.0`. | Decided in AGENTS.md (Next.js, App Router). |
| `react`, `react-dom` | 19.3.1 | Latest on npm. | Required by Next.js 16. |
| `typescript` | 5.9.3 | Latest 5.x on npm. | `openapi-typescript` 7.13.0 declares a peer dependency of TypeScript `^5.x`. TypeScript 7.0.2 (latest) is therefore not used yet. |
| `openapi-fetch` | 0.17.0 | Latest on npm. | Typed client that uses the generated types. Small runtime. |
| `openapi-typescript` | 7.13.0 | Latest on npm. Peer `typescript ^5.x`. | Generates the client types from `contracts/openapi.yaml`. Generated output is committed and drift-checked. |
| `@redocly/cli` | 2.71.0 | Latest on npm. Engines `node >=22.12.0`. | Lints the OpenAPI document (D9, partial: OpenAPI only). |
| `vitest` | 5.0.5 | Latest on npm. Engines `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`. Peer `vite ^6.4 \|\| ^7 \|\| ^8`, installed by npm. | Unit tests for the status logic and URL handling (AGENTS.md: business logic ships with tests). The legacy stack used Vitest; it is re-verified here for v2. |
| `eslint` | 9.39.5 | Latest 9.x on npm. Peer ranges of `eslint-config-next` 16.4.3's plugins (`eslint-plugin-import`, `eslint-plugin-react`, `eslint-plugin-jsx-a11y`) stop at ESLint 9. ESLint 10.13.0 was tried first and produced peer-dependency conflicts on `npm ci`, so it is not used. **Known issue:** npm reports ESLint 9.39.5 as "no longer supported". This is a trade-off the owner must decide (see Open items). | Web linter (D5c, proposed). Run through the flat config (`eslint/config`). |
| `eslint-config-next` | 16.4.3 | Latest on npm, matched to Next.js. | Next.js lint rules. |
| `@types/react`, `@types/react-dom` | 19.3.0 | Latest 19.x on npm. | Matches React 19. |
| `@types/node` | 24.19.2 | Latest 24.x on npm. | Matches the Node 24 target. |

### Contracts

- `contracts/openapi.yaml` is OpenAPI **3.1.1**, as AGENTS.md requires.
- Validation (D9, OpenAPI part): Redocly CLI (`npm run lint:contract`). It exits 0 with no errors. Three warnings remain and are listed below.
- JSON Schema for realtime events is **not** added. It is needed at M4 for events, and realtime is at M6.
- Generated TypeScript types (`web/src/lib/api/schema.ts`) are committed, and CI drift-checking is planned at M7.

### Logging

The standard library `log/slog` (JSON handler) with key-based redaction. No external logging library is added. The logging decision was open; this proposes it.

### Local database (D4 provisional)

- Image: `postgres:17-alpine`. Provisional under D4 until the owner confirms the image and version against official support status.
- Container `holoraa-v2-postgres`, volume `holoraa_v2_postgres_data`, host port `127.0.0.1:5433`. The legacy `holoraa-postgres`, `holoraa-redis` containers and their volumes are not used.

## Verification gaps

- **Node 24 not executed.** Checks ran on the local Node v26.11.1. Node 24 is the declared target. Running the web checks on Node 24 is an open step. `npx -p node@24` silently used the local Node 26, so it was not used as evidence.
- **PostgreSQL 17 not confirmed** against official support status (D4).
- **Clean-clone verification** is recorded in the commit log, not repeated here.
- **Blocked install script.** `npm ci` reports that the postinstall script of `unrs-resolver` (a dependency of the ESLint import resolver) was not run, under npm's default script policy. Lint, typecheck, tests and the build all pass without it. Whether it is needed is `TODO(owner)`; approving it would be a separate, explicit choice.
- **Redocly warnings** (not errors): no `info.license` (owner decision); two operations have no 4xx response declared. The 4xx warning is accepted for now. Problem Details are described in the shared `default` response.

## Consequences

- The backend and web app depend on exact versions. Each upgrade needs a new verification and an ADR amendment.
- Contract changes require regenerating the client. CI drift-checking is part of M7.
- Redis, FastAPI, LiveKit and authentication are not in this decision. They stay deferred or blocked as AGENTS.md states.

## Open items

- Owner acceptance of this ADR (`TODO(owner)`).
- **ESLint lifecycle (new).** Choose one: (a) keep ESLint 9.39.5, which is deprecated; (b) move to ESLint 10 and wait for `eslint-config-next` to support it, or add a reviewed npm override for its plugins; (c) replace the Next preset with `typescript-eslint` and the React plugins directly. Recommendation: (a) for now, with (b) when the preset supports 10.
- D3 (Go linter) and D5(b) (web runtime validation library) are not decided. The skeleton uses neither.
- D4 (PostgreSQL image and version) needs owner confirmation.
- D7 (CI runner and service containers) is not decided.
- Confirm the Node 24 target by running the web checks under Node 24.
