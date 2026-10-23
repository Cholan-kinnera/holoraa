# ADR 0002: Modular Monolith Architecture over Microservices

- **Status:** Accepted (amended 2026-10-23; see Amendment)
- **Date:** 2026-10-20
- **Deciders:** Lead Architect
- **Consulted:** Solo Maintainer

---

## Context and Problem Statement
When designing the backend for Holoraa (covering messaging, community servers, permissions, and calls), we must choose between a microservices topology or a modular monolith. The developer is a solo engineering student working with AI tools.

## Decision Drivers
- Operational simplicity and zero distributed deployment overhead.
- Immediate ACID transaction guarantees across related tables (e.g., users, conversations, memberships).
- Avoid premature network latency and serialization overhead between microservices.

## Considered Options
1. **Modular Monolith (Single deployable with strict internal domain boundaries)**
2. Microservices (Auth service, Chat service, Notification service, Community service)
3. Serverless Functions (AWS Lambda / Vercel Functions)

## Decision Outcome
Chosen option: **Modular Monolith**, because:
- Allows clear domain separation (`modules/health`, `modules/chat`, `modules/communities`) in a single codebase.
- Avoids the operational overhead of managing service meshes, distributed tracing, and independent deployments.
- Enables refactoring domain boundaries safely with compiler-checked TypeScript interfaces before scaling.

### Consequences
- Positive: Single database transaction boundaries, local debugging with one command, minimal cloud costs.
- Negative: All modules share the same runtime process; CPU-intensive tasks must be carefully offloaded to background queues.

---

## Amendment (2026-10-23): decision retained, implementation changed

- **Status change:** amended. The decision to use a modular monolith is **retained**.
- **What changes:** the modules are now Go packages under `backend/internal/` in a single Go module, instead of NestJS modules. The example module names above (`modules/health`, `modules/chat`, `modules/communities`) are illustrative and are not binding for v2.
- **Why:** the backend language and framework change under [ADR 0007](0007-go-modular-monolith-foundation-v2.md). The single-deployable, single-transaction-boundary reasoning in this ADR still holds.
- **Original decision above is preserved unchanged** as historical record.
