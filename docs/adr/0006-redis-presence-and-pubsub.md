# ADR 0006: Redis for Realtime Presence Tracking and Pub/Sub Fan-out

- **Status:** Accepted (amended 2026-10-23: implementation deferred; see Amendment)
- **Date:** 2026-10-20
- **Deciders:** Lead Architect
- **Consulted:** Solo Maintainer

---

## Context and Problem Statement
Realtime presence indicators (online/idle/offline status), typing indicators, and message event delivery across multiple API nodes require a distributed in-memory coordination mechanism.

## Decision Drivers
- Sub-millisecond read/write latency for presence heartbeats.
- Distributed Pub/Sub to broadcast events across multiple Socket.io gateway instances.
- Automatic key expiration (TTL) for self-healing presence tracking (e.g. if a client abruptly loses power).

## Considered Options
1. **Redis 7 (In-Memory Key-Value & Pub/Sub via `ioredis`)**
2. PostgreSQL LISTEN/NOTIFY
3. RabbitMQ / Apache Kafka

## Decision Outcome
Chosen option: **Redis 7**, because:
- Native Pub/Sub seamlessly integrates with `@socket.io/redis-adapter` for horizontal scaling.
- In-memory key TTLs ensure presence status expires cleanly after 60 seconds without periodic database cleanup cron jobs.
- Lightweight container footprint and standard inclusion in all major cloud platforms.

### Consequences
- Positive: Minimal load on PostgreSQL for ephemeral typing and presence states; blazing-fast broadcasts.
- Negative: Additional infrastructure dependency to manage and monitor in local and staging environments.

---

## Amendment (2026-10-23): deferred

- **Status change:** amended; **implementation deferred**.
- **New decision:** Redis is **not part of the v2 foundation**. It is introduced only when a specific feature requires presence, typing indicators, or cross-instance pub/sub. Foundation readiness does not check Redis.
- **Retained:** the design rationale above applies when Redis is introduced. The earlier reference to `@socket.io/redis-adapter` is specific to the legacy Socket.io gateway and does not apply to the v2 Go gateway, which will choose its own fan-out mechanism when needed.
- **Original decision above is preserved unchanged** as historical record. See [ADR 0007](0007-go-modular-monolith-foundation-v2.md).
