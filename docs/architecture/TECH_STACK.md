# Technology Stack — Holoraa (v2)

- **Purpose:** Each technology choice for v2, its status, and where its version gets pinned.
- **Owner:** TODO(owner): Tech Lead
- **Status:** Draft for owner review.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** Only Go 1.27.3 is in use, and only in the M0 skeleton. No other version is pinned.

**Rule:** a version is recorded here only after it has been verified and the milestone that needs it has been approved (AGENTS.md, "Architecture"). The legacy `TECH_STACK.md` listed versions that were never verified for v2. They are not carried forward.

---

## Status key

- **Decided:** chosen in AGENTS.md or ADR 0007. Still needs a pin at its milestone.
- **Provisional:** chosen, but the owner must confirm details before pinning (see the cited decision).
- **Open:** a choice is still required. The cited decision is the owner's to make.
- **Deferred:** not needed for the foundation.
- **Retired:** from the legacy stack. Not used in v2.

---

## Backend (Go)

| Component | Status | Choice | Pin at | Notes |
|---|---|---|---|---|
| Language toolchain | Decided, in use | Go 1.27.3 | M0 (go.mod set after approval) | Installed under `~/toolchains/go1.27.3`. Not on PATH. |
| Architecture | Decided | Modular monolith, single Go module | ADR 0007 (Proposed) | |
| HTTP routing | Decided | chi | M2 | |
| PostgreSQL | Provisional | PostgreSQL 17 | M2, after D4 | Image and version need owner confirmation. |
| Database driver | Open | To be chosen | M2 | Not chosen in any decision yet. Needs its own ADR. |
| Migrations | Decided | goose (the only migration tool) | M2 | Forward-only SQL. See the migration policy in [DEPLOYMENT.md](../engineering/DEPLOYMENT.md). |
| Queries | Decided | sqlc (generated, committed, drift-checked) | M3 | |
| Realtime | Decided | `github.com/coder/websocket` | M6, after review | Ping and pong only at M6, flag off by default. |
| Backend linter | Open | D3 | M1 | Example: golangci-lint. Needs its owner choice and verified version. |
| Config | Decided | Environment variables only | M1 | No `.env` committed. `.env.example` may document keys. |
| Logging | Open | Go standard library `log/slog` is the likely candidate | M1 | Not decided. Requires owner approval and redaction rules. |

## API contracts

| Component | Status | Choice | Pin at | Notes |
|---|---|---|---|---|
| HTTP contract | Decided | OpenAPI 3.1.1 (3.0.3 only by recorded ADR amendment if the M4 spike fails) | M4 | Source of truth in `contracts/`. |
| Realtime contract | Decided | JSON Schema | M4 | Source of truth in `contracts/`. |
| Contract validators and generators | Open | D9 | M4 | Compatibility must be verified and recorded in an ADR before M4 passes. |
| Error format | Decided | RFC 9457 Problem Details | M2 | See [API.md](API.md). |

## Web (Next.js)

| Component | Status | Choice | Pin at | Notes |
|---|---|---|---|---|
| Framework | Decided | Next.js with TypeScript, App Router | M5 | |
| Package manager | Open | D5(a) | M5 | Needs an ADR. |
| Runtime validation library | Open | D5(b) | M5 | The legacy stack used Zod. That is not carried into v2 by default. Needs an ADR. |
| Web linter | Open | D5(c) | M5 | Separate from the Go linter (D3). |
| Styling | Open | Not chosen in any decision | M5 | The legacy stack used Tailwind CSS. Needs an owner decision. |
| Design tokens | Decided (values) | Values in [BRAND.md](../product/BRAND.md) | M5 | |

## Infrastructure

| Component | Status | Choice | Pin at | Notes |
|---|---|---|---|---|
| Local infrastructure | Decided | Docker Compose, PostgreSQL only at foundation. Native Go and Node also acceptable. | M7 | Project name, volumes, and host port are set at M7. Must not reuse legacy containers or volumes. |
| CI | Open | D7 (runner image and service containers) | M7 | |
| Redis | Deferred | Not in the foundation | When a feature needs it | Legacy used it for pub/sub and presence. |
| FastAPI | Deferred | Not in the foundation | When a real workload exists | |
| LiveKit or another SFU | Deferred | Not in the foundation | Post-MVP | See [ARCHITECTURE.md](ARCHITECTURE.md), section 5. |

## Retired from the legacy stack

NestJS, Prisma, Zod (as a foundation dependency), Socket.io, Turborepo, pnpm workspaces, Pino, and Helmet. See [ADR 0003](../adr/0003-nestjs-backend-framework.md) and [ADR 0007](../adr/0007-go-modular-monolith-foundation-v2.md).

## Verification status

No version in this document has been verified for v2 yet. Before a version is pinned, verify it against its official source and record the check in the milestone's gate output.
