# Holoraa: Claude Code guide

@AGENTS.md

`AGENTS.md` is the rulebook and wins every conflict. This file only adds the practical map. Web code also follows `web/AGENTS.md`.

## Before any change

1. Confirm the active milestone in `docs/MILESTONE_GATES.md` and the task. Work outside it is out of scope.
2. State the plan and the files to touch. Wait for approval before commit, branch, push, file deletion or move, or container change.
3. Never read or print `.env` (real secrets). `.env.example` lists keys only.

## Commands (repo root)

Go is not on PATH. Always pass the pinned toolchain: `GO=$HOME/toolchains/go1.27.3/go/bin/go`.

| Need | Command |
|---|---|
| Go gate (gofmt, vet, race tests, sqlc drift, build) | `make check GO=...` |
| DB-backed Go tests (starts `holoraa-v2-postgres`, port 5433) | `make test-db GO=...` |
| Web gate (typecheck, lint, vitest, build) | `make web-check` |
| Contract lint and generated client drift | `make contract-check` |
| Everything | `make check-all GO=...` |
| Regenerate sqlc (pinned v1.28.0) | `make sqlc-gen` |
| Regenerate web API types | `cd web && npm run gen:api` |
| Web dev server | `cd web && npm run dev` |
| Single web test | `cd web && npx vitest run <path>` |

Report real command output only. Never say a check passed unless it ran.

## Map

- `backend/internal/`: `httpapi` (chi handlers), `auth`, `profile`, `messaging`, `realtime` (WebSocket), `store` (sqlc output, never hand-edit), `config`, `problem` (RFC 9457), `mail`, `logging`, `testdb`.
- `backend/db/migrations/` (goose, forward-only) and `backend/db/queries/` (sqlc input).
- `contracts/openapi.yaml` is the HTTP source of truth; `contracts/events/*.json` are the realtime schemas. `web/src/lib/api/schema.ts` is generated.
- `web/src/lib/auth` and `web/src/lib/messaging`: BFF flows, validation, realtime client. Server actions live in `web/src/app/app/`.
- The web app talks to the backend only through the contract. Never touch the database from web code.

## Gotchas

- Next.js 16 has breaking changes. Read the relevant guide in `web/node_modules/next/dist/docs/` before writing web code.
- Dev sign-in codes are written to `.local/mail/` (fake mail provider). Never commit `.local/`.
- Docker: touch only the Holoraa v2 container and volume. Never run `docker compose down -v`; never use legacy volumes.
- Root `screenshot_*.png` files are gitignored scratch captures.
- Docs drift (milestone status in README, "M0 only" wording in `AGENTS.md`): do not fix silently. Raise it as a proposal.

## Git

- Feature branches only, Conventional Commits, one logical change per commit.
- Stage explicit paths. No `git add .`, `-A`, `reset --hard`, `clean`, force-push, or push without approval.
- Before each commit run `git diff --check`, `git diff`, `git status`.
- Commits end with the Co-Authored-By line from the session attribution. (`~/Projects/OpenSource` forbids it; that rule does not apply here.)

## Code style

- Ponytail mode is on: simplest, shortest solution that works, stdlib first, no unrequested abstractions. It never overrides `AGENTS.md`: keep error checks, input validation, size limits, tests with business logic, and fail-closed security.
- No `any` in TypeScript, no `interface{}` in Go, without a written justification.

## Tooling in this repo

- Plugins (see `.claude/settings.json`): ponytail, gopls-lsp, typescript-lsp, security-guidance, pr-review-toolkit, frontend-design, context7.
- MCP: Playwright (`.mcp.json`) for checking UI in a browser, context7 (plugin) for current library docs.
- Skill `holoraa-gates`: pre-commit checklist. Use it before proposing a commit.
- Language servers (`gopls`, `typescript-language-server`) must be installed locally for the LSP plugins to work.
