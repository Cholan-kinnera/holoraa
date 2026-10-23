# ADR 0004: PostgreSQL as Primary Database for Messages and Relations

- **Status:** Accepted (amended 2026-10-23; see Amendment)
- **Date:** 2026-10-20
- **Deciders:** Lead Architect
- **Consulted:** Solo Maintainer

---

## Context and Problem Statement
Chat platforms often consider NoSQL databases (Cassandra, ScyllaDB, MongoDB) for message logs. We need to decide on the initial primary storage engine for messages, users, and community structures in Holoraa.

## Decision Drivers
- Relational integrity across users, servers, channels, memberships, and permissions.
- Operational simplicity for a solo student maintainer.
- Predictable ACID compliance for membership states, role hierarchies, and transaction rollbacks.

## Considered Options
1. **PostgreSQL 17 with Prisma ORM**
2. MongoDB / DocumentDB
3. ScyllaDB / Cassandra (for messages only) + PostgreSQL (for relational data)

## Decision Outcome
Chosen option: **PostgreSQL 17 with Prisma**, because:
- PostgreSQL easily scales to tens of millions of chat messages with proper B-Tree composite indexing on `(conversation_id, created_at DESC)` and table partitioning if needed.
- Splitting databases prematurely introduces distributed transaction complexity, dual-write failures, and complex migration tooling.
- Single backup, single connection pool, and unified Prisma migrations significantly accelerate development.

### Consequences
- Positive: Foreign key constraints prevent orphaned records; clean ERD; type-safe queries.
- Negative: Extreme write scale (hundreds of thousands of writes/second) may eventually require partitioning or dedicated storage in later years.

---

## Amendment (2026-10-23): PostgreSQL retained; tooling changed

- **Status change:** amended.
- **Retained:** PostgreSQL as the primary database, and its rationale (relational integrity, ACID, single backup and connection pool).
- **Changed:** Prisma is removed. Migrations are **goose**. Queries are written in SQL and compiled by **sqlc**. See [ADR 0007](0007-go-modular-monolith-foundation-v2.md).
- **Version:** PostgreSQL 17 is **provisional**. Its official support status and the intended image and version must be verified before it is pinned in any configuration. Not yet verified.
- **Original decision above is preserved unchanged** as historical record. The "PostgreSQL 17 with Prisma" wording in "Chosen option" is superseded by this amendment.
