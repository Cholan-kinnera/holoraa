---
name: holoraa-gates
description: Pre-commit checklist for Holoraa. Use before proposing any commit or declaring a task done.
---

# Holoraa pre-commit gates

Source of truth (do not duplicate): `AGENTS.md`, `docs/MILESTONE_GATES.md`, `docs/engineering/TESTING.md`.

1. Change is inside the active milestone and the approved plan.
2. Run only the gates that match what changed, with `GO=$HOME/toolchains/go1.27.3/go/bin/go`:
   - Go changed: `make check GO=...`; if SQL or DB behaviour changed also `make test-db GO=...`.
   - SQL queries changed: `make sqlc-gen`, then confirm the generated diff is committed together.
   - `contracts/` changed: `make contract-check` (regenerate `web/src/lib/api/schema.ts`, never hand-edit).
   - Web changed: `make web-check`.
3. Security scan of the diff: no secrets or `.env`, no tokens or request bodies in logs, inputs validated with size limits, protected routes fail closed, WebSocket origin check intact, errors are RFC 9457 and leak no internals.
4. Business logic has tests in the same change.
5. `git diff --check`, `git diff`, `git status`: only intended paths, no unrelated owner changes.
6. Report each result with real output, including failures and anything skipped. Never claim green without output.
7. Stop and ask before commit, push, branch change, or container change.
