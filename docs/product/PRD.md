# Product Requirements Document (PRD) — Holoraa

- **Purpose:** Product requirements: problem, users, product pillars, scope, and success targets.
- **Owner:** TODO(owner): Product Lead
- **Status:** Draft for owner review (v2 reconciliation). Not yet approved.
- **Last Updated:** 2026-10-25
- **Implemented vs Proposed:** Nothing in this PRD is implemented yet. v2 has only its foundation (milestone M0). Scope is governed by the out-of-scope list in [AGENTS.md](../../AGENTS.md); anything listed there needs owner approval before work starts.

---

## 1. Problem Statement

Modern social communication is broken by app fragmentation and attention extraction:
- **Fragmentation:** People juggle WhatsApp for direct messages, Discord for community discussion, Zoom or Google Meet for calls, and Instagram for photos.
- **Cognitive fatigue:** Cluttered interfaces, algorithmic ranking, and notification pressure drain attention.
- **Context loss:** Conversations and memories are scattered across silos with different privacy models.

**Holoraa** is one simple, privacy-respecting place for direct messages, small community spaces, and calls.

---

## 2. Target Personas

### Persona A: "Priya" — The Community Lead & Student
- **Profile:** 21-year-old engineering student coordinating university clubs and study circles.
- **Needs:** Topic channels, voice rooms for spontaneous co-studying, and direct messages with peers without managing several logins.
- **Frustrations:** Discord is noisy and complex. WhatsApp groups quickly become unmanageable.

### Persona B: "Marcus" — The Privacy-Minded Creator
- **Profile:** 28-year-old independent designer running an invite-only design guild.
- **Needs:** High aesthetic standards, focused asynchronous chat, screen sharing for reviews, and no data selling.
- **Frustrations:** Slack is expensive and corporate. Instagram DMs are disorganised and full of algorithmic distraction.

---

## 3. Product Pillars

1. **Direct messaging (reliable, WhatsApp-grade in intent):** DMs, group chats, typing presence, read receipts, audio notes, and media attachments. *Proposed.*
2. **Community spaces (organised, Discord-style in structure):** Servers, categorised text and voice channels, roles, and permissions. *Proposed.*
3. **Realtime hangouts and rooms:** Voice and video calls, screen sharing, and persistent personal rooms with a waiting room. *Deferred under AGENTS.md; the calling approach is `TODO(owner)`.*
4. **Chronological sharing:** Photo and story updates among close connections, in time order with no algorithmic ranking. *Out of scope until approved.*

---

## 4. Scope Breakdown

| Feature area | v2 status today | Phase 1 (MVP chat) | Phase 2 (communities) | Later |
|---|---|---|---|---|
| Repository, CI, and gates | M0 committed; M1–M8 planned | Maintained | Maintained | Maintained |
| App shell and layout | Planned (v2 M5) | Enhanced | Enhanced | Enhanced |
| Health and readiness | Planned (v2 M2) | Expanded | Expanded | Expanded |
| Authentication | Not implemented; design needs owner approval | Session auth (method `TODO(owner)`) | Additional sign-in methods (`TODO(owner)`) | Passkeys (`TODO(owner)`) |
| 1:1 direct messages | Not implemented | Realtime and storage | Media | End-to-end encryption, under research |
| Servers and channels | Not implemented | Not in Phase 1 | Full create, edit, delete, and roles | Voice channels |
| Calls and rooms | Deferred | Not in Phase 1 | Not in Phase 2 | Voice, video, and rooms (approach `TODO(owner)`) |
| Media feed and stories | Out of scope until approved | Not in Phase 1 | Not in Phase 2 | Chronological sharing (owner approval required) |

---

## 5. Success Metrics & Validation Targets

These are targets for the private alpha and beta. None has been measured yet.

- **User adoption:** 50 to 200 engaged beta users during dogfooding.
- **Retention:** Week-2 active retention of at least 45%.
- **Realtime latency:** p95 message delivery under 500 ms under normal load.
- **Call success rate:** At least 98.5% successful connection and ICE negotiation. Applies only when calls ship.
- **API availability:** 99.5% uptime on `/v1/*` endpoints.
