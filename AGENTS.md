# Agent Guidelines for Holoraa (v2)

> Rulebook for AI coding assistants working on Holoraa.
> Status: proposed for owner approval. Supersedes the legacy NestJS, Prisma, and Zod rules.

---

## Vision and identity

Holoraa (two a's at the end) is one minimal social space to chat, hang out, and share.

- **Mission:** one simple, safe place to talk, share, and hang out with the people who matter.
- **Values:** simple by default, safe by design, private by default, respectful of attention, built in the open where possible.
- **Non-goals:** no ads, no selling user data, no algorithmic feed manipulation, no features that exist only to maximise screen time.

---

## Architecture (v2)

Versions are **candidates until verified and approved** at the milestone that needs them. Do not pin a version in configuration before its milestone and its verification step.

| Layer | Choice | Status |
|---|---|---|
| Backend | Go modular monolith (single module, `internal/` packages) | Decided (ADR 0007, proposed) |
| Backend toolchain | Go 1.27.3 | Target toolchain. Extracted locally to `~/toolchains/go1.27.3` after SHA-256 verification of the official archive (outside the repository; not on PATH; not pinned). The official SHA-256 was published by go.dev and dl.google.com. The `backend/go.mod` pin happens only after the approved setup succeeds; any further installation requires its own approval |
| API contract | OpenAPI 3.1.1 for HTTP; JSON Schema for realtime events | Target is 3.1.1. Generator versions pinned after the M4 spike. A 3.0.3 fallback is permitted only if the spike fails, and only by a recorded ADR amendment; the contract version is never changed silently |
| Database | PostgreSQL 17 | **Provisional.** Verify official support status and the intended image and version before pinning in any configuration |
| Migrations | goose (the only migration tool) | Decided; version pinned at its milestone |
| Queries | sqlc (generated, committed, drift-checked) | Decided; version pinned at its milestone |
| HTTP routing | chi | Decided; version pinned at its milestone |
| Realtime | `github.com/coder/websocket` | Decided; version pinned at M6 after review |
| Frontend | Next.js + TypeScript (App Router) | Decided; version pinned at M5 |
| Web runtime validation | Open | **Pending M5.** Decided by an ADR after reviewing options |
| Web package manager | Open | **Pending M5.** Decided by an ADR after reviewing options |
| Cache / pub-sub | Redis | **Deferred** until a feature needs it |
| AI / moderation / analytics | FastAPI | **Deferred** until a real workload needs it |
| Calls | LiveKit | **Deferred** (post-MVP) |
| Local infrastructure | Docker Compose (Postgres only at foundation); native Go and Node also acceptable | Decided; project name, volumes, and host port set at M7 |

Rules:
- The backend is one Go module. Packages live under `backend/internal/`. Do not create a package without real code in it.
- The web client talks to the backend only through the published contracts in `contracts/`. It never reads the database.
- No ORM, no second migration system, no NestJS, no Prisma.

---

## Repository layout

```
backend/        Go module: cmd/, internal/, db/migrations/, db/queries/
web/            Next.js + TypeScript
contracts/      OpenAPI and JSON Schema (source of truth)
infra/compose/  local infrastructure
docs/           architecture, ADRs, runbooks
```

---

## Contracts and generated code

- `contracts/` is the source of truth for HTTP (OpenAPI 3.1.1) and realtime (JSON Schema).
- Generated code is committed. It is never hand-edited.
- Generators are pinned to exact versions. Never use `@latest` or unpinned tools in scripts.
- CI fails if regenerating produces any diff.

---

## Database

- goose is the only migration tool. Migrations are forward-only SQL files in `backend/db/migrations/`, reviewed like code.
- Schema changes happen only through migrations, never by hand against a shared database.
- Queries are written in SQL under `backend/db/queries/` and compiled by sqlc.
- Every migration is tested from an empty database in CI.

---

## Security and privacy (non-negotiable)

- Authentication and authorization are not implemented until the owner approves the design. Placeholder token checks must never be presented as authentication.
- Protected routes and sockets fail closed.
- WebSocket origin is checked against an allowlist before upgrade. Never disable origin verification.
- Every external input has a size limit and is validated at the boundary.
- HTTP errors use RFC 9457 Problem Details. Internal error detail is never returned to clients.
- Secrets come only from the environment. No secret, password, token, or real `.env` file is committed. Never print secret values in output, logs, or reports.
- Local development credentials are generated per developer and are never reused from documentation or committed files.
- Logs must not contain personal data, tokens, cookies, or request bodies. Redact by default.
- No tracking pixels, no dark patterns.

---

## Testing and quality

- Business logic ships with tests in the same change.
- Go: `gofmt`, `go vet`, and `go test -race -count=1 ./...` must pass.
- Database and contract behaviour is tested against real services, not mocks.
- Web: type checking, linting, and production build must pass.
- A milestone is complete only when its approved gates pass in a clean clone. Never report a result without the real command output.
- Do not claim a test passed unless it ran.

---

## Scope boundaries

- The active milestone is stated in the task. Work outside it is out of scope.
- Prerequisite before M0 implementation starts (not an M0 deliverable): milestone gates for M0 to M8 are written into `docs/` and approved by the owner.
- **M0 is strictly limited to:** the Go module skeleton, the version entry point, its tests, a Makefile with `check`, `build`, and `clean` targets, and a freshly written `.gitignore`. No router, database, web app, contracts, or documentation changes belong to M0.
- Out of scope until approved: Redis, FastAPI, realtime chat features, authentication, messaging, groups, communities, media, notifications, moderation, LiveKit calls, feeds, stories, recommendations, mobile apps.

---

## Git history and publication

- Work on feature branches. Never work directly on `main`.
- Preserve existing history. Never rewrite published history.
- Never force-push.
- Any clean-history replacement of GitHub `main` is a **separate owner decision** that requires explicit approval for that specific operation. Nothing in this document, and no ADR, authorizes publication, force-push, or any remote change.
- Do not push, tag, or change remote refs without explicit owner approval for each operation.
- Never touch containers or volumes that do not belong to Holoraa v2. Never use the legacy Compose volumes for v2 work.

---

## Working rules

- One task at a time on its own branch.
- Plan before coding: state the plan and the files to be touched.
- Small, reviewable changes, one logical change per commit.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, ...).
- Stage explicit paths only. Never use `git add .`, `git add -A`, `git reset --hard`, or `git clean`.
- Before each commit: inspect `git diff --check`, `git diff`, and `git status`.
- Require explicit owner approval before any commit, tag, branch creation or deletion, history rewrite, push, container or volume change, or deletion or move of files.
- Never commit secrets, local databases, build artifacts, or unrelated owner changes.
- When a fact is unknown, mark it `TODO(owner): ...`. Do not invent facts.
- Record each decision in the approved v2 decision log once one has been established. Until then, record it in the relevant ADR or leave a `TODO(owner)` marker.
- `docs/OPEN_DECISIONS.md` is legacy material. It must not be adopted without owner approval.
- Governance changes (this file, ADRs) are proposed first and applied only after owner approval.

---

## Always do

- Spell the brand **Holoraa** (two a's at the end).
- Validate inputs at boundaries.
- Return RFC 9457 Problem Details for HTTP errors.
- Check every error return in Go. Do not silently discard errors.
- Verify the current stable version of any new dependency before adding it.
- Keep docs in step with code, and mark planned features as planned.

## Never do

- Do not reintroduce NestJS, Prisma, or Zod as foundation dependencies.
- Do not add a dependency or pin a version without verifying it, and without its milestone approval.
- Do not write mock-only code that bypasses type or compiler errors.
- Do not use `any` in TypeScript or `interface{}` shortcuts in Go without a written justification.
- Do not commit generated code that disagrees with its contract.
- Do not build features outside the active milestone.
- Do not add algorithmic feed ranking, tracking pixels, or attention-exploiting patterns.
