# Product Requirements Document (PRD) — Holoraa

- **Purpose:** Product requirements: problem, users, product pillars, scope, and implementation status.
- **Owner:** Product Lead & Lead Architect
- **Status:** Approved for Foundation & Phase 1/2 Architecture Alignment.
- **Last Updated:** 2026-10-30
- **Implementation Status:**
  - **Implemented:** M0 Go foundation, M1/M2 health and configuration, M9 Slice 1 (email OTP sign-in, session rotation, profiles backend).
  - **Documented & Planned:** Realtime WebSocket gateway (M6), Direct Messaging with quoted thoughts & attachments (Phase 1), Spaces & Channels (Phase 2), Personal Rooms (Phase 3).
  - **Prototype-Only (Client):** Client-side Prefix Trie + Trigram search, 2-hop BFS graph traversal, mock conversation threads, and mock knock approval flows in `web/public/prototype.html`.
  - **Deferred:** LiveKit WebRTC SFU (post-MVP), Redis pub/sub (until multi-instance fan-out is required), FastAPI AI/moderation service.

---

## 1. Problem Statement

Modern social communication is broken by app fragmentation and attention extraction:
- **Fragmentation:** People juggle WhatsApp for direct messages, Discord for community channels, Zoom/Meet for calls, and Instagram for photos and status notes.
- **Cognitive fatigue:** Cluttered interfaces, algorithmic ranking, and notification pressure drain attention.
- **Context loss:** Conversations, media, and connections are scattered across silos with incompatible privacy models.

**Holoraa** is one quiet, pitch-black OLED social space that brings direct chats, community spaces, spontaneous thoughts, and knock-to-enter personal rooms together.

---

## 2. Target Personas

### Persona A: "Priya" — The Community Lead & Student
- **Profile:** 21-year-old engineering student coordinating university clubs, study circles, and weekend trips.
- **Needs:** Fast topic channels, cozy voice rooms for spontaneous co-studying, and direct messages with friends without managing multiple accounts.
- **Frustrations:** Discord is overwhelming and cluttered. WhatsApp groups quickly become noisy and chaotic.

### Persona B: "Marcus" — The Privacy-Minded Creator
- **Profile:** 28-year-old independent designer running an invite-only creative circle.
- **Needs:** High aesthetic standards (true pitch-black OLED, hairline borders), focused asynchronous chat, spontaneous room hangouts, and zero data selling or behavioral tracking.
- **Frustrations:** Slack is expensive and corporate. Instagram DMs are disorganized and surrounded by attention-extracting reels.

---

## 3. Product Pillars

1. **Direct & Groups (WhatsApp-grade speed & reliability):**
   - 1:1 direct messages, group conversations, quoted replies, photo/audio cards, hover reactions, unread indicators, and double-check delivery ticks.
   - Idempotency via `client_msg_id` and monotonic cursor pagination (`UUIDv7`).
2. **The Spot & Social Graph (Instagram-style notes & calm thoughts stream):**
   - Horizontal **Notes Tray** for ephemeral status notes (*"Fred again.. 🎧"*, *"in room 🎙️"*).
   - Spontaneous **Thoughts Stream** ranked by fresh activity and mutual connection strength (Calm Gravity Score)—never rage-bait algorithms.
   - **"Reply in DM"** bridge allowing a thought to seamlessly initiate a private 1-on-1 DM with a quoted context reference.
3. **Quiet Spaces (Discord-style community channels without clutter):**
   - Light servers with text channels (`#general`, `#inspo-drop`, `#ship-log`) and cozy voice lounge cards with active participant presence.
   - Cryptographically random invite codes with atomic use limits and ban enforcement.
4. **Personal Rooms (Persistent knock-to-enter video lounges):**
   - Permanent personal link (`holoraa.app/r/:slug`).
   - Host-controlled Lock toggle and **Waiting Room Knock** approvals (*"Rohan wants to join your room"* → `Let in` animates guest into call grid).

---

## 4. Scope & Feature Traceability Matrix

| Feature Area | Sub-features | Status | Architectural & Implementation Home |
|---|---|---|---|
| **Direct Messaging** | 1:1 DMs, Groups, Replies, Idempotency | Planned (Phase 1) | Backend `internal/httpapi`, `messages` table with `quoted_thought_id`, WebSockets (M6) |
| **The Spot** | Ephemeral notes tray, Thoughts stream, Mood tags | Documented / Planned | `thoughts`, `user_notes`, `thought_likes`, `search_vector` GIN index |
| **Social Graph** | 2-hop mutual recommendations, Directed follows | Client prototype / Backend planned | `follows` table; client-side Prefix Trie + BFS for sub-ms typeahead; PostgreSQL GIN trigram backend |
| **Spaces** | Servers, text & voice channels, invites, bans | Planned (Phase 2) | `servers`, `channels`, `server_invites`, `server_bans` |
| **Personal Rooms** | Permanent slug, lock state, waiting room knock | Planned (Phase 3) | `personal_rooms` table, `room.knock` and `room.approved` realtime events; LiveKit post-MVP |
| **Trust & Safety** | Block, mute, report with frozen context snapshot | Planned | `blocks`, `reports` with privacy-minimized `snapshot JSONB` (max 10 surrounding messages) |
| **Authentication** | Email OTP, session tokens, CSRF protection | **Implemented** (Slice 1) | `users`, `email_identities`, `sessions`, `email_otp_challenges` in `00002_auth_profiles.sql` |

---

## 5. Success Metrics & Validation Targets

- **Realtime Latency:** p95 message delivery under 500 ms under normal load.
- **Search Responsiveness:** Client-side prefix/fuzzy match latency < 5 ms for cached orbit; server-side tsvector/trigram query latency < 50 ms.
- **Call & Room Connection:** At least 98.5% successful ICE negotiation once LiveKit SFU is integrated.
- **API Availability:** 99.5% uptime on `/v1/*` endpoints.
