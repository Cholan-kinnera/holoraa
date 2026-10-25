# Architecture Decision Records — index

Each ADR records one decision, its context, and its consequences. A decision is changed only by a new ADR or a dated amendment. Old text stays in place as history.

Use [0000-template.md](0000-template.md) for new records. **Status is set by the owner.** An agent or contributor never marks a record as Accepted.

| ADR | Title | Status (as recorded in the file) | v2 relevance |
|---|---|---|---|
| [0001](0001-monorepo-pnpm-workspaces-turborepo.md) | Monorepo with pnpm workspaces and Turborepo | Accepted; partially superseded by 0007 | Backend part superseded. Web tooling still open (M5). |
| [0002](0002-modular-monolith-architecture.md) | Modular monolith over microservices | Accepted; amended 2026-10-23 | Retained. Implemented as Go packages. |
| [0003](0003-nestjs-backend-framework.md) | NestJS backend framework | Superseded by 0007 | Historical only. |
| [0004](0004-postgresql-primary-database.md) | PostgreSQL as primary database | Accepted; amended 2026-10-23 | PostgreSQL retained. Version 17 is provisional (D4). Prisma removed. |
| [0005](0005-livekit-webrtc-media-engine.md) | LiveKit for calls and screen sharing | Accepted (legacy); deferred for v2. **Owner to confirm.** | Calls are deferred. |
| [0006](0006-redis-presence-and-pubsub.md) | Redis for presence and pub/sub | Accepted; amended 2026-10-23 (implementation deferred) | Redis not in the foundation. |
| [0007](0007-go-modular-monolith-foundation-v2.md) | Go modular monolith foundation (v2) | **Proposed.** Acceptance is decision D10. | The v2 backend and foundation decisions. |
| [0008](0008-foundation-skeleton-tooling.md) | Tooling and versions for the foundation skeleton | **Proposed.** Owner acceptance pending. | Exact versions and their checks: chi, pgx, goose, Next.js, TypeScript, ESLint, and the contract tools. Records the ESLint lifecycle question. |
| [0009](0009-authentication-and-sessions.md) | Authentication and server-managed sessions (resolves DEC-007) | **Proposed.** Owner acceptance pending. | Email one-time codes, PostgreSQL sessions, CSRF. Google sign-in in slice 3. Limits and retention in D11. |

## Gaps and notes

- **0005 was missing from the v2 repository.** It is restored in this change, unchanged except for a header that records its deferred status.
- **0000 is the template.** It is restored unchanged.
- Numbers 0001–0007 have no gaps after restoration.
- Any decision that remains open is listed in [../MILESTONE_GATES.md](../MILESTONE_GATES.md) under "Open owner decisions".
