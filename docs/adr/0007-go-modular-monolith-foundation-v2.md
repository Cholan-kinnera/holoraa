# ADR 0007: Go Modular Monolith Foundation (v2)

- **Status:** Proposed (owner direction approved 2026-10-23; ADR text pending owner acceptance)
- **Date:** 2026-10-23
- **Deciders:** Owner (solo maintainer)
- **Consulted:** None beyond the owner. The architecture direction was informed by planning and review reports prepared during the 2026-10-22 to 2026-10-23 repository audit. Those reports are not stored in the repository.
- **Informed:** Future contributors and agents

---

## Context and Problem Statement

The legacy foundation is a small NestJS, Prisma, Socket.io, and Zod scaffold with no authentication, no messaging, no committed migrations, and failing lint, typecheck, and format checks. The owner has chosen a clean rebuild with a Go backend and a Next.js and TypeScript frontend. This ADR records that architecture for the v2 foundation and lists what is deferred.

## Decision Drivers

- A single maintainable backend language with a small, explicit dependency set.
- Reproducible builds and generated code that CI can verify.
- Database schema ownership in one migration tool.
- Realtime safety requirements that are testable from the start.
- Preservation of the legacy work for recovery, without carrying its code forward.

## Considered Options

1. **A. Keep the NestJS foundation and improve it** (ADR 0003 stands).
2. **B. Migrate incrementally** from NestJS to Go and FastAPI, keeping working parts.
3. **C. Rebuild the foundation** in Go and Next.js, with no legacy application code carried forward. *(Selected by the owner.)*

## Decision Outcome

Chosen option: **C. Clean rebuild**, with:

- **Backend:** Go modular monolith. One Go module; packages under `backend/internal/`.
- **Web:** Next.js with TypeScript, App Router.
- **Database:** PostgreSQL. Migrations with goose (the only migration tool). Queries with sqlc.
- **HTTP routing:** chi.
- **Realtime:** `github.com/coder/websocket`, pinned after review.
- **API contracts:** OpenAPI 3.1.1 for HTTP and JSON Schema for realtime events. Generators pinned, outputs committed, drift checked in CI. The target contract version is 3.1.1. The M4 generator-compatibility spike decides whether the chosen generators support it. If the spike fails, a 3.0.3 fallback is permitted only by a recorded amendment to this ADR. The contract version is never changed silently.
- **Local infrastructure:** Docker Compose for PostgreSQL in the foundation, in its own project with its own volumes and a configurable host port.

### Legacy handling

- Legacy NestJS, Prisma, and Zod application code is **not** copied into v2.
- The legacy state is preserved in an external verified backup and the **local** tag `legacy/nestjs-foundation`. Neither is published to the remote.
- This ADR does **not** authorize any push, tag publication, branch replacement, or remote change. Any publication, including a clean-history replacement of GitHub `main`, is a separate owner decision requiring explicit approval for that operation.

### Explicitly deferred

- **Redis.** Not part of the foundation. Introduced only when a feature needs it. See the amendment to ADR 0006.
- **FastAPI.** Not part of the foundation. Introduced only when a real AI, moderation, recommendation, or analytics workload justifies a separate service.
- **LiveKit and calls.** Post-MVP. See ADR 0005 (legacy reference; not present in the current v2 governance set).
- **Authentication, authorization, messaging, groups, communities, media, notifications, moderation, feeds, stories, recommendations, mobile apps.** Out of scope for the foundation. Authentication requires an owner-approved design first. DEC-007 is recorded in `docs/OPEN_DECISIONS.md`, which is legacy material not yet adopted into v2 and is not present in this governance set.
- **Web runtime validation library and web package manager.** Decided at M5 by their own ADRs after reviewing options.

### Versions and pins

Nothing is pinned by this ADR except as stated in `AGENTS.md`. Every version is a candidate until verified and approved at its milestone. Current status:

| Item | Status |
|---|---|
| Go 1.27.3 | Target toolchain. Extracted locally to `~/toolchains/go1.27.3` after SHA-256 verification of the official archive (outside the repository; not on PATH; not pinned). The official SHA-256 was published by go.dev and dl.google.com. The `go.mod` pin happens only after the approved setup succeeds; any further installation requires its own approval. |
| PostgreSQL 17 | Provisional. Official support status and image to be verified before pinning. |
| goose, sqlc, chi | Decided; versions verified at their milestones. |
| `github.com/coder/websocket` | Latest seen v1.8.15, minimum Go 1.23 at that tag. Re-verify before pinning at M6. |
| oapi-codegen | Candidate v2.8.0 (initial OpenAPI 3.1 support, Go 1.25 required per its release notes). Spike required at M4. |
| openapi-typescript | Candidate 7.13.0. 3.1 support not yet confirmed. Spike required at M4. |
| Next.js | Pending M5. |

### Milestone gates

Prerequisite, not an M0 deliverable: milestone gates for M0 to M8 must be written into `docs/` and approved by the owner before M0 implementation starts. Until then they are not binding. Any milestone is complete only when its gates pass in a clean clone. M0 is limited to the Go skeleton, the version entry point, its tests, a Makefile, and a fresh `.gitignore`, as stated in `AGENTS.md`.

## Consequences

**Positive**
- One backend language and one toolchain for the server.
- Generated code and migrations are checked by CI, so drift is caught early.
- Legacy history is preserved for recovery without shaping the new codebase.

**Negative and risks**
- Full rewrite cost; the legacy scaffold's small amount of working code is re-implemented.
- Go contract generation for OpenAPI 3.1 may not be fully supported; the spike and fallback address this.
- The legacy CI and documentation remain red or stale until the v2 branch replaces them. Publication timing is an owner decision.

## Open owner decisions

- Go module path: `github.com/Cholan-kinnera/holoraa/backend` (approved).
- Acceptance of this ADR text.
- Publication strategy for v2 to GitHub `main` (separate decision; not authorized here).
- Web runtime validation library and web package manager (M5).
- PostgreSQL version confirmation after verification.

## Links

- ADR 0001 (pnpm and Turborepo): partially superseded for the backend.
- ADR 0002 (modular monolith): kept; amended to Go packages.
- ADR 0003 (NestJS): superseded by this ADR.
- ADR 0004 (PostgreSQL): kept; amended to goose, sqlc, provisional version 17.
- ADR 0005 (LiveKit): kept, deferred. Legacy reference; not present in the current v2 governance set.
- ADR 0000 (template): legacy reference; not present in the current v2 governance set.
- ADR 0006 (Redis): kept; amended to deferred.
- `AGENTS.md` (v2 rulebook; text pending owner review).
