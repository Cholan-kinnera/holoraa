# Engineering & Product Roadmap — Holoraa

- **Purpose:** Phased product delivery plan, from foundation to public beta, and how it maps to the v2 engineering milestones.
- **Owner:** TODO(owner): Product & Engineering Lead
- **Status:** Draft for owner review (v2 reconciliation). Not yet approved.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** v2 milestone M0 (Go module skeleton and version entry point) is committed on `feat/v2-m0`. Everything else in this document is planned. Nothing in Phases 1–8 is implemented.

---

## How this roadmap relates to the engineering gates

Product phases below describe what users get. Engineering milestones M0–M8 in [MILESTONE_GATES.md](../MILESTONE_GATES.md) describe how the foundation is built and verified. A product phase can start only after the milestones it depends on pass their gates, and only after any feature it needs is approved (see [AGENTS.md](../../AGENTS.md), "Scope boundaries").

| Engineering milestone | Scope (summary) |
|---|---|
| M0 | Repository skeleton: Go module, version entry point, Makefile |
| M1 | Configuration and logging |
| M2 | Health, readiness, PostgreSQL, goose baseline |
| M3 | sqlc queries |
| M4 | API contracts (generator spike) |
| M5 | Web app (Next.js, TypeScript) |
| M6 | Realtime, ping and pong only, flag off by default |
| M7 | Infrastructure and CI |
| M8 | Documentation and setup |

---

## Phases Overview

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6 ──► Phase 7 ──► Phase 8
Foundation  MVP Chat   Communities  Media &     Trust &     Voice &     Personal    Clean Feed  Public
            (DMs)      & Roles      Files       Safety      Video Calls Rooms       & Stories   Beta
```

---

## Milestone Breakdown

### Phase 0: Foundation (in progress)
- [x] v2 M0: Go module skeleton and version entry point (`feat/v2-m0`, commit `18ff03f`).
- [x] Governance: v2 rulebook (`AGENTS.md`), ADR 0007 (Proposed), milestone gates (`docs/MILESTONE_GATES.md`).
- [ ] v2 M1–M8, as listed above.
- [ ] Web app shell and status page (v2 M5).
- [ ] Core product documentation, reconciled to v2 (this document and its siblings in `docs/product/`).

*Legacy note:* an earlier NestJS, Prisma, and Redis foundation exists in the legacy repository and is archived. It is not part of v2.

### Phase 1: MVP Chat (DMs & Core Realtime)
- Authentication: **design not yet approved.** The method (password, magic link, or other) is `TODO(owner)`. AGENTS.md forbids implementing authentication before the owner approves its design.
- Profiles: username uniqueness, avatars, and presence status (`online`, `idle`, `offline`).
- 1:1 direct messages over WebSocket (`github.com/coder/websocket`, pinned at v2 M6).
- Delivery and read receipts, typing indicators, and paginated message history.
- Note: Redis is deferred until a feature needs it (AGENTS.md). Whether Phase 1 needs it is `TODO(owner)`.

### Phase 2: Communities & Channels
- Community creation, icon upload, and invite links.
- Text channels grouped by category.
- Role engine with permission evaluation. The model is `TODO(owner)`.
- Member moderation: kick, ban, mute.

### Phase 3: Media, Attachments & Rich Messages
- Object storage upload with presigned URLs. The storage provider is `TODO(owner)`.
- Image thumbnails and video previews.
- Reactions and reply threads.

### Phase 4: Trust, Safety & Compliance
- In-app reporting for harassment and abuse.
- Blocking and muting.
- Data export and account deletion, aligned with GDPR and the India DPDP Act. Legal review is `TODO(owner)`.
- Age verification approach: `TODO(owner)`.

### Phase 5: Voice & Video Calls
- **Deferred (post-MVP) under AGENTS.md.** The calling approach (LiveKit was the legacy choice) is `TODO(owner)`. The legacy ADR 0005 is archived and not part of v2.
- 1:1 voice and video calls, screen sharing, and connection-quality indicators.

### Phase 6: Personal Rooms & Hangouts
- Persistent personal room links.
- Host-controlled waiting room and guest admission.
- Ephemeral participant permissions.

### Phase 7: Clean Feed & Stories
- **Out of scope until the owner approves it (AGENTS.md).**
- Chronological feed from connections, with no algorithmic reordering.
- Stories that disappear after 24 hours, with privacy controls.
- No ads and no sponsored insertion.

### Phase 8: Public Beta & Hardening
- Beta cohort of 50 to 200 users.
- Load testing against the realtime target (1,000 concurrent connections). The tool and version are `TODO(owner)` until verified.
- External penetration test and a disclosure policy.
