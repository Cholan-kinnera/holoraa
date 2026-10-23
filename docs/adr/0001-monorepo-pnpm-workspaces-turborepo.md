# ADR 0001: Monorepo with pnpm Workspaces and Turborepo

- **Status:** Accepted; partially superseded by ADR 0007 (2026-10-23, see Amendment)
- **Date:** 2026-10-20
- **Deciders:** Lead Architect
- **Consulted:** Solo Maintainer

---

## Context and Problem Statement
Holoraa requires both a frontend web client (`apps/web`) and an API server (`apps/api`), sharing common Zod data validation schemas, TypeScript interfaces, and linting rules. Maintaining multiple distinct git repositories introduces sync friction, version divergence, and duplicated code.

## Decision Drivers
- Single source of truth for Zod schemas and TypeScript types.
- Atomic commits spanning API contracts and client consumers.
- Fast, cached local development and CI execution suitable for a solo developer.

## Considered Options
1. **pnpm workspaces + Turborepo**
2. npm workspaces + Lerna
3. Polyrepo (separate repositories for web, api, shared)

## Decision Outcome
Chosen option: **pnpm workspaces + Turborepo**, because:
- pnpm's symlinked content-addressable storage saves disk space and prevents ghost dependencies.
- Turborepo builds dependency graphs and caches task outputs (`turbo.json`), accelerating CI and local rebuilds.

### Consequences
- Positive: Instant sharing of `@holoraa/shared` across both applications.
- Negative: Monorepo tooling requires careful dependency configuration and workspace protocol (`workspace:*`).

---

## Amendment (2026-10-23): partial supersession

- **Status change:** partially superseded by [ADR 0007](0007-go-modular-monolith-foundation-v2.md).
- **Superseded for the backend:** the pnpm workspace and Turborepo orchestration covered `apps/api` (NestJS). The v2 backend is a single Go module and is not governed by pnpm or Turborepo.
- **Still open for the web app:** whether `web/` uses pnpm, npm, or no workspace tooling, and whether Turborepo is needed at all. Pending M5; to be decided by a new ADR after reviewing options.
- **Original decision above is preserved unchanged** as historical record.
