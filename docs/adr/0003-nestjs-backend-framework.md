# ADR 0003: NestJS Backend Framework

- **Status:** Superseded by [ADR 0007](0007-go-modular-monolith-foundation-v2.md) (2026-10-23)
- **Date:** 2026-10-20
- **Deciders:** Lead Architect
- **Consulted:** Solo Maintainer

---

## Context and Problem Statement
We need a robust, strongly-typed backend framework capable of handling both RESTful APIs and real-time bidirectional WebSocket connections with high maintainability and testability.

## Decision Drivers
- First-class TypeScript support with strong compile-time guarantees.
- Built-in dependency injection for mockable, isolated unit testing.
- Unified abstractions for Express HTTP routing and Socket.io gateways.

## Considered Options
1. **NestJS**
2. Plain Express.js / Fastify
3. Hono / Elysia
4. Go (Gin/Echo)

## Decision Outcome
Chosen option: **NestJS**, because:
- Its modular structure (`@Module`, `@Injectable`, `@Controller`) enforces architectural discipline.
- Native integration with `@nestjs/websockets` allows sharing auth guards and validation pipes across REST and WebSockets.
- Vast ecosystem of tested official modules (`@nestjs/throttler`, `@nestjs/swagger`, `nestjs-pino`).

### Consequences
- Positive: Predictable codebase structure; seamless integration with Socket.io; automated Swagger docs generation.
- Negative: Higher initial abstraction overhead (decorators and DI) compared to lightweight routers like Hono.

---

## Supersession note (2026-10-23)

This ADR is **superseded by ADR 0007**, which selects a Go modular monolith for the v2 backend. The NestJS implementation is preserved in two places, with different reach:

- The **local** annotated tag `legacy/nestjs-foundation`, which exists in the owner's clone and targets the snapshot commit `fb73440`. It is not published: the remote has no tags.
- The **external** verified backup (bundle, patch, and file copies), outside the repository.

It is **not** part of the v2 tree.

The decision text above is kept unchanged as historical record. It no longer governs new work. Option 4 in this ADR's "Considered Options" (Go with Gin or Echo) was not chosen at the time. The owner's later v2 direction selects Go; ADR 0007 records that direction but does not re-analyse option 4.
